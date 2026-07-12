# Plan: unit-03-master-session-api (Bolt 1)

**Branch:** `ai-dlc/next-call-mvp/03-master-session-api`
**Worktree:** `/Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-mvp-03-master-session-api`
**Intent:** next-call-mvp ／ Discipline: backend

## 前提（既存コードの確認結果）

- **schema.ts は列が揃っている**（songs.titleNormalized / needsReview / hasPlayed、sessions.status(ACTIVE/ENDED)、performances.orderIndex、performanceFrontInstruments PK=(performanceId, position)、settings key-value）。**追加マイグレーション不要**。
- **DB アクセス**: `src/db/client.ts` の `getDb()`（lazy singleton、`DATABASE_PATH` 環境変数）。better-sqlite3 なので `db.transaction()` は**同期**。`foreign_keys = ON` 済み。
- **認証**: `src/middleware.ts` が全ルート保護済み（`/api/health`・`/api/auth/*`・`/login` のみ公開）。**Route Handler 側の追加認証コードは不要**。未認証リダイレクトのテストは `src/lib/route-guard.ts` の純関数 + 既存 `tests/auth/middleware.test.ts` パターンで検証する。
- **テスト方式（確定）**: `tests/api/health.test.ts` の既存パターンに従い、**Route Handler を直接 import して呼ぶ**（サーバー起動なし）。`vi.stubEnv("DATABASE_PATH", tmpfile)` + `vi.resetModules()` で DB シングルトンを隔離。Next.js 15 なので dynamic route の `params` は **Promise**（`{ params: Promise<{ id: string }> }`）。
- **シード**: `src/db/seed.ts` に GENRE_TAG_NAMES（9種）・INSTRUMENT_SEEDS（12種）・SETTING_SEEDS（engine.* 全キー）が定義済み。settings PUT の「既知キー」は `SETTING_SEEDS` のキー集合から導出する。
- **zod**: node_modules に 3.25.76 が transitive で存在するが **package.json の dependencies に無い** → 明示的に `npm install zod` で追加する（タスク1）。
- **titleNormalized**: songs に NOT NULL 列があるが正規化関数が未実装 → 本ユニットで `src/lib/normalize-title.ts` として実装（unit-08 が再利用する契約）。

## タスク分割

### Task 1: API 規約の定義（エラー形式・validation 置き場・zod 導入）— 最初に実施
**対象基準:** #7（統一エラー形式）＋全タスクの土台
- `npm install zod`（dependencies へ明示追加）
- `src/server/http/errors.ts`: 統一エラー形式 `{ error: { code, message, details? } }` のビルダー
  - `apiError(status, code, message, details?)` → `NextResponse.json`
  - コード規約: `VALIDATION_ERROR`(400) / `NOT_FOUND`(404) / `CONFLICT`(409) / `INTERNAL_ERROR`(500)
- `src/server/http/handler.ts`: `withErrorHandling(fn)` ラッパー — 未捕捉例外を `console.error`（スタック出力、observable基準）して 500 統一形式で返す。`ApiError` throw → 対応ステータス変換。zod parse 失敗 → 400 + `details`（zod issues）
- `src/server/validation/README.md` 相当のヘッダコメント + `src/server/validation/common.ts`（id パラメータ、boolean クエリ等の共通スキーマ）。**このディレクトリが後続ユニット（04/08）の規約になる旨をコメントで明示**
- `src/lib/normalize-title.ts`: 全半角・大小・前後空白の正規化（NFKC + toLowerCase + trim + 連続空白圧縮）
- テスト: `tests/api/errors.test.ts`（形式・console.error 呼び出しの unit テスト）

### Task 2: テストヘルパ + 未認証保護の検証
**対象基準:** #1（未認証リダイレクト）
- `tests/api/helpers.ts`: `setupTestDb()` — mkdtemp + stubEnv(DATABASE_PATH) + `runMigrations` + `seedDatabase`、afterEach で `vi.unstubAllEnvs()` + `vi.resetModules()`。route module の dynamic import ヘルパ
- `tests/auth/api-protection.test.ts`: `shouldRedirectToLogin` が `/api/songs`, `/api/sessions`, `/api/settings`, `/api/export` 等の新規パスで true（未認証時）/ false（認証時）を返すことを検証

### Task 3: 曲マスター（songs リポジトリ + Routes + クイック登録）
**対象基準:** #1, #2（クイック登録 409）
- `src/server/repositories/songs.ts`:
  - `listSongs({ q, needsReview, genre, season, hasPlayed, sort })` — title 部分一致、ジャンルタグ配列を含めて返す（songGenreTags join）。sort: `title` | `updated`
  - `createSong(input)` — ジャンルタグ名配列 → id 解決 → txn で songs + song_genre_tags 挿入。title 重複は 409（unique 制約を事前チェック）。titleNormalized を自動計算
  - `updateSong(id, patch)` — 部分更新（needs_review 解除含む）。genreTags 指定時は txn で差し替え。updatedAt 更新
  - `deleteSong(id)` — performances（または recommendation_candidates）が参照 → `CONFLICT`。txn で song_genre_tags・pending_songs の行を先に削除してから本体削除
  - `quickCreateSong(title)` — 正規化後 title 完全一致の既存曲があれば `{ conflict: existingSong }`、なければ needs_review=true, has_played=false, 他既定値で作成
