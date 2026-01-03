import { config } from "./config.js";

/**
 * OpenAIで引用コメント生成（40文字以内、煽り/勧誘なし）
 * ※モデルはコストと品質のバランスで適宜変更してOK
 */
export async function generateQuoteComment(originalText) {
  const prompt = `
以下のX投稿を引用するための日本語コメントを1文生成してください。

条件：
・40文字以内
・感想、気づき、補足のいずれか
・煽り、命令、勧誘は禁止
・自然な口語（です/ます でもOK）
・投稿の内容をコピペしない（言い換える）
・絵文字は0〜1個まで

投稿内容：
「${originalText}」
`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.9,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`OpenAI error: ${res.status} ${JSON.stringify(json)}`);
  }

  const out = (json.choices?.[0]?.message?.content || "").trim();
  // 最終ガード
  return out.slice(0, 60);
}
