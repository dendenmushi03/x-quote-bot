export function scoreTweet(t) {
  const m = t.public_metrics || {};
  const like = m.like_count ?? 0;
  const rt = m.retweet_count ?? 0;
  const reply = m.reply_count ?? 0;

  // 伸びやすさ重視（RTに重み）
  return like * 1 + rt * 2 + reply * 1.5;
}
