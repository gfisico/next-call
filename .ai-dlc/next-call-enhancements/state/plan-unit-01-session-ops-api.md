# Tactical Plan — unit-01-session-ops-api (backend, bolt 1)

セッション/セットリストの編集・削除・並べ替えのサーバサイド機能（API ルート・リポジトリ・バリデーション）。UI なし。スキーマ変更なし。

## 0. コードベース確認結果（grounding）

- **API ルート規約**（`src/server/http/handler.ts` / `errors.ts`）: 全ハンドラを `withErrorHandling()` で包む。`parseJsonBody(req, zodSchema)` で body 検証。エラーは `ApiError`（`notFound`=404 / `conflict`=409 / `validationError`=400）を throw → 統一形式 `{ error: { code, message, details? } }`。`idParamSchema`（`src/server/validation/common.ts`）でパス id を coerce（非数・0以下は 400）。
- **認可**: ルートハンドラ自体は認可を持たない。`src/middleware.ts`（`auth()` + `shouldRedirectToLogin`）がエッジで全ルートを保護（`/api/health`・`/login`・`/api/auth/*` のみ公開）。**新ルートは matcher 配下に自動的に入るため、追加のガード実装は不要**。既存 API と同じ。
- **バリデーション規約**（`common.ts` ヘッダ）: リソースごと 1 ファイル、body/レスポンスは **camelCase**（DB は snake_case、Drizzle が変換）。`nonEmptyObject` refine + `NON_EMPTY_MESSAGE` で「1 フィールド以上」を要求。
- **既存 `sessionUpdateSchema`**（`src/server/validation/sessions.ts` L18-25）: `{ hasListeners?, note?, status?: "ENDED" }` の partial。`sessionStartSchema` は `sessionDate` を `/^\d{4}-\d{2}-\d{2}$/`、`venueId` を `z.number().int().positive()` で検証。→ 同じ規則を update に流用。
- **既存 `updateSession`**（`src/server/repositories/sessions.ts` L168-183）: `db.transaction` 内で `getSessionOrThrow` → `.set(patch)` 汎用更新 → `toDetail`。`.set(patch)` は schema フィールド名（`sessionDate`/`venueId`）をそのまま受けるので列追加不要。**venue 存在検証は未実装** → venueId 変更時に追加が必要（`startSession` L102-109 の検証パターンを流用）。
- **order_index 採番規約**（`src/server/repositories/performances.ts`）: `addPerformance` は `COALESCE(MAX(order_index),0)+1`（L145-157）。`deletePerformance`（L242-257）は残行を order_index 昇順で **1..N** に詰め直す。→ reorder はこの 1..N 規約に合わせる。「直前の曲」= セッション内 order_index 最大行（schema L173, L196-200 の index が前提）。
- **FK 参照（`src/db/schema.ts` 全走査で確認）**: `sessions.id` を参照するのは **`performances.sessionId`（L169）と `recommendationRequests.sessionId`（L235）の 2 つのみ**。間接: `performanceFrontInstruments.performanceId`→performances（L215）、`recommendationCandidates.requestId`→recommendationRequests（L297）。`pending_songs` は `songs.id` 参照でセッション非依存（L327）→ 削除しない。`session_participants` は現時点で存在しない（unit-02 が新設・cascade 組込を担当）。
- **FK 強制**: `src/db/client.ts` L38 `foreign_keys = ON` → 子テーブルを先に消さないと違反。明示 CASCADE 定義は無い（NO ACTION）ため手動 cascade 必須。
- **テスト方式**（`tests/api/helpers.ts`）: vitest。Route Handler を直接 import して呼ぶ（サーバ起動なし）。`setupTestDb`（一時 DB + migrate + seed）/ `teardownTestDb` を beforeEach/afterEach。`jsonRequest`/`getRequest`/`routeParams`/`expectApiError` ヘルパあり。DB 直接検証は `getDb()`。既存参照テスト: `tests/api/sessions.test.ts`, `tests/api/performances.test.ts`。
- **対象ファイル churn**: すべて低頻度（初期実装 1〜2 コミットのみ）＝安定ファイル。変更は保守者に見えやすいのでコメント維持。

## 1. タスクチェックリスト（success criteria 対応）

