# Tactical Plan — unit-02: session-detail schema + memo import API

Branch: `ai-dlc/next-call-enhancements/02-session-detail-schema-import-api`
Discipline: backend (schema / repositories / API / pure parser). No UI (unit-03).
Depends on: unit-01 (merged — `deleteSessionCascade`, `updateSession`, reorder all present).

このユニットは本 intent で **唯一 DB を変更する**ユニット。マイグレーションは additive のみ
（`schema.ts` 冒頭規約 L2-6: 列の削除・改名禁止）。

---

## 0. 現状確認（グラウンディング済み）

- `src/db/schema.ts`: `instruments`(code PK, label, sortOrder) / `sessions`(id, session_date, venue_id
  FK, has_listeners default false, status enum ACTIVE/ENDED default **ACTIVE**, note, created_at) /
  `performances` / `performance_front_instruments`(PK=(performance_id, position), instrument_code FK→
  instruments.code) / `import_jobs`(type enum **["songs","setlists"]**, status, parsed_rows, errors,
  unknowns, resolutions すべて JSON text)。
- `src/db/client.ts`: `foreign_keys = ON`、better-sqlite3 **同期** tx（`db.transaction((tx)=>{...})`）。
- `drizzle.config.ts`: dialect sqlite, schema `./src/db/schema.ts`, out `./src/db/migrations`。
- 既存マイグレーション 0000〜0003 + `meta/_journal.json`（最終 idx=3）→ **次番号は 0004**。
- unit-01 が `deleteSessionCascade`（sessions.ts L216-262）に **明示の挿入ポイント**を残している
  （L253-254 コメント: 「performances 削除の直前で session_id = id を削除」）。
- `masters.createInstrument(input, db)` で楽器を追加可能（quick-add に再利用可）。
- テスト方式: `tests/api/helpers.ts` の `setupTestDb()`（一時 DB に runMigrations+seed）→ Route を直接
  import して呼ぶ。cascade テストは `tests/api/sessions.test.ts` L243-360 が既存パターン。

### ⚠ 重要な発見（設計判断が要る）
`instruments` マスタは **フロント楽器のみ** (`vo ss as ts bs tp fl fh harm tb cl g`)。
サンプルメモの参加者行 `tp1, as1, g4, pf2, b3, ds3` と `ホストはpf` は **リズム隊コード
（pf=ピアノ / b=ベース / ds=ドラム）を含み、これらはマスタに存在しない**。
`session_participants.instrument_code` と `sessions.host_instrument_code` は共に FK→instruments.code
なので、pf/b/ds を保存するには **その code がマスタに存在している必要がある**。
→ 詳細は §6 リスク R1。パーサは未知コードを「要確認」に落とし、silent 取込しない方針で解決する。

---

## 1. タスクチェックリスト（→ 成功基準マッピング）

- [ ] **T1** additive スキーマ拡張 + `0004_*` 生成 → **SC1**
- [ ] **T2** 参加者 repo + validation + `PUT /api/sessions/:id/participants` → **SC2**
- [ ] **T3** `deleteSessionCascade` に `session_participants` 削除を組込 → **SC3**
- [ ] **T4** メモパーサ（純関数、`src/server/import/memo-parse.ts`）+ 固定フィクスチャ → **SC4**
- [ ] **T5** `POST /api/sessions/import-memo/preview`（DB 未書込・照合/要確認/警告）→ **SC5(前半)/SC7**
- [ ] **T6** `POST /api/sessions/import-memo/commit`（補正済み確定ペイロードを再パースせず tx 生成、
      status=ENDED、新規 venue is_home=false 注記）→ **SC5(後半)/SC6/SC7**
- [ ] **T7** テスト（パーサ純関数 / 参加者 API / cascade-with-participants / ENDED status /
      preview-no-write / commit-from-payload）+ gates → **SC4/SC5/SC6/SC8**

---

## 2. スキーマ拡張（T1・additive） — SC1

`src/db/schema.ts` に追記（既存テーブル定義のスタイル・列コメント規約に合わせる）:

1. `sessions` に **2 列追加**（両方 nullable = 破壊なし）:
   - `hostInstrumentCode: text("host_instrument_code").references(() => instruments.code)`
   - `listenerCount: integer("listener_count")`
   - `has_listeners` は削除せず併存（規約）。
