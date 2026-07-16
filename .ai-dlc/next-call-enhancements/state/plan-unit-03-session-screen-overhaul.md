# Plan — unit-03-session-screen-overhaul (frontend)

Bolt: 1 / Discipline: frontend / Branch: `ai-dlc/next-call-enhancements/03-session-screen-overhaul`
Owner-of-record for `src/components/session/session-record-screen.tsx` (競合回避のため単独編集).

## Progress assessment
全 8 success criteria が未達（新規フロント実装ユニット）。unit-01/unit-02 のサーバ API・スキーマは worktree にマージ済みで、以下は「実装済み・呼ぶだけ」:
- `PATCH /api/sessions/:id`（sessionUpdateSchema に sessionDate/venueId 追加済み）
- `DELETE /api/sessions/:id`（cascade 実装済み・204）
- `PATCH /api/sessions/:id/performances/order`（`{ order: number[] }` = performance_id 新順・1..N 再採番）
- `PUT /api/sessions/:id/participants`（participants 置換 + listenerCount/hostInstrumentCode）
- `POST /api/sessions/import-memo/{preview,commit}`

**重要ギャップ（要対応）**: サーバ側 `SessionDetail`（repositories/sessions.ts）は `participants` / `listenerCount` / `hostInstrumentCode` を返すが、**クライアント側 `src/lib/api/types.ts` と `client.ts` は未拡張**。`SessionPatchPayload` も現状 `hasListeners|note|status` の排他 union で sessionDate/venueId を持たない。reorder / participants / memo のクライアント関数・DTO も未定義。→ builder はまず client 層を拡張する（下記 Task 0）。

## Task checklist（success criteria 対応）

- [ ] **Task 0 — client 層拡張（前提・API 依存タスクの土台）**
  - `src/lib/api/types.ts`: `SessionRow` に `listenerCount: number | null` と `hostInstrumentCode: string | null` を追加。`SessionDetail` に `participants: SessionParticipant[]`（`{ instrumentCode: string; count: number }`）を追加。`SessionPatchPayload` を `Partial<{ hasListeners: boolean; note: string | null; status: "ENDED"; sessionDate: string; venueId: number }>` に緩和（sessionUpdateSchema と一致）。`SessionParticipantsPayload`、memo 用 DTO（`MemoPreviewResult`/`MemoPreviewSession`/`MemoPreviewSong`/`MemoCommitPayload`/`MemoCommitSession` 等）を server の `memo-preview.ts` / `import-memo.ts` の型に合わせて追加。
  - `src/lib/api/client.ts`: `reorderPerformances(sessionId, order)`、`putSessionParticipants(sessionId, payload)`、`previewMemoImport(text)`（**エンベロープ無し**でボディをそのまま返す点に注意）、`commitMemoImport(payload)`（`{ summary }` を剥がす）を追加。`patchSession` は型のみ緩和。
  - 対応 criterion: 3,4,5,6,7 の前提。

- [ ] **Task 1 — 履歴導線（criterion 1・API 非依存・先行コミット可）**
  - `session-record-screen.tsx` ヘッダ（L110-166）に `<Link href="/sessions">` を追加。字面・スタイルは recommend-screen の戻りリンク（L270-275）/ 詳細ページの「‹ 履歴に戻る」（sessions/[id]/page.tsx L51-55）を踏襲: `text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring`、文言「セッション履歴 ›」相当。
  - 表示条件: ホーム（ACTIVE）でも履歴詳細でも重複しないよう、**ACTIVE 時のみ**表示（詳細ページは既にラッパが履歴戻りリンクを持つため）。builder は二重導線回避を確認。

- [ ] **Task 2 — フロント編成カンマ表記（criterion 2・API 非依存・先行コミット可）**
  - `session-record-screen.tsx` **L210** の `.join(" → ")` を `.join(", ")` に変更のみ。position 順（内部データ）は不変。矢印記号除去。

- [ ] **Task 3 — 曲順編集（criterion 3）**
  - サブコンポーネント `SetlistReorder`（下記）。各行に上/下ボタン（△▽）でローカル順序を編集 → 明示「並び順を保存」ボタン → `reorderPerformances(sessionId, orderedIds)`。編集中/保存中（disabled + スピナー文言）/失敗（inline エラー + リトライ）を表示。保存成功で `refresh()` + `mutate(SWR_KEYS.sessions)`。
  - reorder body = 現在の表示順の `performance.id[]`（camelCase 数値配列）。

