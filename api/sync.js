/*
 * 书签跨设备同步接口（Vercel Serverless Function）
 *
 *   GET  /api/sync?probe=1        探测后端是否可用
 *   GET  /api/sync?code=XXXX...   取回该同步码下的书签
 *   POST /api/sync                { code?, data }  创建或更新
 *
 * 存储用 Upstash Redis（Vercel 市场里一键接入即可），需要环境变量：
 *   KV_REST_API_URL / KV_REST_API_TOKEN          （Vercel KV 的命名）
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN （Upstash 原生命名）
 * 两组任选其一。没有配置时接口返回 503，前端会自动退回到「导出/导入备份」。
 */

const { randomBytes } = require("node:crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉 I O 0 1 等易混字符
const CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;
const MAX_BYTES = 64 * 1024;
const TTL_SECONDS = 60 * 60 * 24 * 365; // 一年，每次同步自动续期

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(cfg, command) {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error("redis " + res.status);
  const body = await res.json();
  return body.result;
}

function newCode() {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function cleanData(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((m) => m && typeof m.p === "number" && typeof m.n === "string")
    .slice(0, 300)
    .map((m) => ({ n: String(m.n).slice(0, 40), p: m.p, f: String(m.f || "").slice(0, 60) }));
}

module.exports = async function handler(req, res) {
  const cfg = redisConfig();
  const query = req.query || {};

  if (query.probe) {
    res.status(200).json({ ok: true, backend: "sync", storage: !!cfg });
    return;
  }
  if (!cfg) {
    res.status(503).json({ error: "no_storage", message: "尚未配置存储（Upstash Redis）" });
    return;
  }

  try {
    if (req.method === "GET") {
      const code = String(query.code || "").toUpperCase();
      if (!CODE_RE.test(code)) {
        res.status(400).json({ error: "bad_code" });
        return;
      }
      const raw = await redis(cfg, ["GET", "hb:" + code]);
      if (!raw) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      await redis(cfg, ["EXPIRE", "hb:" + code, TTL_SECONDS]);
      res.status(200).json(JSON.parse(raw));
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const data = cleanData(body.data);
      const payload = JSON.stringify({ data, updatedAt: Date.now() });
      if (Buffer.byteLength(payload, "utf8") > MAX_BYTES) {
        res.status(413).json({ error: "too_large" });
        return;
      }

      let code = String(body.code || "").toUpperCase();
      if (!code) {
        code = newCode();
      } else if (!CODE_RE.test(code)) {
        res.status(400).json({ error: "bad_code" });
        return;
      }

      await redis(cfg, ["SET", "hb:" + code, payload, "EX", TTL_SECONDS]);
      res.status(200).json({ code, updatedAt: JSON.parse(payload).updatedAt });
      return;
    }

    res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String((err && err.message) || err) });
  }
};
