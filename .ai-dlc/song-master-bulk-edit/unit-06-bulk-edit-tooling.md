---
status: in_progress
last_updated: ""
depends_on: [unit-01-difficulty-attribute, unit-03-import-difficulty, unit-05-difficulty-reference-data]
branch: ai-dlc/song-master-bulk-edit/06-bulk-edit-tooling
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-06-bulk-edit-tooling

## Description
全曲・曲マスタ全編集項目を Google Sheets で一括編集するためのツール一式：編集用 xlsx 生成スクリプトと、編集後 xlsx→songs.csv 変換スクリプト、テスト、手順書。人の編集面（ラベル＋ドロップダウン、コード暗記不要）とシステム取り込み面（CSV）を分離する。

## Discipline
backend - Node/tsx スクリプト（exceljs）と CLI ツール。

## Domain Entities
- **Song** の全編集項目（difficulty 含む / simpleForm 除外）。
- **難易度叩き台**（unit-05 の参照データ）を黒本1曲に突合して参考列付与。

## Data Sources
- 現在値ソース: `docs/やれる曲.xlsx` [list]（主経路, A列曲名・O列#1=■=黒本1）と 現行DB（`getDb()`/`DATABASE_PATH`, 副経路）。
- インポート列定義: unit-03 の SONGS_HEADER / import 検証（列順・トークンを共有）。
- 参照データ: unit-05 の `docs/reference/kurobon1-difficulty.*`。
- 正規化: `src/lib/normalize-title.ts`。
- exceljs（devDependency, 既存）。

## Technical Specification
### A. 生成スクリプト `scripts/master-export.ts`
- 全曲を出力（[list] 主・`getDb()` 対応。ソースは引数/環境で切替）。
- 左側 = **songs.csv インポート互換の編集列**（difficulty 含む / simple_form 除外）。人が読めるラベル＋データ検証ドロップダウン:
  - form → 「AABA / ABAC / ブルース(12小節) / その他」
  - season → 「春 / 夏 / 秋 / 冬 / 通年」
  - 真偽（has_played/no_chart_ok/is_standard/in_kurobon1）→ 「✓ / 空」
  - listener_level / energy_level / **difficulty** → 1–5 ドロップダウン（difficulty は「未設定」も可）
  - ジャンル（9種）→ 9 列の「✓」（見出し=ジャンル名）
  - **title → 保護**（ロック/背景色で視覚的に区別。照合キー）
- 右側 = **参考列（インポート対象外）**: `演奏難易度(叩き台)` / `難易度コメント` / `攻め方の目安`。黒本1曲に normalizeTitle 突合で付与（非黒本1は空）。
- Google Sheets へアップロードしてもデータ検証（ドロップダウン）が保持される xlsx 形式で出力。

### B. 変換スクリプト `scripts/master-xlsx-to-csv.ts`
- 編集後 xlsx の**左側編集列のみ**を読み、ラベル→コードを解決して songs.csv（unit-03 の列定義）を出力。参考列・9列✓ジャンルを genres パイプ列へ合成。
- 不正値（未知ラベル・範囲外 difficulty/level・未知ジャンル・title 改変検出）は**行番号付きで検出して中断**（黙って壊さない）。
- 出力 songs.csv は既存インポートウィザードでそのまま取り込める。

### C. テスト
- ラベル↔コード写像（form/season/真偽/level/difficulty/genres）の往復一致。
- 不正値・範囲外・未知ジャンルのエラー検出。
- 未編集項目が往復で不変（データ整合性）。

### D. 手順書 `docs/reference/master-edit-workflow.md`
- 生成 → Google Drive アップロード → Sheets 編集（ドロップダウン/9列✓, title 触らない, 参考列を見て difficulty/is_standard 等を判定）→ ダウンロード → 変換 → インポートウィザードで全曲更新、の一連手順。
- difficulty 未判定(null) 曲を早めに埋める運用メモ（unit-02 の初心者対応で除外されるため）。

## Success Criteria
- [ ] `scripts/master-export.ts` が全曲・全編集項目（difficulty 含む/simple_form 除外）を現在値で事前入力した xlsx を出力し、Google Sheets でドロップダウンが機能、title が保護される。
- [ ] 黒本1曲に難易度叩き台・コメント・攻め方目安の参考列が normalizeTitle 突合で付与される（非黒本1は空、参考列はインポート対象外）。
- [ ] `scripts/master-xlsx-to-csv.ts` が編集後 xlsx をラベル→コード解決して songs.csv を生成し、不正値を行番号付きで検出・中断する。
- [ ] 生成 songs.csv を既存インポートで取り込むと title 一致で全曲更新される（difficulty 含む）。
- [ ] 変換ロジックのユニットテストが緑、往復でデータが不変。
- [ ] 手順書が整備されている。

## Risks
- **Sheets のデータ検証保持**: xlsx のデータ検証が Sheets インポートで失われる可能性。→ 緩和: exceljs の dataValidation を用い、代表項目で Sheets 取り込み後もドロップダウンが出ることを手順書に確認手順として明記。
- **列契約の不一致（unit-03 と）**: SONGS_HEADER 変更に追随できないと往復破綻。→ 緩和: import 側の列定義を import して単一真実源にする。
- **突合漏れ**: 参照データと曲名の綴り差。→ 緩和: normalizeTitle で正規化、未突合は空欄＋件数レポート（silent drop しない）。

## Boundaries
- difficulty 型/スキーマは unit-01、インポート列は unit-03、難易度収集は unit-05。
- 本ユニットは「編集用 xlsx 生成 / xlsx→csv 変換 / テスト / 手順書」。エンジン・編集画面は扱わない。

## Notes
- title 保護・9列✓・ドロップダウンは「コード暗記不要」というユーザー要件の中核。実装時は Sheets での見え方を優先。
- 生成の主経路は [list]（ローカルDB不在のため）。DB 経路は `DATABASE_PATH` 指定で同一出力になるよう共通化。
