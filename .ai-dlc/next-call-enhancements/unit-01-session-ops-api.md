---
status: completed
last_updated: "2026-07-16T04:01:37Z"
depends_on: []
branch: ai-dlc/next-call-enhancements/01-session-ops-api
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-01-session-ops-api

## Description
セッション/セットリストの「編集・削除・並べ替え」を担うサーバサイド機能を追加する。UI は持たず、API ルート・リポジトリ関数・バリデーションのみ。対象は要件3（曲順編集）・要件4（セッション削除）・要件5（セッション基本情報の修正）。

## Discipline
backend - API ルート（`src/app/api`）・リポジトリ（`src/server/repositories`）・バリデーション（`src/server/validation`）を実装する。

## Domain Entities
- **Session**: `session_date` / `venue_id` の更新、物理削除。
- **Performance**: `order_index` の一括並べ替え。「直前の曲」= ACTIVE セッション内 order_index 最大行、の前提を壊さないこと。
- **RecommendationRequest / RecommendationCandidate / PerformanceFrontInstrument**: セッション削除時に cascade で削除する対象。
- **PendingSong**: セッション横断保持のため、セッション削除では削除しない。

## Data Sources
- SQLite（Drizzle ORM）。既存リポジトリ（`src/server/repositories` のセッション/演奏リポジトリ）に関数を追加。
- 既存の `src/server/validation`（zod 等）にスキーマを追加。
- スキーマ変更は不要（既存カラムのみ使用）。

## Technical Specification
以下のサーバ機能を追加する（既存のAPIルート規約・エラー整形・認可ガードに合わせる）:

1. **セッション更新** `PATCH /api/sessions/:id`
   - body（camelCase、既存 `src/server/validation/sessions.ts` の `sessionDate`/`venueId`/`hasListeners` 規約に合わせる）: `{ sessionDate?, venueId? }`。日付は妥当な日付、venueId は既存 Venue のみ。
   - リポジトリ: `updateSession(id, { sessionDate, venueId })`。
2. **セッション物理削除** `DELETE /api/sessions/:id`
   - 単一トランザクション内で cascade 削除: `recommendation_candidates` → `recommendation_requests` → `performance_front_instruments` → `performances` → `sessions`。
   - **cascade 対象は「その時点で sessions を FK 参照する全テーブル」であること**（`src/db/schema.ts` を確認して漏れなく列挙する）。本ユニット構築時点の参照テーブルは上記のみだが、unit-02 が `session_participants`（`session_id` FK・notNull）を追加する。unit-02 側で本削除ロジックに `session_participants` を組み込む責務を負う（下記 Boundaries 参照）。
   - `pending_songs` は削除しない（横断保持）。
   - リポジトリ: `deleteSessionCascade(id)`。削除件数を返す。
3. **曲順並べ替え** `PATCH /api/sessions/:id/performances/order`
   - body: `{ order: number[] }`（performance_id の新しい並び）。既存APIの命名慣習（camelCase）に合わせる。
   - 同一セッション内の全 Performance の `order_index` を **1..N** で連番再割当（トランザクション）。既存 `deletePerformance`（1..N 再採番）・`addPerformance`（max+1）と採番基準を揃える。
   - リポジトリ: `reorderPerformances(sessionId, orderedIds)`。渡された id 集合がセッションの全 performance と一致することを検証（欠落・余剰はエラー）。

すべて認可（許可メールのみ）配下に置き、対象リソースの存在確認と 404/400 応答を返す。

## Success Criteria
- [ ] `PATCH /api/sessions/:id` で日付・店舗を更新でき、不正な venueId / 日付は 400 を返す（body は camelCase）
- [ ] `DELETE /api/sessions/:id` がトランザクションで candidates→requests→front_instruments→performances→session を削除し、pending_songs は残す（unit-02 完了後は session_participants も含む）
- [ ] `PATCH .../performances/order` が同一セッション全 performance の order_index を **1..N** で連番再割当し、id 集合不一致時はエラーを返す
- [ ] 並べ替え後も「直前の曲＝order_index 最大行」の判定が正しく機能する（リポジトリ単体テストで検証）
- [ ] 追加した3機能にリポジトリ/バリデーションのテストがあり、typecheck / lint / test / build がパスする

## Risks
- **cascade 漏れ**: 参照テーブルの削除順を誤ると FK 制約違反。Mitigation: 依存の葉から順に削除し、単一トランザクションで実行。discovery の cascade 順に従う。
- **order_index の連番破れ**: 部分更新だと重複/欠番が出る。Mitigation: 全件連番再割当方式にする。
- **既存 seed/インポートの order 前提**: Mitigation: 既存 performance 生成箇所の order_index 採番と整合を確認。

## Boundaries
UI は一切含まない（操作メニュー・確認ダイアログ・曲順編集UIは unit-03）。参加者/ホスト/メモの記録・メモ移行は扱わない（unit-02）。統計は扱わない（unit-04）。`session_participants` テーブルは unit-02 が新設し、削除 cascade への組み込みも unit-02 が担う（本ユニットの `deleteSessionCascade` は unit-02 が拡張する前提で、参照テーブルを漏れなく削除する構造にしておく）。

## Notes
- 既存 API ルートの実装パターン（`src/app/api/**`）とリポジトリ関数のシグネチャ規約を踏襲する。
- schema.ts 冒頭の additive 規約に反する変更はしない（このユニットはスキーマ非変更）。
