import { config } from "./config.js";
import { searchRecent, createQuotePost, XApiError } from "./xApi.js";
import { scoreTweet } from "./scoring.js";
import { isCandidateTweet, notPostedYet } from "./filters.js";
import {
  ensureSchema,
  getState,
  setState,
  hasPosted,
  markPosted,
  getQueueSize,
  enqueueCandidates,
  claimNextCandidate,
  releaseCandidate,
  markCandidateUsed,
} from "./db.js";
import { generateQuoteComment } from "./llm.js";

const CANDIDATE_POOL_MIN = Number(process.env.CANDIDATE_POOL_MIN || 10);      // キューがこれ未満なら補充を検討
const CANDIDATE_POOL_TARGET = Number(process.env.CANDIDATE_POOL_TARGET || 30); // 補充するときはこれくらい貯めたい
const FETCH_INTERVAL_SECONDS = Number(process.env.FETCH_INTERVAL_SECONDS || 21600); // 6h
const RESERVE_SECONDS = Number(process.env.RESERVE_SECONDS || 900); // 15分予約

function canPost(lastPostedAtMs) {
  const intervalMs = Number(config.POST_INTERVAL_SECONDS) * 1000;
  return Date.now() - Number(lastPostedAtMs || 0) >= intervalMs;
}

function buildQuery() {
  // Recent Searchは「演算子だけ」だと弾かれるので、超頻出の日本語1文字を入れる
  const seed = (config.SEED_TERM || "の").trim() || "の";
  return [`(${seed})`, `lang:${config.LANG}`, "-is:reply", "-is:retweet"].join(" ");
}

function getLikeCount(t) {
  return Number(t?.public_metrics?.like_count ?? 0);
}

function is429(e) {
  return e instanceof XApiError && Number(e.status) === 429;
}

async function tryFetchAndEnqueue(query, postedIdsSet) {
  const tweets = await searchRecent({
    bearerToken: config.X_BEARER_TOKEN,
    query,
    maxResults: 50,
  });

  const candidates = [];
  for (const t of tweets) {
    if (!isCandidateTweet(t)) continue;
    if (!(await notPostedYet(t, postedIdsSet))) continue;

    if (getLikeCount(t) < Number(config.MIN_FAVES || 0)) continue;

    const s = scoreTweet(t);
    if (s < Number(config.SCORE_THRESHOLD || 0)) continue;

    candidates.push({
      tweet_id: t.id,
      tweet_text: t.text,
      like_count: getLikeCount(t),
      score: s,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  // 補充する回は “多め” に入れておく（次回以降の投稿に回す）
  const toInsert = candidates.slice(0, Math.max(CANDIDATE_POOL_TARGET, 1));
  const inserted = await enqueueCandidates(toInsert);

  return { inserted, found: candidates.length };
}

async function postFromCandidate(candidate) {
  const comment = await generateQuoteComment(candidate.tweet_text);
  if (!comment || comment.length < 8) {
    // 文章生成が弱いときはこの候補を消費しない（次の候補へ）
    await releaseCandidate(candidate.tweet_id);
    return { skipped: true, reason: "comment_too_short" };
  }

  await createQuotePost({
    userAccessToken: config.X_USER_ACCESS_TOKEN,
    quoteTweetId: candidate.tweet_id,
    text: comment,
  });

  await markCandidateUsed(candidate.tweet_id);
  await markPosted(candidate.tweet_id);
  await setState({ last_posted_at: Date.now() });

  return {
    skipped: false,
    posted: {
      id: candidate.tweet_id,
      score: candidate.score,
      likes: candidate.like_count,
      comment,
    },
  };
}

export async function runOnce() {
  await ensureSchema();

  const state = await getState();

  // Cronは2時間に1回想定だが、手動実行でも暴発しないように残す
  if (!canPost(state.last_posted_at)) {
    return {
      skipped: true,
      reason: "interval_not_reached",
      last_posted_at: state.last_posted_at,
    };
  }

  const query = buildQuery();
  const postedIdsSet = { has: async (id) => await hasPosted(id) };

  // 1) まずキューから投稿（検索しない）
  for (let guard = 0; guard < 5; guard++) {
    const cand = await claimNextCandidate(RESERVE_SECONDS);
    if (!cand) break;

    // もし既に投稿済みならキューから消費して次へ
    if (await hasPosted(cand.tweet_id)) {
      await markCandidateUsed(cand.tweet_id);
      continue;
    }

    try {
      const r = await postFromCandidate(cand);
      if (!r.skipped) {
        return { skipped: false, reason: "posted_from_queue", query, posted: [r.posted] };
      }
      // comment_too_shortなどは次の候補へ
      continue;
    } catch (e) {
      if (is429(e)) {
        // 投稿側で429（まれにある）
        await releaseCandidate(cand.tweet_id);
        return {
          skipped: true,
          reason: "rate_limited_post",
          retry_after_ms: e.retryAfterMs ?? null,
          query,
        };
      }
      await releaseCandidate(cand.tweet_id);
      throw e;
    }
  }

  // 2) キューが空なら “条件を満たすときだけ” 検索して補充
  const qsize = await getQueueSize();
  const now = Date.now();

  const canFetchByInterval = now - state.last_fetch_at >= FETCH_INTERVAL_SECONDS * 1000;
  const canFetchByBackoff = now >= Number(state.next_fetch_at || 0);
  const shouldFetch = qsize < CANDIDATE_POOL_MIN && canFetchByBackoff && canFetchByInterval;

  if (!shouldFetch) {
    return {
      skipped: true,
      reason: qsize > 0 ? "queue_has_items_but_no_post" : "queue_empty_waiting_fetch_window",
      queue_size: qsize,
      query,
      next_fetch_at: state.next_fetch_at,
    };
  }

  try {
    const { inserted, found } = await tryFetchAndEnqueue(query, postedIdsSet);
    await setState({ last_fetch_at: now, next_fetch_at: 0 });

    // 補充できたら、もう一度キューから投稿を試す
    const cand = await claimNextCandidate(RESERVE_SECONDS);
    if (!cand) {
      return { skipped: true, reason: "no_candidates", found, inserted, query };
    }

    try {
      const r = await postFromCandidate(cand);
      if (!r.skipped) {
        return { skipped: false, reason: "posted_after_fetch", found, inserted, query, posted: [r.posted] };
      }
      return { skipped: true, reason: r.reason, found, inserted, query };
    } catch (e) {
      if (is429(e)) {
        await releaseCandidate(cand.tweet_id);
        return { skipped: true, reason: "rate_limited_post", retry_after_ms: e.retryAfterMs ?? null, query };
      }
      await releaseCandidate(cand.tweet_id);
      throw e;
    }
  } catch (e) {
    if (is429(e)) {
      const retry = e.retryAfterMs ?? 15 * 60 * 1000;
      await setState({ next_fetch_at: now + retry });
      return {
        skipped: true,
        reason: "rate_limited_search",
        retry_after_ms: retry,
        query,
      };
    }
    throw e;
  }
}
