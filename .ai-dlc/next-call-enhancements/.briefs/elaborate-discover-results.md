---
status: success
intent_slug: next-call-enhancements
generated: 2026-07-16
---

# elaborate-discover 結果サマリ

discovery.md に 9 要件それぞれの「影響ファイル / 現状 / 変更方針」と
`## Domain Model Delta` / `## Quality Gate Candidates` / `## Unit Decomposition 示唆` を追記済み。
以下は設計判断に必要な要点のみ。

## Domain Model Delta（新規テーブル / 列）

additive 限定（schema.ts 冒頭規約）。次マイグレーション = `0004_*`（drizzle-kit generate）。

- **新規テーブル `session_participants`**（要件7）: `session_id` FK, `instrument_code` FK→instruments.code,
  `count` int。PK=(session_id, instrument_code)。パート別人数を楽器マスタ連動で保持。
- **`sessions` 列追加**（要件7）: `host_instrument_code` text nullable FK→instruments.code（ホストパート）、
  `listener_count` integer nullable（リスナー数。既存 `has_listeners` と併存）。
- **メモ移行**（要件7）: `import_jobs.type` enum に memo 系を追加（additive）か専用短命ジョブを新設。
  正規化テーブルは持たない（既存 import_jobs 同様）。
- 要件3（曲順）・要件5（日付/店舗編集）は**列追加不要**（既存 order_index / session_date / venue_id を利用、
  変更はバリデーションスキーマとロジックのみ）。
- 要件4 削除は cascade 手動削除（candidates→requests→front_instruments→performances→session。
  pending_songs は横断保持のため残す）。
- 要件8（version.ts 定数）・要件9（CSS/クライアント）は DB 非対象。

## Quality Gates（package.json scripts、すべて実在）

| gate | command |
|---|---|
| typecheck | `tsc --noEmit` |
| lint | `eslint .` |
| test | `vitest run` |
| build | `next build`（output: standalone） |

tsconfig `strict: true`。スキーマ変更後は `db:generate`（drizzle-kit）補助実行。

## 推奨ユニット分解と依存

- **unit-A 表示微修正**（要件1 履歴導線 + 要件2 カンマ表記）— フロントのみ・無スキーマ。
- **unit-B セッション編集・削除**（要件4 + 要件5）— sessions API/repo/validation + 操作メニュー。cascade 削除。
- **unit-C 曲順編集**（要件3）— performances reorder API/repo + UI。無スキーマ。
- **unit-D テーマ＆バージョン**（要件9 + 要件8）— layout FOUC + ヘッダートグル + settings 表示。無 DB。
- **unit-E 統計画面**（要件6）— 新設 stats repo/api/page/nav。読み取り専用。build-input.ts の集計を汎用化。
- **unit-F セッション詳細記録＋メモ移行**（要件7）— 唯一のスキーマ変更 + 詳細 UI + メモ一括取込（import 基盤踏襲）。最大。

依存関係:
- データ依存はほぼ無し（各ユニット独立着手可、unit-F の追加は additive）。
- ファイル結合の競合注意（順序化 or マージ調整）:
  - `session-record-screen.tsx` を A/B/C/F が編集 → 推奨順 A→C→B→F。
  - `bottom-nav.tsx` に unit-E がナビ追加（unit-F も足すなら同ファイル調整）。
  - `(main)/layout.tsx` ヘッダーは unit-D のみ編集（履歴導線 unit-A は SessionRecordScreen 内に置く前提）。
  - `settings-screen.tsx` は unit-D が編集（version 表示）。
- 並行可: unit-E と unit-D は他と非競合で並行実行可能。

## 特記

- **ダークモードのトークン土台は既に完成**（globals.css に `.dark` 全 semantic トークン + `@custom-variant dark`、
  Tailwind v4 クラス方式）。不足は「`.dark` 付け外し機構＋FOUC スクリプト＋トグル UI＋localStorage」のみ。
- フロント編成「→」表示は **1 箇所のみ**（session-record-screen.tsx L210）。データ順序は position で保持。
- 曲別集計（登場回数/最終演奏日/コール回数/ジャンル比率）は既に build-input.ts L117-189 に存在。統計画面はこれを汎用化。
- version は `schema_version`（export.ts）と別概念。SSOT を共有しない（docs/version_number.md §5）。
