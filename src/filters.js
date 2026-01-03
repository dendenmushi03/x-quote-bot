/**
 * 「燃えそう/センシティブ/勧誘臭」を雑に除外（保守的に）
 * 運用しながら随時調整推奨
 */
const NG_WORDS = [
  "死", "殺", "自殺", "事故", "炎上", "晒し", "誹謗中傷",
  "選挙", "政党", "宗教",
  "裏垢", "エロ", "無修正",
  "稼げる", "副業", "投資サロン", "LINE追加"
];

export function isSafeText(text) {
  return !NG_WORDS.some(w => text.includes(w));
}

export function looksLikeSpam(text) {
  // URL乱発や、短すぎ、記号だらけなど
  const urlCount = (text.match(/https?:\/\//g) || []).length;
  if (urlCount >= 2) return true;
  if (text.trim().length < 12) return true;
  if ((text.match(/[#＃]/g) || []).length >= 6) return true;
  return false;
}

export function isCandidateTweet(t) {
  const text = t.text || "";
  if (!isSafeText(text)) return false;
  if (looksLikeSpam(text)) return false;
  return true;
}

export async function notPostedYet(t, postedIdsSet) {
  return !(await postedIdsSet.has(t.id));
}