2. **新規テーブル** `sessionParticipants`（`instruments` の後・`sessions` 参照可能な位置に定義）:
   ```
   session_id     integer NOT NULL FK→sessions.id
   instrument_code text   NOT NULL FK→instruments.code
   count          integer NOT NULL default 0
   PK = (session_id, instrument_code)          // primaryKey({columns:[...]}) 既存 song_genre_tags 同型
   ```
   export 名 `sessionParticipants`（camelCase）。型 `SessionParticipantRow = typeof sessionParticipants.$inferSelect`。

### マイグレーション生成（非破壊手順）
```
cd <worktree>
npm run db:generate           # drizzle-kit generate → 0004_*.sql + meta 更新
```
- 期待: `0004_*.sql` が **`CREATE TABLE session_participants` と `ALTER TABLE sessions ADD COLUMN`
  ×2 のみ**（DROP/RENAME/再構築が出たら additive 違反 → 生成物をレビューし schema 記述を修正）。
- nullable 列追加・新規テーブルのみなので既存 seed / 既存行は無傷。
- 検証: `npm run test`（`tests/db/migrate.test.ts` / `tests/db/seed.test.ts` が一時 DB で 0000→0004
  を順適用して seed 成功を確認）。
- コミットには **生成された `0004_*.sql` と `meta/_journal.json`・`meta/0004_snapshot.json` を必ず含める**。

---

## 3. 参加者 API（T2） — SC2

### repository（`src/server/repositories/sessions.ts` に追加）
- `replaceSessionParticipants(sessionId: number, rows: {instrumentCode: string; count: number}[], db=getDb()): SessionParticipantRow[]`
  - tx 内で: session 存在確認（`getSessionOrThrow`）→ **instrument code 実在検証**
    （`commit.ts` の `assertInstrumentCodes` と同型。未知は `validationError` 400、details に unknownCodes）
    → `delete where session_id=id`（全消し）→ 受領行を一括 insert（重複 instrumentCode は事前に検出し 400）。
- `updateSessionDetail(sessionId: number, patch: {listenerCount?: number|null; hostInstrumentCode?: string|null}, db=getDb())`
  - session 存在確認 → hostInstrumentCode が非 null なら instrument 実在検証（未知 400）→ `sessions.set(patch)`。
  - 既存 `updateSession` は列追加で自動的に `.set(patch)` 経由で通るが、**host/listener は別スキーマ**の
    ため participants API 用に専用関数を置く（責務分離。updateSession は unit-01 の sessionUpdateSchema 用のまま）。
- 実装は 1 tx にまとめる（participants 置換 + detail 更新を PUT ハンドラから 1 呼び出しで原子的に）。
  → 推奨: `putSessionParticipants(sessionId, input, db)` を 1 関数にして内部で 1 tx（replace + detail 更新）。

### validation（`src/server/validation/sessions.ts` に追加）
```
sessionParticipantsSchema = z.object({
  participants: z.array(z.object({
    instrumentCode: z.string().min(1),
    count: z.number().int().min(0),          // 0 以上の整数（spec）
  })).default([]),
  listenerCount: z.number().int().min(0).nullable().optional(),
  hostInstrumentCode: z.string().min(1).nullable().optional(),
})
```
- camelCase body（既存規約）。未知 instrumentCode の 400 は **repository 側**で実在検証（zod は形式のみ）。
- 同一 instrumentCode の重複は repo で検出して 400（PK 衝突を明快なメッセージに変換）。

### route（新規 `src/app/api/sessions/[id]/participants/route.ts`）
- `export const dynamic = "force-dynamic"`、`PUT = withErrorHandling(...)`。
  `idParamSchema.parse((await ctx.params).id)` → `parseJsonBody(req, sessionParticipantsSchema)` →
  `putSessionParticipants(id, body)` → `NextResponse.json({ session: getSession(id) })`（更新後の詳細を返す）。
- 既存 `[id]/performances/order/route.ts` のパターンを踏襲。

### （任意・推奨）詳細の可視化
`SessionDetail`（sessions.ts L34-37）と `toDetail`（L82-93）に `participants` / `hostInstrumentCode` /
`listenerCount` を載せると unit-03 が読める。**列追加で `SessionRow` に自動的に含まれる**ため
host/listener は追加不要。participants は `toDetail` で 1 クエリ足すだけ（任意だが SC2 の「更新できる」
確認テストで往復検証しやすい）。

---

## 4. cascade 拡張（T3） — SC3

`src/server/repositories/sessions.ts` `deleteSessionCascade` の **L253-254 挿入ポイント**へ、
`performances` 削除の直前に 1 行追加:
```
tx.delete(sessionParticipants).where(eq(sessionParticipants.sessionId, id)).run();
```
- `session_participants` は `session_id` FK・notNull なので、これが無いと参加者ありセッション削除が
  `foreign_keys=ON` で FK 違反 → SC3 が落ちる。