- Routes: `src/app/api/songs/route.ts`（GET/POST）、`src/app/api/songs/[id]/route.ts`（PATCH/DELETE）、`src/app/api/songs/quick/route.ts`（POST — 409 時にレスポンス body へ既存曲を含める）
- validation: `src/server/validation/songs.ts`（listenerLevel/energyLevel 1–5、season/form enum、genreTags は固定9種名）
- テスト: `tests/api/songs.test.ts` — CRUD 正常系、検索/フィルタ/ソート、400（不正 enum）、title 重複 409、参照中削除 409、**クイック登録（needs_review=true 作成・同名 409 + 既存曲返却）**

### Task 4: 楽器・ジャンル・店舗マスター
**対象基準:** #1
- `src/server/repositories/masters.ts`:
  - instruments: list（sortOrder 順）/ create（code 重複 409）/ delete（performance_front_instruments が参照 → 409）
  - genreTags: list のみ（読み取り専用）
  - venues: list / create（**is_home 必須**、name 重複 409）/ update（name, is_home）
- Routes: `src/app/api/instruments/route.ts`・`src/app/api/instruments/[code]/route.ts`（DELETE）・`src/app/api/genre-tags/route.ts`・`src/app/api/venues/route.ts`・`src/app/api/venues/[id]/route.ts`
- validation: `src/server/validation/masters.ts`（venues POST で isHome を required boolean に）
- テスト: `tests/api/masters.test.ts` — シード12楽器の取得、追加、使用中楽器の削除 409、genre-tags 固定9種、venue の isHome 必須 400・重複 409

### Task 5: 設定 API
**対象基準:** #1
- `src/server/repositories/settings.ts`: `getAllSettings()`（value を JSON.parse して返す）/ `putSettings(entries)`（upsert + updatedAt）
- validation: `src/server/validation/settings.ts` — **既知キーのみ許可**。`SETTING_SEEDS` のキー集合から zod スキーマを構築し、キーごとに型検証（number / boolean / object）。未知キーは 400
- Routes: `src/app/api/settings/route.ts`（GET / PUT — 単一キーも複数キーも同じ body 形式 `{ key: value, ... }` で受ける）
- テスト: `tests/api/settings.test.ts` — engine.* 全キー取得、個別/一括更新、未知キー 400、型不一致 400

### Task 6: セッション API
**対象基準:** #1, #5（ACTIVE 二重開始 409）
- `src/server/repositories/sessions.ts`:
  - `startSession({ sessionDate?, venueId, hasListeners })` — sessionDate 既定 = **JST 当日**（`Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" })` 等。schema.ts コメント「JST を正とする」に準拠）。txn 内で ACTIVE 存在チェック → あれば `CONFLICT`（既存セッション id を details に）
  - `getActiveSession()` — 進行中セッション + 演奏記録一覧（各 performance にフロント編成を position 順で含める）。無ければ null（Route は 404）
  - `listSessions()` / `getSession(id)` — 履歴一覧（venue 名含む）・詳細（演奏記録+編成含む）
  - `updateSession(id, { hasListeners?, note?, status? })` — status は `ENDED` への遷移のみ許可
- Routes: `src/app/api/sessions/route.ts`（GET/POST）、`src/app/api/sessions/active/route.ts`（GET）、`src/app/api/sessions/[id]/route.ts`（GET/PATCH）
- validation: `src/server/validation/sessions.ts`
- テスト: `tests/api/sessions.test.ts` — 開始（既定日付 JST）、**二重開始 409**、active 取得（編成含む）、has_listeners 切替、ENDED 終了、終了後は再度 POST で新規開始可能、存在しない venue_id 400/404

### Task 7: 演奏記録 API（has_played 自動更新・order_index 管理）
**対象基準:** #1, #3（has_played 自動更新）, #4（フロント編成 順序・重複）
- `src/server/repositories/performances.ts`:
  - `addPerformance(sessionId, input)` — **単一 txn 内で**: (a) `quick_title` 指定時は `quickCreateSong` を内部呼び出し（既存同名曲があればその曲を使用 — 演奏記録追加の文脈では 409 にせず既存曲へ紐付け）、(b) `order_index = COALESCE(MAX(order_index), 0) + 1`、(c) performances 挿入、(d) front_instruments を position 0.. で挿入、(e) **participated=true なら songs.has_played = true に更新**。song_id と quick_title は排他（zod refine）。ENDED セッションへの追加は 409
  - `updatePerformance(id, patch)` — 部分更新。front_instruments 指定時は txn で全削除→再挿入。participated が false→true になる場合も has_played 更新を発火
  - `deletePerformance(id)` — txn 内で front_instruments → 本体削除 → **同一セッション内の order_index を 1..N に詰め直し**。**has_played は巻き戻さない（仕様として明記）**
