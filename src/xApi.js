/**
 * X API v2
 * - Recent Search: GET /2/tweets/search/recent
 * - Create Post:  POST /2/tweets
 */

const API_BASE = "https://api.x.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getRetryAfterMs(res) {
  // 1) Retry-After (seconds)
  const ra = res.headers.get("retry-after");
  if (ra) {
    const sec = Number(ra);
    if (!Number.isNaN(sec) && sec > 0) return sec * 1000;
  }

  // 2) X rate limit reset (epoch seconds)
  const reset = res.headers.get("x-rate-limit-reset");
  if (reset) {
    const resetSec = Number(reset);
    if (!Number.isNaN(resetSec) && resetSec > 0) {
      const waitMs = resetSec * 1000 - Date.now();
      // バッファ2秒
      return Math.max(waitMs + 2000, 5000);
    }
  }

  // 3) fallback
  return 60_000;
}

/**
 * 重要:
 * - 429は「待ってリトライ」しない（＝この1回は諦める）
 * - それでも必要なら 1回だけ待って再試行、みたいにしてOKだが、
 *   今は安定優先でスキップ運用が一番強い
 */
async function fetchJsonOnce(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body });

  let json = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    json = await res.json().catch(() => null);
  } else {
    const text = await res.text().catch(() => "");
    json = { text };
  }

  if (res.status === 429) {
    const retryAfterMs = getRetryAfterMs(res);
    const err = new Error(`X API rate limited (429). retry_after_ms=${retryAfterMs}`);
    err.code = "RATE_LIMITED";
    err.retryAfterMs = retryAfterMs;
    err.response = json;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`X API failed: ${res.status} ${JSON.stringify(json)}`);
    err.code = "X_API_ERROR";
    err.status = res.status;
    err.response = json;
    throw err;
  }

  return json;
}

export async function searchRecent({ bearerToken, query, maxResults = 50 }) {
  const url = new URL(`${API_BASE}/2/tweets/search/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(Math.min(maxResults, 100)));
  url.searchParams.set("tweet.fields", "public_metrics,created_at,lang");

  const json = await fetchJsonOnce(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  return json.data || [];
}

export async function createQuotePost({ userAccessToken, quoteTweetId, text }) {
  const json = await fetchJsonOnce(`${API_BASE}/2/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      quote_tweet_id: quoteTweetId,
    }),
  });

  return json;
}
