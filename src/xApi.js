/**
 * X API v2
 * - Recent Search: GET /2/tweets/search/recent
 * - Create Post:  POST /2/tweets
 */

const API_BASE = "https://api.x.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRateLimitResetMs(res) {
  // x-rate-limit-reset is epoch seconds (commonly)
  const reset = res.headers.get("x-rate-limit-reset");
  if (!reset) return null;
  const sec = Number(reset);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const ms = sec * 1000;
  // add small buffer
  return Math.max(0, ms - Date.now() + 1500);
}

async function fetchJsonWithRetry(url, options, { maxRetries = 4 } = {}) {
  let attempt = 0;

  while (true) {
    const res = await fetch(url, options);

    // success
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return { res, json };
    }

    // error body (best effort)
    const json = await res.json().catch(() => ({}));

    const status = res.status;
    const shouldRetry = status === 429 || (status >= 500 && status <= 599);

    if (!shouldRetry || attempt >= maxRetries) {
      const msg =
        json?.title || json?.detail || JSON.stringify(json) || "unknown error";
      throw new Error(
        `X API failed: ${status} ${msg}`
      );
    }

    // wait (rate-limit reset preferred)
    const resetWait = parseRateLimitResetMs(res);
    const backoff = Math.min(30_000, 1000 * Math.pow(2, attempt)); // 1s,2s,4s,8s...
    const jitter = Math.floor(Math.random() * 500);
    const waitMs = resetWait != null ? Math.min(resetWait, 60_000) : backoff + jitter;

    await sleep(waitMs);
    attempt += 1;
  }
}

export async function searchRecent({ bearerToken, query, maxResults = 50 }) {
  const url = new URL(`${API_BASE}/2/tweets/search/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(Math.min(maxResults, 100)));
  url.searchParams.set("tweet.fields", "public_metrics,created_at,lang");

  const { json } = await fetchJsonWithRetry(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  return json.data || [];
}

export async function createQuotePost({ userAccessToken, quoteTweetId, text }) {
  const { json } = await fetchJsonWithRetry(`${API_BASE}/2/tweets`, {
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
