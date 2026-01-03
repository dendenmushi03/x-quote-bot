import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: config.DATABASE_URL });

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_state (
      id INT PRIMARY KEY,
      last_posted_at BIGINT NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    INSERT INTO bot_state (id, last_posted_at)
    VALUES (1, 0)
    ON CONFLICT (id) DO NOTHING;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posted_tweets (
      tweet_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function getState() {
  const r = await pool.query(`SELECT last_posted_at FROM bot_state WHERE id = 1`);
  return { last_posted_at: Number(r.rows?.[0]?.last_posted_at ?? 0) };
}

export async function setState({ last_posted_at }) {
  await pool.query(`UPDATE bot_state SET last_posted_at = $1 WHERE id = 1`, [String(last_posted_at)]);
}

export async function hasPosted(tweetId) {
  const r = await pool.query(`SELECT 1 FROM posted_tweets WHERE tweet_id = $1`, [tweetId]);
  return r.rowCount > 0;
}

export async function markPosted(tweetId) {
  await pool.query(
    `INSERT INTO posted_tweets (tweet_id) VALUES ($1) ON CONFLICT (tweet_id) DO NOTHING`,
    [tweetId]
  );
}
