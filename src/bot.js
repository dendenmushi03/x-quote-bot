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
  return [
    `lang:${config.LANG}`,
    "-is:reply",
    "-is:retweet",
    `min_faves:${config.MIN_FAVES}`
  ].join(" ");
}

export async function runOnce() {
  const state = await getState();

  if (!canPost(state.last_posted_at)) {
    return { skipped: true, reason: "interval_not_reached", last_posted_at: state.last_posted_at };
  }

  const query = buildQuery();
  const tweets = await searchRecent({
    bearerToken: config.X_BEARER_TOKEN,
    query,
    maxResults: 50
  });

  const postedIdsSet = {
    has: async (id) => await hasPosted(id)
  };

  const candidates = [];
  for (const t of tweets) {
    if (!isCandidateTweet(t)) continue;
    if (!(await notPostedYet(t, postedIdsSet))) continue;

    const s = scoreTweet(t);
    if (s < config.SCORE_THRESHOLD) continue;

    candidates.push({ ...t, score: s });
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { skipped: true, reason: "no_candidates" };
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
      text: comment
    });

    await markPosted(t.id);
    await setState({ last_posted_at: Date.now() });

    posted.push({ id: t.id, score: t.score, comment });
    postedCount += 1;
  }

  return { skipped: postedCount === 0, posted };
}
