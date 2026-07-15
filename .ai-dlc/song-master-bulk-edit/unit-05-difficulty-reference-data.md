---
status: pending
last_updated: ""
depends_on: []
branch: ai-dlc/song-master-bulk-edit/05-difficulty-reference-data
discipline: documentation
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-05-difficulty-reference-data

## Description
外部参照 thetrumpetschool.com「ジャズスタンダードバイブル トランペットで全部」全45記事から、黒本1各曲の演奏難易度（9段階）とコメントを収集し、9段階→1-5 の写像を付与した参照データ資産を生成する。この資産は unit-06（一括編集ツール）が参考列の事前入力に使う。

## Discipline
documentation - 外部情報の収集・構造化（データ資産）。

## Domain Entities
- 参照曲（黒本1相当, 約225曲）。曲名は正規化して本アプリ曲名と突合可能にする（`src/lib/normalize-title.ts` の normalizeTitle）。

## Data Sources
- カテゴリ: https://thetrumpetschool.com/category/ジャズスタンダードバイブル-トランペットで全部/
- 記事URL例: https://thetrumpetschool.com/2020/01/14/jazz-standard-bible45/ （#37-#45 のURLは既知。#1-#36 はカテゴリのページ送り `.../page/N/` で発見）。
- 各記事: 約5曲・アルファベット順。難易度表記 = 初級- / 初級 / 初級+ / 中級- / 中級 / 中級+ / 上級- / 上級 / 上級+。

## Technical Specification
1. **URL 収集**: カテゴリのページ送りで #1〜#45 の全記事URLを列挙。
2. **フェッチ&抽出**: 各記事から (曲名(英語), 難易度9段階, 一言コメント) を抽出。
3. **写像**: 9段階→difficulty(1-5)。既定案: 初級-/初級=1, 初級+/中級-=2, 中級=3, 中級+/上級-=4, 上級/上級+=5（planner が確定・intent の Data Gaps 参照）。原文9段階も保持。
4. **正規化キー**: 各曲名に normalizeTitle を適用した `titleNormalized` を付与（突合用）。
5. **出力**: リポジトリにコミットする参照データファイル（例 `docs/reference/kurobon1-difficulty.tsv` または `.json`）。列: raw_title, title_normalized, level_9（原文）, difficulty_1_5, comment, article_no。
6. **網羅性メモ**: 記事で扱われなかった曲・突合不能曲は明示（silent drop しない）。件数を記録。

## Success Criteria
- [ ] #1〜#45 の全記事を対象に、各曲の (曲名, 9段階難易度, コメント) が抽出されている（取得不能記事は明示）。
- [ ] 9段階→1-5 の写像列と、normalizeTitle による突合キー列がある。
- [ ] 参照データファイルがリポジトリにコミットされ、unit-06 から読める形式（TSV/JSON）。
- [ ] 網羅件数・未取得/未突合の件数が記録されている。

## Risks
- **サイト構造変化・取得漏れ**: 45記事の一括取得で失敗や欠落。→ 緩和: 記事ごとに件数を検証し、欠落を明示ログ。再取得可能に。
- **曲名表記ゆれ**: 参照サイトと本アプリで綴りが異なる。→ 緩和: normalizeTitle で正規化し、突合は unit-06 側で行う（本ユニットは正規化キー付与まで）。

## Boundaries
- 本アプリ曲名との実突合・xlsx への配置は unit-06。
- difficulty のマスタ登録・エンジン利用は unit-01/02。
- 本ユニットは「外部難易度の収集と構造化データ生成」まで。

## Notes
- 曲名は本アプリのデータを正とするため、参照データは「候補値」。最終的な曲名一致判定は unit-06 の突合ロジックで行う。
- フェッチは45記事と多い。実行時は失敗時リトライ・件数検証を組み込む。
