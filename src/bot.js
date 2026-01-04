import { config } from "./config.js";
import { searchRecent, createQuotePost } from "./xApi.js";
import { scoreTweet } from "./scoring.js";
import { isCandidateTweet, notPostedYet } from "./filters.js";
import { getState, setState, hasPosted, markPosted } from "./db.js";
import { generateQuoteComment } from "./llm.js";

function canPost(lastPostedAtMs) {
  const intervalMs = Number(config.POST_INTERVAL_SECONDS || 7200) * 1000;
  return Date.now() - Number(lastPostedAtMs || 0) >= intervalMs;
}

function buildQuery() {
  // Recent Searchは「演算子だけ」だと弾かれるので、超頻出の日本語1文字を入れる
  const seed = (config.SEED_TERM || "の").trim() || "の";

  return [
    `(${seed})`,
    `lang:${config.LANG}`,
    "-is:reply",
    "-is:retweet",
  ].join(" ");
}

function getLikeCount(t) {
  return Number(t?.public_metrics?.like_count ?? 0);
}

export async function runOnce() {
  const state = await getState();

  // 2時間に1回「投稿を試す」(チェックだけで連打しない)
  if (!canPost(state.last_posted_at)) {
    return {
      skipped: true,
      reason: "interval_not_reached",
      last_posted_at: state.last_posted_at,
    };
  }

  const query = buildQuery();

  let tweets = [];
  try {
    tweets = await searchRecent({
      bearerToken: config.X_BEARER_TOKEN,
      query,
      maxResults: 50,
    });
  } catch (e) {
    // 429 は正常スキップ（次回に回す）
    if (e?.code === "RATE_LIMITED" || e?.status === 429) {
      return {
        skipped: true,
        reason: "rate_limited",
        retry_after_ms: e.retryAfterMs ?? null,
        query,
      };
    }
    throw e;
  }

  const postedIdsSet = {
    has: async (id) => await hasPosted(id),
  };

  const candidates = [];
  for (const t of tweets) {
    if (!isCandidateTweet(t)) continue;
    if (!(await notPostedYet(t, postedIdsSet))) continue;

    // MIN_FAVES は検索演算子じゃなくてここで足切り
    if (getLikeCount(t) < Number(config.MIN_FAVES || 0)) continue;

    const s = scoreTweet(t);
    if (s < Number(config.SCORE_THRESHOLD || 0)) continue;

    candidates.push({ ...t, score: s });
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    // 候補が無い場合も「今回投稿を試した」扱いにして2時間待つ
    await setState({ last_posted_at: Date.now() });
    return { skipped: true, reason: "no_candidates", query };
  }

  let postedCount = 0;
  const posted = [];

  for (const t of candidates) {
    if (postedCount >= Number(config.MAX_POSTS_PER_RUN || 1)) break;

    const comment = await generateQuoteComment(t.text);
    if (!comment || comment.length < 8) continue;

    await createQuotePost({
      userAccessToken: config.X_USER_ACCESS_TOKEN,
      quoteTweetId: t.id,
      text: comment,
    });

    await markPosted(t.id);

    posted.push({
      id: t.id,
      score: t.score,
      likes: getLikeCount(t),
      comment,
    });

    postedCount += 1;

    // 成功したらタイムスタンプ更新（次回は2時間後）
    await setState({ last_posted_at: Date.now() });
  }

  // 1件も投稿できなかった場合も「試行した」扱いにして2時間待つ
  if (postedCount === 0) {
    await setState({ last_posted_at: Date.now() });
  }

  return { skipped: postedCount === 0, postedCount, query, posted };
}
