/*
 * 本地预览用的“假后端”：既能当静态服务器，也能响应 /api/sync。
 * 数据存在内存里，进程重启就清空——只是为了在本地把同步流程走通，不要用于正式环境。
 *
 *   node tools/mock-sync-server.js 5181
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
// 可以同时监听多个端口：数据在同一进程里，方便模拟"两台设备/两个浏览器"
const PORTS = (process.argv.slice(2).filter(Boolean).map(Number).filter(Boolean));
if (!PORTS.length) PORTS.push(5181);
const store = new Map();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".doc": "application/msword",
};

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;

function newCode() {
  let out = "";
  for (let i = 0; i < 12; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function handleApi(req, res, url) {
  if (url.searchParams.get("probe")) {
    json(res, 200, { ok: true, backend: "mock", storage: true });
    return;
  }
  if (req.method === "GET") {
    const code = String(url.searchParams.get("code") || "").toUpperCase();
    if (!CODE_RE.test(code)) return json(res, 400, { error: "bad_code" });
    const raw = store.get(code);
    if (!raw) return json(res, 404, { error: "not_found" });
    return json(res, 200, JSON.parse(raw));
  }
  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const data = Array.isArray(parsed.data) ? parsed.data.slice(0, 300) : [];
        let code = String(parsed.code || "").toUpperCase();
        if (!code) code = newCode();
        else if (!CODE_RE.test(code)) return json(res, 400, { error: "bad_code" });
        const payload = { data, updatedAt: Date.now() };
        store.set(code, JSON.stringify(payload));
        json(res, 200, { code, updatedAt: payload.updatedAt });
      } catch (err) {
        json(res, 400, { error: "bad_json" });
      }
    });
    return;
  }
  json(res, 405, { error: "method_not_allowed" });
}

function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/sync") return handleApi(req, res, url);

    let file = decodeURIComponent(url.pathname);
    if (file === "/") file = "/index.html";
    const target = path.join(ROOT, file);
    if (!target.startsWith(ROOT)) return json(res, 403, { error: "forbidden" });

    fs.readFile(target, (err, buf) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404");
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(buf);
    });
}

PORTS.forEach((port) => {
  http.createServer(handle).listen(port, "127.0.0.1", () => {
    console.log(`本地预览（含同步接口）: http://127.0.0.1:${port}`);
  });
});