- [ ] **Task 4 — セッション編集（criterion 4=日付・店舗）**
  - サブコンポーネント `SessionEditSheet`（start-session-sheet の日付・店舗選択 UI を踏襲）。venue は `useVenues()` から選択、date は `<input type="date">`。保存で `patchSession(id, { sessionDate, venueId })`。成功で refresh + sessions mutate + シートを閉じる。操作メニューに「セッション情報を編集」を追加。

- [ ] **Task 5 — セッション削除（criterion 5）**
  - 操作メニュー（L141-163）に「セッションを削除」を追加（現状「セッションを終了」のみ）。既存 `ConfirmDialog`（confirmVariant="destructive"）で確認（削除対象=店舗+日付、不可逆である旨を description に明示）→ `deleteSession(id)` → 204 → `mutate(activeSession/sessions)` + `router.push("/sessions")`。
  - `client.ts` には `deleteSession(id)` を追加（現状は `deletePerformance` のみ）。

- [ ] **Task 6 — 詳細記録（criterion 6=参加者/リスナー/ホスト/メモ）**
  - サブコンポーネント `SessionDetailForm`（記録画面内のセクション or シート）。`useInstruments()` から楽器行を追加、各行 `NumberField` で人数、リスナー数 `NumberField`、ホストパート `Select`（楽器マスタ）、セッションメモ `<textarea>`。
  - 保存: 参加者/リスナー/ホストは `putSessionParticipants(id, { participants:[{instrumentCode,count}], listenerCount, hostInstrumentCode })`。メモ（note）は `putSessionParticipants` の対象外のため `patchSession(id, { note })` で別途保存（1 つの「保存」操作で両方を順に呼ぶ）。初期値は `session.participants` / `session.listenerCount` / `session.hostInstrumentCode` / `session.note` から復元 → 再表示で反映（criterion）。

- [ ] **Task 7 — メモ一括移行 UI（criterion 7）**
  - 新規ルート `src/app/(main)/sessions/import-memo/page.tsx` + サブコンポーネント `MemoImport`（`src/components/session/memo-import.tsx`）。入口導線は履歴一覧 `sessions/page.tsx` に「メモから一括取込」secondary ボタンを追加（bottom-nav/layout は触らない）。
  - フロー（下記「メモ UI フロー」）: 貼付 → preview → 解決済み/要確認(needsReview)/警告(warnings) をハイライト表示 → ユーザー補正（venue existing/new、songRef match/create_stub、未知楽器の扱い）→ commit → summary をトースト通知。

- [ ] **Task 8 — 品質ゲート（criterion 8）**
  - 追加/改修 UI が design_rule 準拠（Primary は画面内 1 つ・`h-10` タップ領域・`focus-visible:ring-2`・`text-foreground`/`text-muted-foreground`・raw hex 禁止＝トークン/既存 Badge クラスのみ・`.dark` で破綻しない）。モバイル（375px）で操作可能。`npm run typecheck` / `lint` / `test` / `build` パス。

## Files to create / modify（実パス・サブコンポーネント分割）

**Modify**
- `src/lib/api/types.ts` — Task 0（型拡張）
- `src/lib/api/client.ts` — Task 0（reorder/participants/memo/deleteSession 関数）
- `src/components/session/session-record-screen.tsx` — Task 1,2,3(埋込),4(埋込),5,6(埋込)。**肥大回避のためロジックはサブコンポーネントへ委譲し、本体は state 束ねとレイアウトに留める**
- `src/app/(main)/sessions/page.tsx` — Task 7 入口ボタン

**Create（サブコンポーネント）**
- `src/components/session/setlist-reorder.tsx` — 曲順編集 UI + 保存（Task 3）
- `src/components/session/session-edit-sheet.tsx` — 日付/店舗編集シート（Task 4）
- `src/components/session/session-detail-form.tsx` — 参加者/リスナー/ホスト/メモ（Task 6）
- `src/components/session/memo-import.tsx` — メモ一括移行 UI 本体（Task 7）
- `src/app/(main)/sessions/import-memo/page.tsx` — メモ移行ルート（Task 7）

