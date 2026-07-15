---
status: in_progress
last_updated: "2026-07-15T09:13:44Z"
depends_on: []
branch: ai-dlc/song-master-bulk-edit/01-difficulty-attribute
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-01-difficulty-attribute

## Description
曲マスタに演奏難易度 `difficulty`（整数 1–5, nullable=未判定）を一級属性として追加し、`simpleForm` を型・スキーマ・検証レイヤから撤去する（DB列は残す）。本ユニットは他の全ユニット（エンジン・インポート・編集画面・一括編集ツール）が依存する **型・スキーマの基盤**。

## Discipline
backend - do-backend 系エージェントが実行。

## Domain Entities
- **Song**（`src/db/schema.ts:27-83`）: `difficulty` 列を追加。`simpleForm` 列は物理的に残す（`src/db/schema.ts` 冒頭「列削除・改名禁止」方針）が、以降のコードから参照しない。
- **EngineSong**（`src/engine/types.ts:57-` 付近）: `difficulty: number | null` を追加、`simpleForm` を削除。

## Data Sources
- Drizzle スキーマ `src/db/schema.ts` と マイグレーション `src/db/migrations/*.sql`（+ `meta/`）。新規マイグレーション 0003 を追加（`ALTER TABLE songs ADD COLUMN difficulty INTEGER`）。drizzle-kit の生成手順に従う。
- Zod: `src/server/validation/songs.ts`（songFields）。
- 型: `src/lib/api/types.ts`（Song 系 2箇所, :89 / :264 付近）。
- 投影: `src/server/recommendation/build-input.ts:64`（simpleForm マッピング）。

## Technical Specification
1. **スキーマ**: `songs` に `difficulty: integer("difficulty")`（nullable, default なし=NULL）を追加。既存の `simpleForm` 定義はコメントで「@deprecated 使用しない。difficulty へ移行（unit-01〜）」と明記して残す。
2. **マイグレーション**: 追加的マイグレーション（列追加のみ）。既存データの difficulty は NULL（未判定）。
3. **Zod** `songFields`: `difficulty: z.number().int().min(1).max(5).nullable()` を追加。`simpleForm` を削除。create/update スキーマは `.partial()` 前提を維持。
4. **api types** (`src/lib/api/types.ts`): Song 型に `difficulty: number | null` を追加、`simpleForm` を削除（2箇所）。
5. **engine types** (`src/engine/types.ts`): `EngineSong` に `difficulty: number | null`、`simpleForm` 削除。
6. **build-input** (`src/server/recommendation/build-input.ts`): `difficulty: song.difficulty` を投影に追加、`simpleForm` 行を削除。
7. リポジトリ層（`src/server/repositories/songs.ts`）で songs を返す/更新する箇所に difficulty を通す。simpleForm の書き込みは残置でも良いが、更新入力からは外す。

## Success Criteria
- [ ] マイグレーション適用後、`songs.difficulty` が 1–5 または NULL を保持できる。
- [ ] `songUpdateSchema`/`songCreateSchema` が `difficulty`(1-5/null) を受理し、`simpleForm` を受理しない（未知キーは無視 or 検証で落ちる、既存挙動に合わせる）。
- [ ] `EngineSong`・api `Song` 型に `difficulty` があり `simpleForm` が無い。build-input が difficulty を投影する。
- [ ] typecheck が通る（simpleForm 参照が残っていない＝コンパイルエラーで検出）。

## Risks
- **既存 simpleForm 参照の取りこぼし**: 型から消すと参照箇所がコンパイルエラーになる → typecheck で全滅を検出できるので安全側。エンジン/インポート/UI は後続ユニットで対応するため、本ユニットのみでは typecheck が赤になり得る点に注意（後続ユニット完了で緑）。→ 緩和: 型からの simpleForm 削除は最小限にし、参照箇所の実際の撤去は各担当ユニット（unit-02/03/04）で行う。本ユニットは difficulty 追加と型定義変更に集中し、simpleForm は「@deprecated」表記＋更新入力から除外に留め、物理削除を段階化する。
- **マイグレーション整合**: drizzle の meta スナップショットと SQL の齟齬。→ drizzle-kit の正規手順で生成し、`npm run db:migrate` の冪等性を確認。

## Boundaries
- 安全性スコア・初心者対応のロジック変更は **unit-02**。
- CSV インポートの列変更は **unit-03**。
- 編集画面の UI 変更は **unit-04**。
- 本ユニットはあくまで「difficulty をデータモデル/型/検証に導入し、simpleForm を非推奨化」する基盤のみ。

## Notes
- difficulty の null 方針: 未判定=NULL。エンジンでの null 扱い（安全側/中立）は unit-02 が定義。
- simpleForm を型から削除すると unit-02/03/04 の対象箇所がコンパイルエラーとして可視化されるため、依存ユニットの作業漏れ検出に役立つ。段階的撤去の順序は「型 deprecated 化(01) → 参照撤去(02/03/04)」。
