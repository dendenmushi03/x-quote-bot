import { config } from "./config.js";
import { searchRecent, createQuotePost } from "./xApi.js";
import { scoreTweet } from "./scoring.js";
import { isCandidateTweet, notPostedYet } from "./filters.js";
import { getState, setState, hasPosted, markPosted } from "./db.js";
import { generateQuoteComment } from "./llm.js";

function canPost(lastPostedAtMs) {
  const intervalMs = config.POST_INTERVAL_SECONDS * 1000;
  return Date.now() - lastPostedAtMs >= intervalMs;
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
    // 429は「今回は諦めて次回」運用にする（連打しない）
    if (e?.code === "RATE_LIMITED") {
      return {
        skipped: true,
        reason: "rate_limited",
        retry_after_ms: e.retryAfterMs,
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

    // ★MIN_FAVESは検索演算子じゃなくてここで足切り
    if (getLikeCount(t) < Number(config.MIN_FAVES || 0)) continue;

    const s = scoreTweet(t);
    if (s < config.SCORE_THRESHOLD) continue;

    candidates.push({ ...t, score: s });
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { skipped: true, reason: "no_candidates", query };
  }

  let postedCount = 0;
  const posted = [];

  for (const t of candidates) {
    if (postedCount >= config.MAX_POSTS_PER_RUN) break;

    const comment = await generateQuoteComment(t.text);
    if (!comment || comment.length < 8) continue;

    await createQuotePost({
      userAccessToken: config.X_USER_ACCESS_TOKEN,
      quoteTweetId: t.id,
      text: comment,
    });

    // ★成功したときだけ更新
    await setState({ last_posted_at: Date.now() });

    await markPosted(t.id);

    posted.push({
      id: t.id,
      score: t.score,
      likes: getLikeCount(t),
      comment,
    });

    postedCount += 1;
  }

  return { skipped: postedCount === 0, postedCount, query, posted };
}
