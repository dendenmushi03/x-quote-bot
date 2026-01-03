# x-quote-bot

Xのバズ投稿を API で拾い、2時間に1回だけ引用ポスト（Quote）します。

## 前提
- Node.js 18+
- X Developer / X API v2 アクセス
- LLMキー（OpenAI例）

## セットアップ
1) `npm i`
2) `.env.example` を `.env` にコピーして埋める
3) `npm run start`

## 注意
- 自動Quoteは許容されますが、乱発・同文連投・攻撃的運用は危険です。
- 本プロジェクトは 1回の実行で最大1件、最短2時間間隔のガードを入れています。
