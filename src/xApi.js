/**
 * X API v2
 * - Recent Search: GET /2/tweets/search/recent
 * - Create Post:  POST /2/tweets
 * 公式: docs.x.com :contentReference[oaicite:1]{index=1}
 */

const API_BASE = "https://api.x.com";

export async function searchRecent({ bearerToken, query, maxResults = 50 }) {
  const url = new URL(`${API_BASE}/2/tweets/search/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(Math.min(maxResults, 100)));
  url.searchParams.set("tweet.fields", "public_metrics,created_at,lang");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` }
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`searchRecent failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data || [];
}

export async function createQuotePost({ userAccessToken, quoteTweetId, text }) {
  const res = await fetch(`${API_BASE}/2/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      quote_tweet_id: quoteTweetId
    })
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`createQuotePost failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}