- [ ] **T1** `sessionUpdateSchema` に `sessionDate?`（start と同一 regex）と `venueId?`（int positive）を additive 追加 → **SC1**
- [ ] **T2** `updateSession` に venueId 変更時の venue 存在検証を追加（無ければ `validationError`）→ **SC1**
- [ ] **T3** `PATCH /api/sessions/[id]/route.ts` は schema 差し替え済みのため無変更で sessionDate/venueId を受ける（既存ハンドラが `sessionUpdateSchema` を使用）→ **SC1**
- [ ] **T4** `deleteSessionCascade(id)` を `src/server/repositories/sessions.ts` に新設（単一 tx・cascade・削除件数返却・存在しない id は 404）→ **SC2**
- [ ] **T5** `DELETE /api/sessions/[id]/route.ts` ハンドラ追加（204）→ **SC2**
- [ ] **T6** `reorderPerformances(sessionId, orderedIds)` を `src/server/repositories/performances.ts` に新設（tx・id 集合一致検証・1..N 再採番）→ **SC3, SC4**
- [ ] **T7** `sessionReorderSchema`（`{ order: number[] }`）を `src/server/validation/sessions.ts` に追加（camelCase）→ **SC3**
- [ ] **T8** 新ルート `src/app/api/sessions/[id]/performances/order/route.ts`（PATCH）追加 → **SC3**
- [ ] **T9** リポジトリ/バリデーション/API テスト追加（reorder 後の「直前の曲」判定含む）→ **SC4, SC5**
- [ ] **T10** `npm run typecheck && npm run lint && npm run test && npm run build` パス → **SC5**

## 2. 作成/変更ファイルと関数シグネチャ

### 変更: `src/server/validation/sessions.ts`
```ts
// sessionUpdateSchema に追加（.partial() の対象フィールド）
sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください"),
venueId: z.number().int().positive(),
// 既存: hasListeners, note, status: z.literal("ENDED")

// 新規スキーマ
export const sessionReorderSchema = z.object({
  order: z.array(z.number().int().positive()).min(1),
});
export type SessionReorderInput = z.infer<typeof sessionReorderSchema>;
```

### 変更: `src/server/repositories/sessions.ts`
```ts
// updateSession 内: patch.venueId が指定されたとき venue 存在検証（startSession L102-109 流用）
// 新規:
export function deleteSessionCascade(id: number, db: Db = getDb()): { deleted: number } {
  // tx 内:
  //   getSessionOrThrow(tx, id)  // 無ければ 404
  //   このセッションの performanceId 群 / requestId 群を先に取得
  //   delete recommendation_candidates where request_id in (…このセッションの requests)
  //   delete recommendation_requests where session_id = id
  //   delete performance_front_instruments where performance_id in (…このセッションの performances)
  //   delete performances where session_id = id
  //   delete sessions where id = id
  //   ※ pending_songs は削除しない
  //   ※ session_participants は unit-02 が本関数に組み込む（本ユニットでは存在しない）
  //   return { deleted: <sessions 削除件数=1> }
}
```

### 変更: `src/server/repositories/performances.ts`
```ts
export function reorderPerformances(
  sessionId: number,
  orderedIds: number[],
  db: Db = getDb(),
): PerformanceWithFront[] {
  // tx 内:
  //   セッション存在確認（無ければ 404）
  //   現行 performance id 集合を取得
  //   orderedIds が現行集合と「過不足なく一致」か検証（欠落/余剰/重複 → validationError 400）
  //   受領順に order_index = 1..N を再採番（deletePerformance L242-257 と同型。負値衝突回避のため
  //     必要なら一旦オフセットを挟むか、id ごとに直接 set。SQLite は order_index に unique 制約なし=直接 set 可）
  //   return listPerformancesForSession(tx, sessionId)  // 1..N 昇順
}
```
> 注: `performances.order_index` に unique 制約は無い（schema 確認済み）ため直接 1..N 上書きで衝突しない。

### 変更: `src/app/api/sessions/[id]/route.ts`
```ts
export const DELETE = withErrorHandling(async (_req, ctx: Ctx) => {
  const id = idParamSchema.parse((await ctx.params).id);
  deleteSessionCascade(id);
  return new NextResponse(null, { status: 204 });
});
// PATCH は無変更（sessionUpdateSchema 経由で sessionDate/venueId を自動的に受ける）
```

