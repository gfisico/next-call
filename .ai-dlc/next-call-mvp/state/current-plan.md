# Bolt Plan: unit-01-app-foundation (Bolt 1)

**Intent:** next-call-mvp
**Unit:** unit-01-app-foundation
**Branch:** ai-dlc/next-call-mvp/01-app-foundation
**Worktree:** /Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-mvp-01-app-foundation
**作成日:** 2026-07-12
**前提:** リポジトリはほぼ空（.gitignore のみ）。全7基準が未達。本 Bolt で全基準の達成を狙う。

## 進捗評価

- 実装物ゼロ。package.json すら存在しない。
- 参照ソース: `.ai-dlc/next-call-mvp/unit-01-app-foundation.md`（Technical Specification）、`discovery.md`（Domain Model / Provisional Values が唯一の情報源）、`docs/design_rule.md`（トークン定義。unit worktree に docs/ が無ければ git 上（main）の同ファイルを取り込む）。

## 技術方針（Builder への指示）

- Next.js 15 (App Router) + TypeScript strict + Tailwind CSS + shadcn/ui。`create-next-app` をワークツリー直下に展開（**src/ ディレクトリ採用**。discovery.md のディレクトリ構成案に従う: `src/app`, `src/db`, `src/lib`, `src/components`）。
- ORM: Drizzle + better-sqlite3（同期）。`DATABASE_PATH`（既定 `./data/next-call.db`）。WAL + busy_timeout。
- 認証: Auth.js v5（next-auth@beta）Google provider、JWT セッション、DB アダプタなし。
- テスト: Vitest（node 環境中心）。jsdom / testing-library は最小限。
- 環境変数の契約: `DATABASE_PATH`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS`, `TZ=Asia/Tokyo`。`.env.example` をコミット、`.env.local` に開発用ダミー値。build/test が実環境変数なしで通るよう env 参照は遅延化する。

---

## タスク（実行順）

### Task 1: プロジェクト初期化
**対象基準:** #6（品質ゲート）の土台
- `npx create-next-app@latest`（Next.js 15, TypeScript, Tailwind, ESLint, App Router, src/）をワークツリー直下に生成。既存 `.gitignore` とマージ（`data/`, `*.db*`, `.env*` を追加）。
- `tsconfig.json` の `"strict": true` を確認。
- `next.config.ts` に `serverExternalPackages: ["better-sqlite3"]`（standalone 化は unit-09 スコープ）。
- `docs/design_rule.md` 等が worktree に無ければ main から取り込む。
- **検証:** dev 起動 or build 通過。

### Task 2: デザイントークン + shadcn/ui 導入
**対象基準:** #4
- `npx shadcn@latest init` 後、`src/app/globals.css` に design_rule.md §1.1 の必須トークンを **Light（:root）/ Dark（.dark）両方**定義: --background/--foreground/--card/--card-foreground/--popover/--popover-foreground/--muted/--muted-foreground/--border/--input/--ring/--primary/--primary-foreground/--secondary/--secondary-foreground/--accent/--accent-foreground/--destructive/--destructive-foreground + semantic --success/--success-foreground/--warning/--warning-foreground/--info/--info-foreground。
- トークン命名は shadcn 標準に一致させ `bg-background` 等がそのまま効くこと（Tailwind v4 の場合は `@theme inline` に success/warning/info もマッピング追加）。
- shadcn コンポーネント導入: Button / Card / Badge / Input / Dialog / Sheet / Slider / Checkbox / Select / Table / Toast（現行 shadcn で toast が sonner に置換されている場合は sonner で代替し意図＝トースト通知手段を満たす）。
- **検証テスト:** `tests/design-tokens.test.ts` — globals.css を読み、必須トークンが Light/Dark 両ブロックに存在することを assert。

### Task 3: DB スキーマ定義（src/db/schema.ts）
**対象基準:** #1
- 全12テーブルを discovery.md「Domain Model」に厳密準拠で定義（黒本キー=song_key 等、仕様用語との対応コメント付き）:
  - `songs`: title(+title_normalized), song_key, form(AABA/ABAC/BLUES12/OTHER), composer, has_played, no_chart_ok, is_standard, simple_form, in_kurobon1, season(SPRING/SUMMER/AUTUMN/WINTER/ALL, default ALL), listener_level(default 3), energy_level(default 3), needs_review(default false), note, created_at/updated_at
  - `genre_tags`: id, name UNIQUE
  - `song_genre_tags`: (song_id, genre_tag_id) 複合PK
  - `instruments`: code PK, label, sort_order
  - `venues`: id, name UNIQUE, is_home, created_at
  - `sessions`: id, session_date(ISO date text), venue_id FK, has_listeners, status(ACTIVE/ENDED), note, created_at
  - `performances`: id, session_id FK, song_id FK, order_index, participated, instrument(SAX/PIANO/NONE), called_by_me, no_chart, note, created_at
  - `performance_front_instruments`: performance_id FK, instrument_code FK, position（順序付き・同一楽器重複可 → PK=(performance_id, position)）
  - `recommendation_requests`: id, session_id FK, requested_at, horns(ONE/MULTI/UNKNOWN), beginner(NONE/PRESENT/UNKNOWN), kurobon1_only, genre_override(JSON), intent スナップショット列（rare/long_unplayed/safety/mood/ballad: int −2..+2、seasonal/listener_focus: bool）, condition_signature, pool_size
  - `recommendation_candidates`: id, request_id FK, song_id FK, candidate_type(NORMAL/ONE_HORN/MULTI_HORN/BEGINNER), score, reasons(JSON), is_conditional, condition_label, display_order
  - `pending_songs`: song_id FK UNIQUE, created_at
  - `settings`: key TEXT PK, value TEXT(JSON), updated_at
- `src/db/client.ts`: better-sqlite3 + WAL + busy_timeout。`DATABASE_PATH` 読み取りは遅延（lazy singleton、import 時に接続しない）。
- `drizzle.config.ts` + `npm run db:generate`（→ `src/db/migrations/`）+ `npm run db:migrate`。
- **検証:** migrate 後 `sqlite3 data/next-call.db ".tables"` で全12テーブル確認。

### Task 4: シードスクリプト（冪等）
**対象基準:** #1
- `scripts/seed.ts`（`npm run db:seed`、tsx 実行）:
  - genre_tags 9種: バラード/ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環/キメが多い曲
  - instruments 12種: vo, ss, as, ts, bs, tp, fl, fh, harm, tb, cl, g（label + sort_order）
  - settings: discovery.md「Provisional Values」を唯一の情報源として全キー投入 — engine.appearance_window_days=730, engine.same_key_penalty=15, engine.same_key_penalty_overrides={"F":8,"Bb":8}, engine.consecutive_genre, engine.multi_horn_vocal_penalty=15, engine.safety_weights, master.default_level=3, engine.pool_band=10, engine.pool_band_relaxed=15, engine.score_floor=30, engine.random_temperature=5, engine.repeat_penalties, engine.repeat_window_days=30, engine.relax_pool_threshold=8, engine.candidate_count=3, pending.auto_release_on_call=true, engine.genre_override_bonus=15, engine.after_vocal_vocal_penalty=15, engine.low_freq_threshold=0.05, engine.low_freq_penalty=8, engine.low_freq_waiver_bonus=10, engine.base_score=50, engine.slider_weights, engine.seasonal_bonus=10, engine.listener_weight=4, engine.season_months, engine.long_unplayed_days=365, engine.blues_penalty=10, engine.same_composer_penalty=5, engine.top_called_n=10, engine.top_called_penalty=12, engine.first_song_seasonal_default=true
  - 冪等性: INSERT ... ON CONFLICT DO NOTHING（settings は既存値を上書きしない＝ユーザー調整値の保護）。
- **検証テスト:** `tests/db/seed.test.ts` — tmp の一時 DB に migrate+seed し、(a) 全12テーブル存在、(b) genre_tags=9件（名称一致）、(c) instruments=12件（コード一致）、(d) engine.* が Provisional Values どおり、(e) 2回実行で件数不変（冪等）を assert。

### Task 5: 起動時マイグレーション自動適用
**対象基準:** #7
- `src/instrumentation.ts` の `register()`（`NEXT_RUNTIME === "nodejs"` 分岐）で drizzle `migrate()` を実行。マイグレーションパスは実行時解決（`path.join(process.cwd(), "src/db/migrations")`。standalone 同梱調整は unit-09、コメント明記）。
- `next build` は DB 不要（instrumentation は build で走らない／DB は lazy）。
- **検証:** `rm -rf data/ && npm run build && npm run start` → 起動でマイグレーション適用 → `curl /api/health` が db ok。加えて `tests/db/migrate.test.ts`（instrumentation が呼ぶ関数を共通化し「空 DB → 全テーブル」を検証）。

### Task 6: 認証（Auth.js v5 + 許可メールリスト）
**対象基準:** #2, #3
- `src/lib/auth.ts`: Google provider、`session: { strategy: "jwt" }`、signIn コールバックで email を ALLOWED_EMAILS（カンマ区切り、trim + 小文字比較）と照合し不一致は拒否。**判定は純関数 `isAllowedEmail(email, allowedEmailsEnv)` に切り出す**。
- `src/app/api/auth/[...nextauth]/route.ts`、`middleware.ts`: `/api/health`・`/login`・`/api/auth/*`・静的アセット以外の全ルートを保護。未認証は `/login` へリダイレクト。除外判定 `isPublicPath(pathname)` も純関数化。
- `/login` ページ: Google サインインボタンのみ（Primary 1つ、h-10、focus-visible:ring-2、bg-background text-foreground）。
- Auth.js 公式の Next.js App Router ガイド構成に従い独自実装を避ける。
- **検証テスト:** `tests/auth/allowed-emails.test.ts`（許可/拒否/大小文字/空白/未設定/複数 + signIn コールバックの true/false）、`tests/auth/middleware.test.ts`（/api/health 素通り、/ /sessions /api/anything は /login へ）。

### Task 7: 共通レイアウト + プレースホルダーページ
**対象基準:** #4、#3 の対象ルート
- `src/app/layout.tsx`: `<body className="bg-background text-foreground ...">`、モバイルファースト app shell（ヘッダー + 下部固定ナビ: セッション `/` ／推薦 `/suggest` ／マスター `/songs` ／設定 `/settings`）。design_rule のクラス（text-muted-foreground、h-10 タップ領域、focus-visible）。
- 各ナビ先にダミーページ（「unit-0X で実装」の空 Card）。
- **検証:** design-tokens テストで layout.tsx が bg-background / text-foreground を含むことを assert。

### Task 8: ヘルスチェック API
**対象基準:** #5
- `src/app/api/health/route.ts`: 認証不要。`SELECT 1` で DB 確認し `{status:"ok", db:"ok"}` を 200。DB 失敗時は `{status:"error", db:"error"}` を 503（コンテナヘルスチェックの基点）。`export const dynamic = "force-dynamic"`。
- **検証テスト:** `tests/api/health.test.ts` — ハンドラ直接呼び出しで 200 + db:"ok"（tmp DB）。手動: 未認証 curl で 200。

### Task 9: 品質ゲート環境
**対象基準:** #6
- package.json scripts: typecheck(tsc --noEmit) / lint(eslint、next/core-web-vitals) / test(vitest run) / build(next build) / db:generate / db:migrate / db:seed / dev / start。
- `vitest.config.ts`: node 環境既定、`tests/**/*.test.ts`、vite-tsconfig-paths。
- **検証:** 4コマンド全て exit 0。

### Task 10: 最終検証 + コミット
1. `rm -rf data && npm run db:migrate && npm run db:seed` → seed テスト green（#1）
2. auth テスト green（#2, #3）
3. トークンテスト green（#4）
4. `npm run build && npm run start` → 未認証 curl /api/health = 200、curl -I / = /login リダイレクト（#3, #5）
5. 空 data で start → 自動マイグレーション適用（#7）
6. 4ゲート一括実行（#6）
- `.env.example` 整備（TZ=Asia/Tokyo 含む全6変数）。ブランチにコミット。

---

## 基準カバレッジ

| 基準 | タスク | 検証手段 |
|---|---|---|
| #1 migrate+seed で全テーブル+シード | 3, 4 | tests/db/seed.test.ts |
| #2 ALLOWED_EMAILS 判定 | 6 | tests/auth/allowed-emails.test.ts |
| #3 未認証 → /login（/api/health 除く） | 6, 7 | tests/auth/middleware.test.ts + 手動 curl |
| #4 トークン Light/Dark + bg-background 使用 | 2, 7 | tests/design-tokens.test.ts |
| #5 GET /api/health 認証なし 200 + DB 状態 | 8 | tests/api/health.test.ts + 手動 curl |
| #6 4ゲート全パス | 1, 9, 10 | 4コマンド一括実行 |
| #7 起動時マイグレーション自動適用 | 5 | tests/db/migrate.test.ts + 空DB起動確認 |

## リスクと対策

1. **スキーマの手戻り（後続ユニットで列不足）** — discovery.md のドメインモデル表を列単位で突合してから着工。RecommendationRequest に pool_size・condition_signature・intent 全列を漏らさず含める。以後は追加的マイグレーションのみ（列削除・改名禁止をスキーマにコメント明記）。
2. **Auth.js v5 (beta) × Next.js 15 の互換** — 公式 App Router ガイドの標準構成（auth.ts / route.ts / middleware.ts、JWT）のみ使用。middleware 判定は純関数に分離し、NextAuth 内部に依存するテストを書かない。
3. **better-sqlite3 のネイティブビルド** — ローカル Node 22 の prebuilt binary を使用。serverExternalPackages でバンドル除外し next build での取り込み事故を防止。Docker/CI（node:22-bookworm-slim）は unit-09 スコープ。
4. **Tailwind v4 と shadcn トークン形式の齟齬** — shadcn init の Tailwind v4 対応（@theme inline + CSS 変数）に従い、design_rule の変数名が bg-background 等に解決されることをトークンテストで担保。
5. **build 時の DB 依存 / instrumentation の副作用** — DB クライアント lazy 初期化、migrate は nodejs ランタイム分岐のみ。next build が DB なしで通ることを Task 10 で確認。
6. **env 未設定でのテスト/ビルド失敗** — isAllowedEmail 等は env を引数で受ける設計にしテストを env 非依存化。.env.example に全キー列挙、build 用ダミー値の要否を Task 1 で確認。

## ボルト境界（やらないこと）

推薦エンジン（unit-02/04）、マスター/記録 API（unit-03）、機能画面（unit-05/06/07）、CSV インポート（unit-08）、Docker/CI/CD（unit-09）。本 Bolt の画面はログイン + 空 app shell + プレースホルダーのみ。