- Routes: `src/app/api/sessions/[id]/performances/route.ts`（POST）、`src/app/api/performances/[id]/route.ts`（PATCH/DELETE）
- validation: `src/server/validation/performances.ts`（instrument enum SAX/PIANO/NONE、front_instruments: `[{ code, position }]`、code は instruments マスター存在チェック）
- テスト: `tests/api/performances.test.ts`
  - order_index が max+1 で採番される／途中削除で 1..N に詰め直される（3件登録→2件目削除→残りが 1,2）
  - **participated=true 追加で has_played が false→true（DB を直接読んで検証）**
  - **演奏記録を削除しても has_played は true のまま（巻き戻さない）**
  - participated=false では has_played が変わらない
  - **フロント編成 `vo, as, as, ts` が順序・重複を保持して保存され、GET で同順で返る**
  - quick_title 経由の追加（needs_review 曲が作られ紐付く）、song_id と quick_title 両指定 400

### Task 8: エクスポート API
**対象基準:** #6
- `src/server/repositories/export.ts`: `exportAll()` — **全12テーブル**（songs, genre_tags, song_genre_tags, instruments, venues, sessions, performances, performance_front_instruments, recommendation_requests, recommendation_candidates, pending_songs, settings）+ `exported_at` / `schema_version`（migration journal 由来 or 固定値）を単一 JSON に
- Route: `src/app/api/export/route.ts`（GET） — `Content-Disposition: attachment; filename="next-call-export-YYYYMMDD.json"`、`Content-Type: application/json`
- テスト: `tests/api/export.test.ts` — 全テーブルキーの存在、**曲・演奏記録を投入後に export の件数が DB の COUNT と一致**、attachment ヘッダ検証

### Task 9: 網羅チェック + 品質ゲート
**対象基準:** #1（網羅）, #8（deployable）
- unit spec のエンドポイント一覧を describe 単位で網羅する確認テスト（各 route ファイルの export 存在チェックを含む）
- `npm run typecheck && npm run lint && npm run test && npm run build` 全パス
- **新規環境変数なし**の確認（DATABASE_PATH のみ使用、`.env` 追加なし）— 基準 #8 は「zod の dependencies 追加のみでインフラ変更なし」をレビューノートに明記

## 成功基準 → 検証マッピング（8/8）

| # | 基準 | 検証 |
|---|------|------|
| 1 | 全エンドポイント + 異常系統合テスト | Task 3–8 の各テスト + Task 2（未認証）+ Task 9（網羅） |
| 2 | クイック登録（needs_review / 同名 409） | tests/api/songs.test.ts |
| 3 | participated=true → has_played 自動更新 | tests/api/performances.test.ts |
| 4 | フロント編成 vo,as,as,ts の順序・重複保持 | tests/api/performances.test.ts |
| 5 | ACTIVE 二重開始 409 | tests/api/sessions.test.ts |
| 6 | export 全テーブル + 件数一致 + attachment | tests/api/export.test.ts |
| 7 | 統一エラー形式 + console.error | tests/api/errors.test.ts + 各テストの異常系で形式アサート共通ヘルパ `expectApiError(res, status, code)` |
| 8 | 環境変数・インフラ変更なし | Task 9（build 通過 + 差分確認） |

## リスクと対応

1. **エンドポイント肥大・漏れ**（spec 記載リスク）— 仕様のエンドポイント一覧をテストの describe 構造に 1:1 対応させ、Task 9 で網羅チェック。リポジトリ層と Route 層を分離し Route は薄く保つ
2. **order_index の欠番/重複**（spec 記載リスク）— 採番・詰め直しを必ず `db.transaction()`（better-sqlite3 同期 txn）内で実施。テストで削除後の連番を検証
3. **has_played 巻き戻し誤実装**（spec 記載リスク）— 「削除で false に戻さない」をリポジトリ関数の JSDoc に明記し、専用テストで固定
4. **Next.js 15 の params Promise 化** — dynamic route で `await params` を徹底。typecheck で検出されるが、handler 直接呼び出しテストでも第2引数に `{ params: Promise.resolve({ id }) }` を渡す規約をヘルパ化
5. **zod が transitive 依存のみ** — `npm install zod` で明示追加（lockfile 更新のみ、新規インフラなし）
6. **quick 登録の「完全一致」判定揺れ** — 正規化（normalize-title）後の一致で判定し、`POST /api/songs/quick` 単体では 409 + 既存曲返却、演奏記録追加の内部呼び出しでは既存曲に紐付け（409 にしない）。両ケースをテストで固定
7. **settings の既知キー検証の陳腐化** — SETTING_SEEDS のキー集合から動的にスキーマを構築し、シード追加時に自動追従させる

## 後続ユニットへの契約（実装時に README コメントで明示）

- エラー形式・エラーコードは `src/server/http/errors.ts` が唯一の定義
- zod スキーマは `src/server/validation/` 配下（unit-04/08 が従う）
- `src/lib/normalize-title.ts` は unit-08 の CSV インポートの曲名マッチでも使用する
- unit-05 向け: venues POST の is_home は必須（初回登録時の一度だけの判定は UI 側の責務）