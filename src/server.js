import express from "express";
import { config } from "./config.js";
import { ensureSchema } from "./db.js";
import { runOnce } from "./bot.js";

const app = express();
app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

/**
 * 実行トリガー（GitHub Actionsから叩く）
 * 例: GET /run?key=YOUR_RUN_KEY
 */
app.get("/run", async (req, res) => {
  if (req.query.key !== config.RUN_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    await ensureSchema();
    const result = await runOnce();
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Server listening on :${port}`);
});