- import（`sessionParticipants`）を sessions.ts の import 群に追加。
- ヘッダコメント（L204-214）の参照テーブル列挙も session_participants を含めて更新。

---

## 5. メモ一括パース + preview/commit（T4/T5/T6） — SC4/SC5/SC6/SC7

### 5.1 純関数パーサ `src/server/import/memo-parse.ts`（T4・SC4）
DB 非依存の純関数（照合は preview 側で行う）。シグネチャ:
```
parseMemo(text: string): ParsedMemo                    // { sessions: ParsedMemoSession[]; warnings: string[] }
```
`ParsedMemoSession`:
```
{
  date: string|null;            // "2026/5/9" → "2026-05-05" 正規化（JST。無効/欠落は null + warning）
  venueName: string|null;       // "池袋"
  participants: {code:string;count:number}[];  // tp1,as1,g4,pf2,b3,ds3 を分解
  hostCode: string|null;        // "ホストはpf" → "pf"
  songs: ParsedMemoSong[];
  overallNote: string|null;     // 🖋️行
  rawLegendLines: string[];     // 凡例（・🎷🎹:… 等）は無視保持のみ
}
```
`ParsedMemoSong`:
```
{ order:number; title:string; front:string[];          // (tp, g, g) → ["tp","g","g"]（重複・順序保持）
  played:boolean;               // 🎷 or 🎹 が有れば true
  instrument:"SAX"|"PIANO"|"NONE"; // 🎷→SAX / 🎹→PIANO / 無→NONE
  calledByMe:boolean;           // 👆
  beginnerFirst:boolean;        // 🔰（初）→ preview 表示 + note 退避（§Notes: 確定はユーザー判断）
  note:string|null;             // ※注記（"pfなし","Key=C" 等）を連結。🔰 も注記化する場合はここへ
}
```

**分解ルール（サンプル「池袋 16 曲」を固定フィクスチャに）:**
- ブロック分割: 空行、または **日付行の出現**（`^\d{4}/\d{1,2}/\d{1,2}\b`）で新セッション開始。
- ヘッダ行1（日付+店名）: `^(\d{4})/(\d{1,2})/(\d{1,2})\s+(.+)$` → date（0 埋め ISO 化）+ venueName。
- パート人数行: `code+number` を `,`（全角/半角）区切りで分解。各トークン `^([a-zA-Z]+)(\d+)$`
  → {code, count}。**リスナーは含めない**（リスナーは listenerCount 側。サンプルには明示なし）。
- 凡例行（`^・`）: `rawLegendLines` に退避し解釈しない（凡例は固定説明）。
- ホスト行（`^・?ホストは(\S+)` 等 `ホストは<code>`）: hostCode。
- 曲行: `^(\d+)\.\s*(.+)$` を捕捉し右側を token 分解:
  - `(...)` を front 抽出（内部を `,` 分解・trim）。
  - 絵文字 🎷🎹👆🔰 を検出しフラグ化（複数可、順不同）。
  - `※...` 以降を note（複数 ※ は連結）。
  - front/絵文字/※ を除いた残りを title として trim（末尾の記号・空白除去）。
- 全体メモ行（`^🖋️(.*)`）: overallNote。
- 絵文字は Unicode で厳密一致（🎷 U+1F3B7, 🎹 U+1F3B9, 👆 U+1F446, 🔰 U+1F530）。

> パーサは **照合しない**（Song/Venue/Instrument 一致は preview の責務）。純粋に構造化のみ →
> ユニットテストが DB 不要で回る（SC4）。

### 5.2 preview `src/server/import/memo-preview.ts` + route（T5・SC5前半/SC7）
`previewMemoImport(text, db=getDb()): MemoPreviewResult`（**DB 未書込**）:
- `parseMemo(text)` → 各セッションを照合:
  - **venue**: `venues.name` 完全一致 → 既存 id / 未一致 → `newVenue: true`（is_home=false 予定の**母店フラグ要確認**注記を付ける）。
  - **曲名**: `normalizeTitle` + `rankTitleCandidates`（preview.ts L55-107 を **再利用**）で候補提示。
    未一致は「要確認（クイック登録候補 = create_stub / match / skip）」。
  - **パート/ホスト/front の instrument code**: `instruments.code` 実在チェック。未知（pf/b/ds 等）は
    **「要確認」** に分類（silent 無視しない）。解決策候補: (a) マスタへクイック追加（`createInstrument`）、
    (b) 別コードへ match、(c) 当該 participant/host を skip。→ SC7「照合と未一致時のクイック登録候補提示」。
