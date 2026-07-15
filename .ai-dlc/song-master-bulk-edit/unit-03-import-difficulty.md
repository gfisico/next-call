---
status: pending
last_updated: ""
depends_on: [unit-01-difficulty-attribute]
branch: ai-dlc/song-master-bulk-edit/03-import-difficulty
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-03-import-difficulty

## Description
CSV インポート（unit-08 由来）の songs 列定義に `difficulty` を追加し、`simple_form` を撤去する。既存の初回移行スクリプト `scripts/extract-excel.ts` の SONGS_HEADER も同期する。

## Discipline
backend - インポートの検証・コミット・CSV スキーマ。

## Domain Entities
- **Song** の CSV 表現（songs.csv）。`difficulty` 列を追加、`simple_form` 列を撤去。

## Data Sources
- `src/server/validation/import.ts`（:24 列一覧, :220 csvBoolean("simple_form"), :236 マッピング）。
- `src/server/import/preview.ts` / `commit.ts` / `dry-run.ts`。
- `scripts/extract-excel.ts:200-215`（SONGS_HEADER）。
- 既存テスト: `tests/scripts/extract-excel.test.ts`, インポート系テスト。

## Technical Specification
1. **import 検証** (`src/server/validation/import.ts`): songs 列一覧から `simple_form` を削除し `difficulty` を追加。パース: `difficulty` は空欄=null、それ以外は整数 1–5（範囲外はエラー行として報告）。マッピング（row→song 属性）に `difficulty` を追加、`simple_form` を削除。
2. **commit/preview**: difficulty を既存曲更新・新規作成の双方に反映。simple_form 書き込みを停止。
3. **extract-excel** (`scripts/extract-excel.ts`): SONGS_HEADER から `simple_form` を除き `difficulty` を追加（[list] には難易度が無いため空=null 出力）。`extractSongs` の該当セル出力を更新。
4. **season 等の既存トークン受理**（"通年"→ALL, 真偽 "1"/"0", genres `|`）は不変。difficulty 空欄の扱いを preview/dry-run のサマリに含める。
5. **テスト**: difficulty 列の受理（空=null / 1-5 / 範囲外エラー）、simple_form 列が無くてもインポートできること、既存曲が title 一致で difficulty を更新すること。

## Success Criteria
- [ ] songs.csv が `difficulty` 列を受理し（空=null, 1-5, 範囲外は行エラー）、`simple_form` 列を要求しない。
- [ ] 既存曲を title 一致で更新する際に difficulty が反映される。
- [ ] `scripts/extract-excel.ts` の SONGS_HEADER が difficulty を含み simple_form を含まない。
- [ ] インポート系・extract-excel テストが緑。

## Risks
- **旧 songs.csv との非互換**: simple_form 列を含む旧 CSV を入れると列不一致になり得る。→ 緩和: 余剰列は無視、必須列は difficulty を任意（空許容）にして後方互換を確保。preview のエラーメッセージで不足/余剰を明示。
- **unit-06 との契約整合**: 生成する songs.csv の列順・ヘッダを unit-06 と一致させる必要。→ SONGS_HEADER を単一の真実源として共有（unit-06 は import の列定義を import して使う）。

## Boundaries
- difficulty 型/Zod は unit-01。
- 一括編集ツール（xlsx 生成・変換）は unit-06。
- 本ユニットは CSV インポート経路と初回移行スクリプトの列定義のみ。

## Notes
- SONGS_HEADER を import 側の定数と共有できるならリファクタして重複を排除（reviewer が確認）。