**削除確認ダイアログは既存 `confirm-dialog.tsx` を流用**（新規作成しない）。

## API calls（method・path・camelCase body）
| 機能 | method path | body（camelCase） | response |
|---|---|---|---|
| 履歴導線(1) | — | — | Link のみ |
| カンマ表記(2) | — | — | 表示のみ |
| 曲順(3) | `PATCH /api/sessions/:id/performances/order` | `{ order: number[] }`（performance.id 新順） | `{ performances }` |
| 編集(4) | `PATCH /api/sessions/:id` | `{ sessionDate?: string, venueId?: number }` | `{ session }` |
| 削除(5) | `DELETE /api/sessions/:id` | — | 204 → `/sessions` へ遷移 |
| 詳細(6) | `PUT /api/sessions/:id/participants` | `{ participants:[{instrumentCode,count}], listenerCount?:number\|null, hostInstrumentCode?:string\|null }` | `{ session }` |
| 詳細メモ(6) | `PATCH /api/sessions/:id` | `{ note: string\|null }` | `{ session }` |
| メモ preview(7) | `POST /api/sessions/import-memo/preview` | `{ text: string }` | **エンベロープ無し** `{ sessions, unknownInstrumentCodes, warnings }` |
| メモ commit(7) | `POST /api/sessions/import-memo/commit` | `{ sessions:[{ sessionDate, venue:{kind:"existing",id}\|{kind:"new",name,isHome}, listenerCount?, hostInstrumentCode?, participants:[{instrumentCode,count}], performances:[{ order, songRef:{kind:"existing",id}\|{kind:"new",title,needsReview}, frontInstruments:string[], participated, instrument, calledByMe, noChart, note? }] }] }` | `{ summary }` |

## 並べ替え UX 決定（drag vs 上下ボタン）
**採用: 各行の上/下ボタン（△▽）＋明示「並び順を保存」**。根拠（rule-based filtering）:
- design_rule §8.3 タップ領域 `h-10`・キーボード到達性 → ドラッグはタッチ/キーボードで不安定。
- 依存追加なし（dnd-kit 等は未導入。「新規依存は少なく」ルール適合）。
- discovery §要件3 が上下ボタンを推奨。
- モバイルフォールバック不要（上下ボタン自体がモバイル最適）。先頭行の△・末尾行の▽は `disabled`。ボタンは `h-10 w-10`・`aria-label="n番目を上へ/下へ"`。
- 楽観更新はローカル state のみ（保存前は API を呼ばない）。保存ボタン押下で 1 回だけ order PATCH。

## メモ preview/correct/commit UI フロー
1. **貼付**: `<textarea>` に複数セッション分テキスト → 「プレビュー」ボタン（disabled while pending）→ `previewMemoImport(text)`。
2. **プレビュー表示**（DB 未書込）: セッションごとにカード。
   - 解決済み: venue existing / 曲 existing / known 楽器はそのまま表示。
   - 要確認（`needsReview[]` と各要素の `known:false`/`songMatch.kind:"new"`）: `Badge variant="warning"` で強調。
   - 警告（session.warnings + トップレベル warnings）: `Badge variant="info"` or 注記行。
3. **補正**（コミットペイロードをローカルに構築）:
   - venue: existing(id) か new(name,isHome) を選択（`isHome` トグル）。
   - 曲: `songMatch.new` の行は `candidates` から match(既存 id) か create_stub(新規 title,needsReview=true) を選ぶ。
   - 未知楽器コード（`unknownInstrumentCodes`）: 該当行は取込前に楽器マスタ整備を促す注記（commit は未知コードで 400 になるため、既知コードへ差し替え or 当該要素除外を要求）。
   - date 欠落セッションは date 入力必須。
4. **確定**: 「取込」ボタン → `commitMemoImport({ sessions:[...] })`。テキストは送らない（サーバは再パースしない＝補正が保持される）。
5. **通知**: 成功で summary（作成セッション数等）を `toast.success`、409（date+venue 重複）/400（未知コード）は `ApiClientError.message` を inline + toast。成功後は `/sessions` へ遷移し `mutate(SWR_KEYS.sessions)`。

