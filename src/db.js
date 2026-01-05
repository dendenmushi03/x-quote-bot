import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: config.DATABASE_URL });

export async function ensureSchema() {
  // bot_state（既存からの拡張も考慮）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_state (
      id INT PRIMARY KEY,
      last_posted_at BIGINT NOT NULL DEFAULT 0,
      last_fetch_at  BIGINT NOT NULL DEFAULT 0,
      next_fetch_at  BIGINT NOT NULL DEFAULT 0
    );
  `);

  // 既存テーブルに列がない可能性があるので保険
  await pool.query(`ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS last_fetch_at BIGINT NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS next_fetch_at BIGINT NOT NULL DEFAULT 0;`);

  await pool.query(`
    INSERT INTO bot_state (id, last_posted_at, last_fetch_at, next_fetch_at)
    VALUES (1, 0, 0, 0)
    ON CONFLICT (id) DO NOTHING;
  `);

  // 投稿済み管理
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posted_tweets (
      tweet_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 候補キュー（検索結果を貯める）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_queue (
      tweet_id TEXT PRIMARY KEY,
      tweet_text TEXT NOT NULL,
      like_count INT NOT NULL DEFAULT 0,
      score DOUBLE PRECISION NOT NULL DEFAULT 0,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reserved_until TIMESTAMPTZ NULL,
      used_at TIMESTAMPTZ NULL
    );
  `);

  // 念のため（既存テーブル拡張）
  await pool.query(`ALTER TABLE candidate_queue ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ NULL;`);
  await pool.query(`ALTER TABLE candidate_queue ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ NULL;`);
}

export async function getState() {
  const r = await pool.query(
    `SELECT last_posted_at, last_fetch_at, next_fetch_at FROM bot_state WHERE id = 1`
  );

  const row = r.rows?.[0] || {};
  return {
    last_posted_at: Number(row.last_posted_at ?? 0),
    last_fetch_at: Number(row.last_fetch_at ?? 0),
    next_fetch_at: Number(row.next_fetch_at ?? 0),
  };
}

// patch形式で更新（渡されたものだけ更新）
export async function setState(patch = {}) {
  const lastPosted = patch.last_posted_at ?? null;
  const lastFetch = patch.last_fetch_at ?? null;
  const nextFetch = patch.next_fetch_at ?? null;

  await pool.query(
    `
    UPDATE bot_state
    SET
      last_posted_at = COALESCE($1, last_posted_at),
      last_fetch_at  = COALESCE($2, last_fetch_at),
      next_fetch_at  = COALESCE($3, next_fetch_at)
    WHERE id = 1
    `,
    [lastPosted, lastFetch, nextFetch]
  );
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

export async function getQueueSize() {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM candidate_queue WHERE used_at IS NULL`
  );
  return Number(r.rows?.[0]?.n ?? 0);
}

export async function enqueueCandidates(items = []) {
  if (!items.length) return 0;

  // まとめてINSERT（既存tweet_idは無視）
  const values = [];
  const params = [];
  let i = 1;

  for (const it of items) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(
      String(it.tweet_id),
      String(it.tweet_text),
      Number(it.like_count ?? 0),
      Number(it.score ?? 0)
    );
  }

  const sql = `
    INSERT INTO candidate_queue (tweet_id, tweet_text, like_count, score)
    VALUES ${values.join(",")}
    ON CONFLICT (tweet_id) DO NOTHING
  `;

  const r = await pool.query(sql, params);
  return r.rowCount ?? 0;
}

/**
 * 次の候補を「予約」して取り出す（同時実行でも二重取りしにくくする）
 * reserveSeconds: 予約の有効期限（秒）
 */
export async function claimNextCandidate(reserveSeconds = 900) {
  const r = await pool.query(
    `
    WITH c AS (
      SELECT tweet_id
      FROM candidate_queue
      WHERE used_at IS NULL
        AND (reserved_until IS NULL OR reserved_until < NOW())
      ORDER BY score DESC, fetched_at DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE candidate_queue q
    SET reserved_until = NOW() + ($1 || ' seconds')::interval
    FROM c
    WHERE q.tweet_id = c.tweet_id
    RETURNING q.tweet_id, q.tweet_text, q.like_count, q.score
    `,
    [Number(reserveSeconds)]
  );

  return r.rows?.[0] || null;
}

export async function releaseCandidate(tweetId) {
  await pool.query(
    `UPDATE candidate_queue SET reserved_until = NULL WHERE tweet_id = $1`,
    [String(tweetId)]
  );
}

export async function markCandidateUsed(tweetId) {
  await pool.query(
    `UPDATE candidate_queue SET used_at = NOW(), reserved_until = NULL WHERE tweet_id = $1`,
    [String(tweetId)]
  );
}