- 返却は resolved / needsReview / warnings に分けた JSON（DB 書込みなし）。
- route: `POST /api/sessions/import-memo/preview`（新規 `src/app/api/sessions/import-memo/preview/route.ts`）。
  body `{ text: string }`（`z.object({text: z.string().min(1)})`）。200 で preview 返却。

> import-jobs テーブルを使うかは任意。**推奨: memo は import_jobs を使わず、
> preview は「解析＋照合結果を返すだけ」、commit は「補正済み確定ペイロードを直接受ける」** の
> 2 エンドポイントにする（unit spec の commit 契約「再パースしない・補正が失われない」を最も単純に満たす）。
> import_jobs.type enum は `["songs","setlists"]` のままにでき、enum 追加のスキーマ変更を避けられる。

### 5.3 commit `src/server/import/memo-commit.ts` + route（T6・SC5後半/SC6/SC7）
`commitMemoImport(payload: MemoCommitInput, db=getDb()): MemoCommitSummary`:
- **入力は unit-03 UI で補正済みの完全な確定ペイロード**。**再パースしない**（テキストを受けない）。
  payload 形（camelCase・zod で検証）:
  ```
  { sessions: [{
      sessionDate: "YYYY-MM-DD",
      venue: {kind:"existing", id} | {kind:"new", name, isHome:false},
      listenerCount?: number|null,
      hostInstrumentCode?: string|null,
      participants: [{instrumentCode, count}],
      performances: [{
        order, songRef: {kind:"existing", id} | {kind:"new", title, needsReview:true},
        frontInstruments: string[], participated, instrument:"SAX"|"PIANO"|"NONE",
        calledByMe, noChart?, note?
      }]
  }]}
  ```
- **単一トランザクション**（`commit.ts` の直書き tx スタイルを踏襲。ネスト tx を避けるため createSong/
  createVenue/startSession/addPerformance は呼ばず、tx 内で同等ロジックを実行）:
  1. venue 解決: existing→id / new→`venues` insert（**isHome=false 固定でも payload 値を尊重**）。
  2. **重複防止**: 同一 date+venue セッションが既存なら `conflict`（commit.ts L329-340 を踏襲）。
  3. session insert（**status:"ENDED"**、hasListeners は listenerCount>0 から導出 or false、
     listenerCount / hostInstrumentCode をセット）→ **SC6**。
  4. instrument code 一括実在検証（front + participants + host。`assertInstrumentCodes` 再利用）。
  5. song 解決: existing→id / new→`needsReview:true` スタブ insert（commit.ts `resolveTitles` の
     create_stub 分岐と同型 / `normalizeTitle` 使用）。
  6. performances を order 昇順で 1..N 採番 insert（commit.ts L354-386 と同型）+ front_instruments
     を position 付き insert。
  7. `session_participants` を insert（count 行）。
- 既存 CSV import 生成経路の **再利用対象**: `normalizeTitle`（曲名正規化）、`assertInstrumentCodes`
  （楽器コード検証）、`rankTitleCandidates`（preview 候補）、create_stub/venue insert/perf 採番の各パターン。
  → 新規に発明するのはパーサのみ（Risk「二重実装」の緩和）。
- route: `POST /api/sessions/import-memo/commit`（新規 `.../import-memo/commit/route.ts`）。200 で summary。

---

## 6. リスク / 前提（Risks & Assumptions）

- **R1（最重要・要ビルダー判断）** instruments マスタは前衛楽器のみで、メモの pf/b/ds/piano を保持不可。
  → 方針: パーサは分解のみ、preview で **未知コードを「要確認」**にし silent 取込しない。resolution は
  (a) `createInstrument` でマスタ追加、(b) 既存コードへ match、(c) skip。commit は未知コードを 400。
  ビルダーは「pf/b/ds/dr を seed に追加するか、都度クイック追加か」を決める（**seed 変更は additive な
  データ投入で schema 破壊ではない**が、フロント編成マスタの意味論を広げる点は要確認）。SC7 の「クイック
  登録候補提示」はこの解決経路で満たす。
- **R2 destructive マイグレーション**: `db:generate` 出力に DROP/RENAME/table-rebuild が出たら additive
  違反。→ 生成 SQL を必ず目視レビュー。nullable 列追加＋新規テーブルのみであることを確認。
- **R3 メモ表記揺れ**: 別名・全角/半角・記号多義・区切りゆれ。→ パーサは「解決/要確認/警告」を分離、
  確定は preview→補正→commit に限定。曖昧トークンは warning にし推測取込しない。
