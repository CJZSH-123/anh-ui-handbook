/*
 * 一键推送：把本地改动提交并推到 GitHub。
 *
 *   push-to-github.cmd          （双击即可）
 *   node tools/push.js
 *
 * 做三件事：确保令牌可用 → 确保网络隧道在跑 → git add/commit/push。
 * 令牌保存在项目根目录的 token.txt（已在 .gitignore 里，不会被上传）。
 */

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const readline = require("node:readline");

const ROOT = path.resolve(__dirname, "..");
const TOKEN_FILE = path.join(ROOT, "token.txt");
const GH_USER = "CJZSH-123";
const GH_REPO = "CJZSH-123/anh-ui-handbook";
const PORT = 8899;

const GIT_CANDIDATES = [
  "C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\git\\cmd\\git.exe",
  "git",
];

function gitBin() {
  for (const candidate of GIT_CANDIDATES) {
    if (candidate === "git" || fs.existsSync(candidate)) return candidate;
  }
  return "git";
}

function run(cmd, args, options) {
  const capture = !!(options && options.capture);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (capture) {
    return {
      code: result.status,
      out: (result.stdout || "").trim(),
      err: (result.stderr || "").trim(),
    };
  }
  return { code: result.status };
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function ensureTunnel() {
  if (await portOpen(PORT)) return true;
  console.log("  正在启动网络隧道（让 git 走能连通的 GitHub 入口）…");
  const child = spawn(process.execPath, [path.join(__dirname, "pin-github-proxy.js"), String(PORT)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await portOpen(PORT)) return true;
  }
  return false;
}

function resetTunnel() {
  return new Promise((resolve) => {
    const req = httpGet("http://127.0.0.1:" + PORT + "/reset", () => resolve(true));
    req.on("error", () => resolve(false));
  });
}

function httpGet(url, done) {
  const request = require("node:http").get(url, (res) => {
    res.resume();
    res.on("end", () => done(true));
  });
  return request;
}

async function main() {
  console.log("");
  console.log("  推送本地改动到 GitHub：" + GH_REPO);
  console.log("  ------------------------------------------------------------");

  if (!fs.existsSync(TOKEN_FILE)) {
    console.log("  第一次使用需要 GitHub 令牌（在 https://github.com/settings/tokens 生成，勾选 repo）");
    const token = await ask("  粘贴令牌后回车: ");
    if (!token) {
      console.log("  没有输入令牌，已取消。");
      return 1;
    }
    fs.writeFileSync(TOKEN_FILE, token, "utf8");
    console.log("  令牌已保存到 token.txt（不会上传）");
  }
  const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  if (!token) {
    console.log("  token.txt 是空的，请删除它后重新运行。");
    return 1;
  }

  if (!(await ensureTunnel())) {
    console.log("  隧道启动失败，可能是网络问题，稍后重试。");
    return 1;
  }

  const git = gitBin();
  run(git, ["add", "-A"]);
  const staged = run(git, ["diff", "--cached", "--quiet"], { capture: true });
  if (staged.code !== 0) {
    console.log("  正在提交改动…");
    const commit = run(git, ["commit", "-m", "更新手册内容"], { capture: true });
    if (commit.code !== 0 && !/nothing to commit/i.test(commit.out + commit.err)) {
      console.log("  提交失败：" + (commit.err || commit.out));
      return 1;
    }
  } else {
    console.log("  没有未提交的改动，直接推送已有提交。");
  }

  console.log("  正在推送…");
  const url = "https://" + GH_USER + ":" + token + "@github.com/" + GH_REPO + ".git";

  // 到 GitHub 的线路会时好时坏，失败就换一个入口重试几次
  let push = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    push = run(git, [
      "-c", "credential.helper=",
      "-c", "http.proxy=http://127.0.0.1:" + PORT,
      "-c", "http.version=HTTP/1.1",
      "-c", "http.sslBackend=openssl",   // schannel 在这条线路上常被中途掐断
      "push", url, "main:refs/heads/main",
    ], { capture: true });
    if (push.code === 0) break;
    const text = (push.err || "") + (push.out || "");
    const networky = /unable to access|Connection|timed out|schannel|CONNECT|reset|Could not/i.test(text);
    if (!networky || attempt === 4) break;
    console.log("  第 " + attempt + " 次失败（网络原因），换入口重试…");
    await resetTunnel();
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!push || push.code !== 0) {
    console.log("  推送失败：");
    console.log("  " + ((push && (push.err || push.out)) || "未知原因").split(url).join("<repo>"));
    console.log("  常见原因：线路不稳、令牌过期或被删。稍后再运行一次通常就好了。");
    return 1;
  }

  const message = (push.err || push.out).split(url).join("<repo>");
  if (message) console.log("  " + message);
  console.log("");
  console.log("  推送完成。Vercel 会自动重新部署，一两分钟后生效。");
  console.log("");
  return 0;
}

main().then((code) => process.exit(code));
