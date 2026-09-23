/*
 * 本机小隧道：把 git 的 HTTPS 连接固定转发到能连通的 GitHub 入口 IP。
 *
 * 起因：本机解析 github.com 拿到的地址连不通（浏览器开了安全 DNS 所以不受影响），
 * 而下面这些 GitHub 入口 IP 里总有能用的。脚本不修改任何系统设置，只在内存里转发。
 *
 *   node tools/pin-github-proxy.js 8899
 *   git -c http.proxy=http://127.0.0.1:8899 push -u origin main
 */

const http = require("node:http");
const net = require("node:net");

// 按顺序尝试，用第一个能连上的（连上后会记住，后续复用）
const CANDIDATES = [
  "140.82.113.3",
  "140.82.114.3",
  "20.27.177.113",
  "140.82.112.3",
  "140.82.121.3",
];

const PORT = Number(process.argv[2] || 8899);
let pinned = null;

function dial(port, done) {
  const ips = pinned ? [pinned] : CANDIDATES;
  let index = 0;

  const attempt = () => {
    if (index >= ips.length) {
      // 记住的那个入口失效了：清掉缓存，下一轮重新从候选列表里挑
      if (pinned) {
        pinned = null;
        return dial(port, done);
      }
      return done(null);
    }
    const ip = ips[index++];
    const socket = net.connect(port, ip);
    const timer = setTimeout(() => {
      socket.destroy();
      attempt();
    }, 6000);
    socket.once("connect", () => {
      clearTimeout(timer);
      pinned = ip;
      done(socket);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      attempt();
    });
    socket.once("close", () => {
      if (pinned === ip) pinned = null;
    });
  };

  attempt();
}

const server = http.createServer((req, res) => {
  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("只支持 CONNECT 隧道");
});

server.on("connect", (req, clientSocket, head) => {
  const port = Number(req.url.split(":")[1] || "443");
  dial(port, (upstream) => {
    if (!upstream) {
      clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      return;
    }
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`隧道已启动：127.0.0.1:${PORT} → GitHub（自动挑选可用入口）`);
});
