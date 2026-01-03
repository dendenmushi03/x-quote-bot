/**
 * 「燃えそう/センシティブ/勧誘臭」を保守的に除外
 * - 運用しながらNGワードや条件は調整推奨
 * - 全角/半角・大小・空白の揺れに少し強くする
 */

const NG_WORDS = [
  "死", "殺", "自殺", "事故", "炎上", "晒し", "誹謗中傷",
  "選挙", "政党", "宗教",
  "裏垢", "エロ", "無修正",
  "稼げる", "副業", "投資サロン", "line追加", "ライン追加", "dmください"
];

// 正規化（NFKCで全角→半角、余計な空白削除、lower化）
function normalizeText(text) {
  return (text || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isSafeText(text) {
  const t = normalizeText(text);
  return !NG_WORDS.some(w => t.includes(w));
}

export function looksLikeSpam(text) {
  const raw = text || "";
  const t = normalizeText(raw);

  // URL乱発
  const urlCount = (raw.match(/https?:\/\//g) || []).length;
  if (urlCount >= 2) return true;

  // 短すぎ
  if (t.length < 12) return true;

  // ハッシュタグだらけ
  if ((raw.match(/[#＃]/g) || []).length >= 6) return true;

  // メンションだらけ（軽いスパム臭）
  if ((raw.match(/@/g) || []).length >= 4) return true;

  // 同一記号の連打
  if (/(w{6,}|！{4,}|!{4,}|？{4,}|\?{4,}|…{6,})/i.test(raw)) return true;

  return false;
}

export function isCandidateTweet(t) {
  const text = t?.text || "";
  if (!text.trim()) return false;

  // ここでは「内容の安全性」だけに集中
  if (!isSafeText(text)) return false;
  if (looksLikeSpam(text)) return false;

  return true;
}

/**
 * postedIdsSet が
 * - 普通の Set
 * - あるいは { has: async (id) => boolean } のような実装
 * どちらでも動くようにする
 */
export async function notPostedYet(t, postedIdsSet) {
  const id = t?.id;
  if (!id) return false;
  if (!postedIdsSet || typeof postedIdsSet.has !== "function") return true;

  const result = postedIdsSet.has(id);
  const already = result instanceof Promise ? await result : result;
  return !already;
}
