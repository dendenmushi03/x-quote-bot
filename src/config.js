import "dotenv/config";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function num(name, def) {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number env: ${name}`);
  return n;
}

export const config = {
  X_BEARER_TOKEN: must("X_BEARER_TOKEN"),
  X_USER_ACCESS_TOKEN: must("X_USER_ACCESS_TOKEN"),

  OPENAI_API_KEY: must("OPENAI_API_KEY"),

  DATABASE_URL: must("DATABASE_URL"),
  RUN_KEY: must("RUN_KEY"),

  POST_INTERVAL_SECONDS: num("POST_INTERVAL_SECONDS", 7200),
  MAX_POSTS_PER_RUN: num("MAX_POSTS_PER_RUN", 1),

  MIN_FAVES: num("MIN_FAVES", 800),
  LANG: process.env.LANG || "ja",
  SCORE_THRESHOLD: num("SCORE_THRESHOLD", 3500)
};