### 新規: `src/app/api/sessions/[id]/performances/order/route.ts`
```ts
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export const PATCH = withErrorHandling(async (req, ctx: Ctx) => {
  const sessionId = idParamSchema.parse((await ctx.params).id);
  const { order } = await parseJsonBody(req, sessionReorderSchema);
  return NextResponse.json({ performances: reorderPerformances(sessionId, order) });
});
```

## 3. cascade 削除順（schema.ts で検証済み）

`sessions.id` を FK 参照する現行テーブルは **2 つ**（`performances`, `recommendation_requests`）。その子テーブルを含めた葉→根の削除順:

1. `recommendation_candidates`（FK `request_id` → recommendation_requests）— このセッションの request 群に属する行
2. `recommendation_requests`（FK `session_id` → sessions）
3. `performance_front_instruments`（FK `performance_id` → performances）— このセッションの performance 群に属する行
4. `performances`（FK `session_id` → sessions）
5. `sessions`

- **削除しない**: `pending_songs`（songs 参照・横断保持）、`song_genre_tags`（songs/genreTags 参照）。
- **unit-02 の責務**: `session_participants`（`session_id` notNull FK）を新設し、上記 4 と 5 の間（performances 削除後・session 削除前）に本関数へ組み込む。本ユニットは「sessions 参照テーブルを漏れなく削除する構造」を確立し、追加ポイントをコメントで明示する。

## 4. テスト計画

### 追加/拡張: `tests/api/sessions.test.ts`
- **PATCH sessionDate/venueId 更新（SC1）**: 有効な `sessionDate`・別 `venueId` で更新 → 200・値反映。
- **PATCH 不正 venueId（SC1）**: 存在しない venueId → 400 VALIDATION_ERROR。
- **PATCH 不正 sessionDate（SC1）**: `2026/07/01` 形式 → 400。
- **DELETE cascade（SC2）**: セッション + performances + front_instruments + recommendation_requests + candidates を作成 → DELETE → 204。DB 直接検証で 5 テーブルの該当行が 0、`pending_songs` は残存。存在しない id → 404。
- **DELETE が pending_songs を残す（SC2）**: pending_songs を作成 → セッション削除後も pending_songs 行が残ることを DB 直接検証。

### 追加/拡張: `tests/api/performances.test.ts`（reorder）
- **並べ替えで 1..N 再採番（SC3）**: 3 件追加（order 1,2,3）→ `order: [id3, id1, id2]` で PATCH → 返却順・DB の order_index が [1,2,3] に対応。
- **id 集合不一致はエラー（SC3）**: 欠落（2 件だけ渡す）/ 余剰（存在しない id を含む）/ 重複 → いずれも 400 VALIDATION_ERROR。存在しないセッション → 404。
- **reorder 後「直前の曲」判定（SC4）**: reorder 後に `listPerformancesForSession` / active detail の末尾（order_index 最大行）が新しい先頭順の最後の曲になることを検証（= max(order_index) の行が期待する performance）。

### リポジトリ単体（SC4, SC5）
- reorder 後 `SELECT ... ORDER BY order_index DESC LIMIT 1`（＝直前の曲）が正しい performance を返すことをリポジトリ経由で検証。API テストと重複しない範囲で最小限。

## 5. リスク / 前提

- **cascade 漏れ**: 現行 2 参照テーブル + 2 子で確定（grep 検証済み）。unit-02 の `session_participants` は unit-02 が組み込む前提。本関数の削除順コメントに追加ポイントを明記して引き継ぐ。
- **order_index 衝突**: unique 制約が無いため 1..N 直接上書きで問題なし（確認済み）。万一将来 unique 化されても tx 内一括更新なので中間状態は外部に見えない。
- **venue 検証の後方互換**: 既存 PATCH テスト（hasListeners/status のみ）は venueId 未指定なので venue 検証を通らず、影響なし。
- **DELETE の返却形**: リポジトリは `{ deleted }` を返すがルートは 204（body なし）。既存 DELETE（performances）と統一。
- **前提**: スキーマ変更なし（0004 migration は unit-02）。`.set(patch)` は camelCase フィールドをそのまま受ける（Drizzle 仕様）。
- **認可**: middleware がエッジで保護。ルートに個別ガードは追加しない（既存 API と同一方針）。

## PLANNING COMPLETE
- Unit: unit-01-session-ops-api / Bolt: 1
- Tasks Planned: 10 / Criteria Targeted: 5/5
- Risks Identified: 5
