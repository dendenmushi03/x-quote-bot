/**
 * X API v2
 * - Recent Search: GET /2/tweets/search/recent
 * - Create Post:  POST /2/tweets
 *
 * 注意:
 * - X APIはプランによって検索演算子が制限される（例: min_faves は多くのプランで不可）
 * - このファイルでは「失敗を分かりやすく」「軽いリトライ」「タイムアウト」を入れて安定化
 */

const API_BASE = process.env.X_API_BASE || "https://api.x.com";

// 本番運用向け：最低限のタイムアウト（ms）
const DEFAULT_TIMEOUT_MS = Number(process.env.X_API_TIMEOUT_MS || 15000);

// プラン差分で落ちやすい検索演算子を事前に弾く（※必要なら増やしてOK）
function validateQueryForPlan(query) {
  const blocked = ["min_faves:", "min_retweets:", "min_replies:"];
  const hit = blocked.find(op => query.includes(op));
  if (hit) {
    throw new Error(
      `Query contains unsupported operator "${hit}". Remove it from query. query="${query}"`
    );
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function readJsonSafely(res) {
  // 失敗時に text のこともあるので安全に
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Recent Search
 * @param {object} params
 * @param {string} params.bearerToken App bearer token
 * @param {string} params.query X search query
 * @param {number} [params.maxResults=50] 10..100
 * @returns {Array} tweets
 */
export async function searchRecent({ bearerToken, query, maxResults = 50 }) {
  if (!bearerToken) throw new Error("searchRecent: bearerToken is required");
  if (!query || !query.trim()) throw new Error("searchRecent: query is required");

  validateQueryForPlan(query);

  const url = new URL(`${API_BASE}/2/tweets/search/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(Math.min(Math.max(maxResults, 10), 100)));
  // 必要最低限。必要ならここに追加（author_id 等）
  url.searchParams.set("tweet.fields", "public_metrics,created_at,lang");

  const headers = {
    Authorization: `Bearer ${bearerToken}`,
    "User-Agent": "x-quote-bot/1.0"
  };

  // 429/5xx で1回だけ待ってリトライ（無料運用想定）
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchWithTimeout(url, { headers, method: "GET" });

    if (res.ok) {
      const json = await readJsonSafely(res);
      return json.data || [];
    }

    const json = await readJsonSafely(res);

    // Rate limit / transient
    const isRetryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
    if (isRetryable && attempt === 0) {
      const retryAfter = Number(res.headers.get("retry-after") || 2);
      await sleep(Math.min(Math.max(retryAfter, 1), 10) * 1000);
      continue;
    }

    throw new Error(`searchRecent failed: ${res.status} ${JSON.stringify(json)}`);
  }

  return [];
}

/**
 * Create Quote Tweet
 * @param {object} params
 * @param {string} params.userAccessToken OAuth2 user access token
 * @param {string} params.quoteTweetId tweet id to quote
 * @param {string} params.text post text
 */
export async function createQuotePost({ userAccessToken, quoteTweetId, text }) {
  if (!userAccessToken) throw new Error("createQuotePost: userAccessToken is required");
  if (!quoteTweetId) throw new Error("createQuotePost: quoteTweetId is required");
  if (!text || !text.trim()) throw new Error("createQuotePost: text is required");

  const res = await fetchWithTimeout(`${API_BASE}/2/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "x-quote-bot/1.0"
    },
    body: JSON.stringify({
      text,
      quote_tweet_id: quoteTweetId
    })
  });

  const json = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error(`createQuotePost failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}
