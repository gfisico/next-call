---
status: pending
last_updated: ""
depends_on: [unit-01-session-ops-api]
branch: ai-dlc/next-call-enhancements/02-session-detail-schema-import-api
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-02-session-detail-schema-import-api

## Description
セッションの詳細記録（パート別参加者数・リスナー数・ホストパート・メモ）のためのスキーマ拡張とAPI、および既存メモ形式テキストの一括パース→プレビュー→取込のサーバ機能を追加する。要件7のバックエンド。DB を変更する唯一のユニット。

## Discipline
backend - Drizzle スキーマ/マイグレーション（`src/db/schema.ts`, `src/db/migrations`）・リポジトリ・API・パーサ（`src/server/import`）を実装する。

## Domain Entities
- **Session（列追加）**: `host_instrument_code`（nullable FK→instruments.code）, `listener_count`（nullable int）。既存 `has_listeners` は併存（削除しない）。既存 `note` はセッションメモとして流用。
- **SessionParticipant（新規）**: `session_id`(FK→sessions), `instrument_code`(FK→instruments.code), `count`(int)。PK=(session_id, instrument_code)。パート別人数（リスナーは含めず、リスナーは `sessions.listener_count`）。
- **Instrument**: 参加者・ホストパートの参照先。パーサのパート表記照合にも使用。
- **Song / Venue / Performance / PerformanceFrontInstrument**: メモ一括取込時に生成/照合する対象（既存 CSV import と同じ生成経路を再利用）。

## Data Sources
- SQLite（Drizzle ORM）。additive マイグレーション `0004_*` を `db:generate` で生成（destructive 変更禁止）。
- 既存の一括取込基盤 `src/server/import`（CSV インポート）を参照し、メモパース経路を追加。
- `import_jobs`（既存）: type を additive 拡張、または専用の短命ジョブとしてメモ移行を扱う。正規化テーブルは新設しない。

## Technical Specification
1. **スキーマ拡張**（additive のみ）
   - `session_participants` テーブル新設。
   - `sessions` に `host_instrument_code`, `listener_count` を追加（両方 nullable）。
   - `db:generate` で `0004_*` マイグレーションを生成し、seed/既存データが壊れないことを確認。
2. **詳細記録 API**
   - `PUT /api/sessions/:id/participants`: `{ participants: [{instrument_code, count}], listener_count?, host_instrument_code? }` を受け、session_participants を置換（全消し→再挿入）し、sessions の該当列を更新。
   - 参加者の `instrument_code`・`host_instrument_code` は既存 Instrument のみ許可。count は 0 以上の整数。
   - リポジトリ: `replaceSessionParticipants(sessionId, rows)`, `updateSessionDetail(sessionId, {listener_count, host_instrument_code})`。
3. **メモ一括パース**（純関数パーサ + プレビュー適用）
   - 入力: 複数セッション分の貼付テキスト。区切りは空行 or 日付行の出現で分割。
   - 各ブロックを構造化: ヘッダ（`YYYY/M/D 店名`）・パート別人数行（`tp1, as1, g4, ...` = パート表記+人数）・凡例行（無視）・ホスト行（`ホストはpf`）・曲行（`N. 曲名 (フロント編成) 記号 ※注記`）・全体メモ行（`🖋️...`）。
   - 記号解釈: 🎷/🎹=演奏（instrument SAX/PIANO・participated=true）、👆=called_by_me、🔰=（該当曲の note 等に反映 or 無視、要判断）、`(...)` 内=フロント編成（position 付き）、`※pfなし`/`※Key=C`=note へ。
   - パート表記→Instrument 照合、店名→Venue 照合/新規、曲名→Song 照合（`title_normalized`、未一致は needs_review クイック登録候補）。
   - `POST /api/sessions/import-memo/preview`: テキスト→解析結果（各セッション: 解決済み/要確認/警告の一覧）を返す（DB 未書込）。
   - `POST /api/sessions/import-memo/commit`: プレビューでユーザーが補正した確定データ→Session/Performance/FrontInstrument/SessionParticipant を生成（トランザクション、既存 CSV import の生成関数を再利用）。
4. パーサはユニットテスト可能な純関数として `src/server/import` に置き、Description のサンプルメモを固定フィクスチャにする。

## Success Criteria
- [ ] `0004_*` additive マイグレーションが生成され、`session_participants` 新設・`sessions` 2列追加が反映される（destructive 変更なし、既存 seed が動く）
- [ ] 参加者 API で session_participants を置換保存でき、listener_count / host_instrument_code を更新できる。存在しない instrument_code は 400
- [ ] メモパーサが Description のサンプル（池袋・16曲）を、日付/店/パート人数/ホスト/各曲(編成・記号・注記)/全体メモへ正しく分解する（純関数ユニットテスト）
- [ ] preview API が DB 未書込で解析結果（要確認・警告含む）を返し、commit API が確定データから Session/Performance/FrontInstrument/SessionParticipant をトランザクション生成する
- [ ] 曲名/店名/パートの照合と未一致時のクイック登録候補提示が動作する
- [ ] typecheck / lint / test / build がパスする

## Risks
- **destructive マイグレーション**: 列追加を誤ると既存 SQLite が壊れる。Mitigation: nullable 追加のみ・`0004_*` を生成後にレビュー。
- **メモの表記揺れ**: 別名・変則記法・記号の多義。Mitigation: パーサは「解決/要確認/警告」を分け、確定はプレビュー経由に限定。silent に誤取込しない。
- **CSV import 資産との二重実装**: Mitigation: 生成（Song/Performance 作成）は既存 import 関数を再利用し、パーサだけ新規にする。

## Boundaries
UI（詳細記録フォーム・メモ移行プレビュー画面）は unit-03。セッション削除/編集/並べ替え API は unit-01。統計は unit-04。depends_on: unit-01（同じセッション系リポジトリ/バリデーション領域を編集するため直列化）。

## Notes
- schema.ts 冒頭の additive 規約を厳守。次マイグレーション番号は `0004`。
- 🔰（初）の扱いは実装時に判断（曲の note か、取込時の情報表示のみか）。プレビューに出して確定はユーザー判断に委ねる。
