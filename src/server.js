import express from "express";
import { config } from "./config.js";
import { ensureSchema } from "./db.js";
import { runOnce } from "./bot.js";

const app = express();
app.disable("x-powered-by");

// --- 起動時に1回だけschemaを作る（/runのたびに作らない） ---
let schemaReady = false;
async function ensureSchemaOnce() {
  if (schemaReady) return;
  await ensureSchema();
  schemaReady = true;
}

// --- 二重実行を止める（まず止血：同一プロセス内ロック） ---
let isRunning = false;

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

/**
 * 実行トリガー
 * - 互換：GET /run?key=...
 * - 推奨：Header "x-run-key: ..."
 */
app.get("/run", async (req, res) => {
  const keyFromQuery = req.query.key;
  const keyFromHeader = req.header("x-run-key");
  const providedKey = keyFromHeader || keyFromQuery;

  if (!providedKey || providedKey !== config.RUN_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  // すでに実行中なら弾く（これが無いと同時実行→429踏みやすい）
  if (isRunning) {
    return res.status(409).json({ ok: false, error: "already_running" });
  }

  isRunning = true;

  try {
    await ensureSchemaOnce();
    const result = await runOnce();
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    isRunning = false;
  }
});

const port = process.env.PORT || 10000;

app.listen(port, async () => {
  try {
    await ensureSchemaOnce();
    console.log(`Server listening on :${port}`);
  } catch (e) {
    console.error("ensureSchema failed on boot:", e);
    // ここで落とした方が安全（DB未初期化で動いても意味がない）
    process.exit(1);
  }
});