- **R4 commit 契約**: 「再パースで補正が失われない」= commit はテキストを受けない設計にすることで構造的に保証。
- **R5 二重取込**: date+venue 重複を commit で conflict（既存 CSV import と同ルール）。
- **前提**: unit-01 は merged 済み（`deleteSessionCascade` 挿入ポイント・`getSession`/`toDetail` 利用可）。
  日付は JST 解釈（schema.ts L9）。tx は同期（better-sqlite3）。

---

## 7. テスト計画（T7） — SC4/SC5/SC6/SC8

- **パーサ純関数**（`tests/import/memo-parse.test.ts`・DB 不要）: intent サンプル（池袋・16 曲抜粋を
  完全フィクスチャ化）で date→ISO / venue / participants(tp1,as1,g4,pf2,b3,ds3) / host(pf) /
  各曲(order・title・front・🎷🎹👆🔰・※note) / 🖋️overallNote への分解を assert。複数ブロック分割・
  空行/日付行分割・欠落 date の warning も。
- **参加者 API**（`tests/api/session-participants.test.ts`, helpers 流用）: PUT で置換保存→再 PUT で
  全消し再挿入を DB 直接検証 / listenerCount・hostInstrumentCode 更新 / **未知 instrumentCode → 400** /
  重複 instrumentCode → 400 / count 負値 → 400。
- **cascade-with-participants**（`tests/api/sessions.test.ts` に追加 or 新規）: participants を持つ
  セッションを DELETE → 204、`session_participants` が 0 行になり FK 違反が出ないことを直接検証（SC3）。
- **memo preview**（`tests/api/import-memo.test.ts`）: preview 後に **DB が未変更**（sessions/venues/
  songs 件数不変）であること / 未知 venue の母店フラグ要確認注記 / 未一致曲の候補 / 未知 instrument の
  要確認分類。
- **memo commit**（同上）: 補正済みペイロードから Session(status=**ENDED**)/Performance/FrontInstrument/
  SessionParticipant が tx 生成される / new venue is_home=false / date+venue 重複は 409 / **payload を
  そのまま使い再パースしない**（テキストを渡さずに commit できることで担保）。
- **migration/seed**: 既存 `tests/db/migrate.test.ts`・`seed.test.ts` が 0004 込みで通ることを確認（SC1）。
- **gates**: `npm run typecheck && npm run lint && npm run test && npm run build`（SC8）。

---

## 8. 作成/変更ファイル一覧（実パス）

**変更:**
- `src/db/schema.ts`（sessions 2 列 + sessionParticipants テーブル）
- `src/server/repositories/sessions.ts`（putSessionParticipants / replaceSessionParticipants /
  updateSessionDetail / deleteSessionCascade 拡張 / toDetail・SessionDetail に participants 任意追加）
- `src/server/validation/sessions.ts`（sessionParticipantsSchema）

**新規:**
- `src/db/migrations/0004_*.sql` + `meta/_journal.json`・`meta/0004_snapshot.json`（`db:generate` 生成）
- `src/app/api/sessions/[id]/participants/route.ts`（PUT）
- `src/server/import/memo-parse.ts`（純関数パーサ）
- `src/server/import/memo-preview.ts` + `src/app/api/sessions/import-memo/preview/route.ts`
- `src/server/import/memo-commit.ts` + `src/app/api/sessions/import-memo/commit/route.ts`
- `src/server/validation/import-memo.ts`（memo preview/commit の zod スキーマ・型）
- tests: `tests/import/memo-parse.test.ts` / `tests/api/session-participants.test.ts` /
  `tests/api/import-memo.test.ts`（+ sessions.test.ts への cascade ケース追加）

**再利用（新規実装しない）:** `normalizeTitle`, `rankTitleCandidates`(preview.ts),
`assertInstrumentCodes`(commit.ts), create_stub/venue-insert/perf-採番 パターン(commit.ts),
`masters.createInstrument`(未知コードのクイック追加), `tests/api/helpers.ts`。

---

## PLANNING COMPLETE
- Unit: unit-02-session-detail-schema-import-api / Tasks: 7 / Criteria: 8/8 / Risks: 5
- 主要判断: (1) memo は import_jobs を使わず 2 エンドポイント（commit は再パースなし・テキスト非受領）
  で「補正が失われない」を構造的に保証、(2) instruments マスタにリズム隊コードが無い問題は
  preview「要確認」+ 未知コード 400 + クイック追加で解決、(3) cascade は unit-01 の挿入ポイントへ 1 行。