## テスト計画（repo 方式: vitest + @testing-library/react + installFetch ルートモック + renderWithSWR）
新規 `tests/components/*.test.tsx` を feature 単位で追加（`front-instruments.test.tsx` / `session-flow.test.tsx` のパターン踏襲。`next/navigation` は `push` を vi.mock）:
- `session-comma-front.test.tsx`（criterion 2）: frontInstruments 複数の performance を持つ SessionRecordScreen をレンダし、`フロント: as, ts` が出て「→」が出ないことを検証。
- `session-history-link.test.tsx`（criterion 1）: ACTIVE 記録画面に `href="/sessions"` の履歴リンクが存在。
- `setlist-reorder.test.tsx`（criterion 3）: 3 曲で▽/△操作→保存→`bodyOf(fetchMock,"PATCH","/performances/order")` が並べ替え後の id 配列と一致。
- `session-edit.test.tsx`（criterion 4）: 編集シートで date/venue 変更→保存→PATCH body に `sessionDate`/`venueId`。
- `session-delete.test.tsx`（criterion 5）: メニュー→削除→確認→DELETE 呼出 + `push("/sessions")`。
- `session-detail-form.test.tsx`（criterion 6）: 参加者行追加・人数・リスナー・ホスト・メモ入力→保存→PUT body が camelCase（instrumentCode/count/listenerCount/hostInstrumentCode）＋note PATCH。初期値復元も検証。
- `memo-import.test.tsx`（criterion 7）: preview モックで needsReview/warnings を返す→ハイライト表示→曲 create_stub 補正→commit body 形状を検証→成功トースト。
- 品質（criterion 8）: `npm run typecheck && npm run lint && npm run test && npm run build`。既存 `tests/design-tokens.test.ts` があるため raw hex 混入は検出され得る点に留意。
- 注: 既存 `FakeServer`（helpers）は order/participants/import-memo ルート未対応。統合テストで使うなら FakeServer 拡張が必要だが、**本ユニットは feature 単位の installFetch カスタムルートで足りる**（FakeServer 拡張は任意）。

## リスク / 前提
- **単一ファイル肥大**: サブコンポーネント分割で緩和（本体はレイアウトのみ）。session-record-screen は低 churn（過去 2 commit）＝大改修は他への影響小だが所有者単独編集を厳守。
- **client 層ギャップ（最大リスク）**: types/client 未拡張のまま UI を書くと typecheck が落ちる。Task 0 を最初に完了させる。SessionDetail の新フィールド追加は既存参照（recommend/detail）に影響しないことを typecheck で確認。
- **memo preview のレスポンスがエンベロープ無し**: `previewMemoImport` は `{ sessions,... }` をそのまま返す（`{ preview }` ではない）。client helper で剥がさないこと。
- **メモ commit の 400/409**: 未知楽器コード=400、date+venue 重複=409。UI は preview 段階で未知コードを可視化し、commit エラーは inline 表示で握る。
- **ホスト/リスナー note の保存経路差**: 参加者は PUT participants、note は PATCH session。1 保存操作で 2 API を順次呼ぶ設計（片方失敗時のロールバックは不可＝失敗を明示表示し再試行を促す）。
- **Primary 単一ルール**: 記録画面下部固定バー「次の曲を考える」が唯一の Primary。追加 UI のアクションは secondary/outline/ghost を基本、削除は destructive。シートは overlay 独立コンテキストなので内部 Primary 可（既存 song-performance-sheet と同方針）。
- **要件1 の遷移先**: intent/discovery 明記どおり「履歴一覧 `/sessions`」（＝「推薦履歴」= セッション履歴一覧）。推薦専用履歴ルートは存在しない。
- **先行コミット**: Task 1・2 は API 非依存の純フロント。Task 0 の後に依存機能へ進む前、Task 1・2 を先に仕上げてコミット可（編集ファイルは本ユニット内に閉じる）。

## PLANNING COMPLETE
- Unit: unit-03-session-screen-overhaul / Bolt: 1
- Tasks Planned: 9（Task 0 client 層 + 要件 1..7 + 品質ゲート）
- Criteria Targeted: 8/8
- Risks Identified: 8
