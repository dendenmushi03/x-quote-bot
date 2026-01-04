/**
 * X API v2
 * - Recent Search: GET /2/tweets/search/recent
 * - Create Post:  POST /2/tweets
 */

const API_BASE = "https://api.x.com";

export class XApiError extends Error {
  constructor(message, { status, body, retryAfterMs } = {}) {
    super(message);
    this.name = "XApiError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;

    // ★追加：bot.js 側で判定しやすいようにする
    this.code = status === 429 ? "RATE_LIMITED" : "X_API_ERROR";
  }
}

function parseRetryAfterMs(res) {
  // 1) Retry-After: seconds
  const ra = res.headers.get("retry-after");
  if (ra && /^\d+$/.test(ra)) return Number(ra) * 1000;

  // 2) x-rate-limit-reset: unix seconds
  const reset = res.headers.get("x-rate-limit-reset");
  if (reset && /^\d+$/.test(reset)) {
    const resetMs = Number(reset) * 1000;
    const diff = resetMs - Date.now();
    if (diff > 0) return diff;
  }

  return null;
}

async function fetchJson(method, url, { token, body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
  };

  if (body != null) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // JSONじゃない場合もあるので握りつぶす
  }

  if (!res.ok) {
    const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res) : null;
    throw new XApiError(`X API failed: ${res.status}`, {
      status: res.status,
      body: json,
      retryAfterMs,
    });
  }

  return json;
}

export async function searchRecent({ bearerToken, query, maxResults = 50 }) {
  const url = new URL(`${API_BASE}/2/tweets/search/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(Math.min(maxResults, 100)));
  url.searchParams.set("tweet.fields", "public_metrics,created_at,lang");

  const json = await fetchJson("GET", url.toString(), { token: bearerToken });
  return json?.data || [];
}

export async function createQuotePost({ userAccessToken, quoteTweetId, text }) {
  const json = await fetchJson("POST", `${API_BASE}/2/tweets`, {
    token: userAccessToken,
    body: { text, quote_tweet_id: quoteTweetId },
  });
  return json;
}
