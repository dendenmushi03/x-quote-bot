// db.js
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

// Render / Railway / Neon などの Postgres を想定
const pool = new Pool({ connectionString: config.DATABASE_URL });

export async function ensureSchema() {
  // まずテーブルを作る（新規環境）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_state (
      id INT PRIMARY KEY,
      last_posted_at BIGINT NOT NULL DEFAULT 0,
      next_allowed_at BIGINT NOT NULL DEFAULT 0
    );
  `);

  // 既存環境（過去のスキーマ）でも壊れないように列を追加
  await pool.query(`
    ALTER TABLE bot_state
    ADD COLUMN IF NOT EXISTS next_allowed_at BIGINT NOT NULL DEFAULT 0;
  `);

  // 初期行（id=1）を用意
  // 旧コードで last_posted_at しか入ってないこともあるので next_allowed_at も合わせて初期化
  await pool.query(`
    INSERT INTO bot_state (id, last_posted_at, next_allowed_at)
    VALUES (1, 0, 0)
    ON CONFLICT (id) DO NOTHING;
  `);

  // 投稿済みツイートID（重複投稿防止）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posted_tweets (
      tweet_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function getState() {
  const r = await pool.query(
    `SELECT last_posted_at, next_allowed_at FROM bot_state WHERE id = 1`
  );

  return {
    last_posted_at: Number(r.rows?.[0]?.last_posted_at ?? 0),
    next_allowed_at: Number(r.rows?.[0]?.next_allowed_at ?? 0),
  };
}

export async function setState({ last_posted_at, next_allowed_at } = {}) {
  // 更新対象が無いなら何もしない
  if (last_posted_at == null && next_allowed_at == null) return;

  const updates = [];
  const values = [];
  let i = 1;

  if (last_posted_at != null) {
    updates.push(`last_posted_at = $${i++}`);
    values.push(String(last_posted_at));
  }

  if (next_allowed_at != null) {
    updates.push(`next_allowed_at = $${i++}`);
    values.push(String(next_allowed_at));
  }

  await pool.query(
    `UPDATE bot_state SET ${updates.join(", ")} WHERE id = 1`,
    values
  );
}

export async function hasPosted(tweetId) {
  const r = await pool.query(`SELECT 1 FROM posted_tweets WHERE tweet_id = $1`, [
    tweetId,
  ]);
  return r.rowCount > 0;
}

export async function markPosted(tweetId) {
  await pool.query(
    `INSERT INTO posted_tweets (tweet_id) VALUES ($1)
     ON CONFLICT (tweet_id) DO NOTHING`,
    [tweetId]
  );
}

// 任意：プロセス終了時にコネクションを閉じたい場合に使う（Cron Job向け）
// 使うなら server.js 側で finally { await closeDb(); } とかにする
export async function closeDb() {
  await pool.end();
}
