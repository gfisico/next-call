---
status: pending
last_updated: ""
depends_on: []
branch: ai-dlc/next-call-mvp/01-app-foundation
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
deployment:
  target: docker
  artifacts: [drizzle-migrations]
  environments: [production]
monitoring:
  metrics: []
  dashboards: []
  alerts: []
  slos: []
operations:
  runbooks: []
  rollback: "マイグレーションは追加的（additive）に保ち、失敗時は直前イメージへ戻す（unit-09のデプロイ手順に従う）"
  scaling: "単一ユーザー・単一コンテナ。スケーリング不要"
---

# unit-01-app-foundation

## Description
next-call の土台を作る。Next.js プロジェクトの初期化、SQLite の全スキーマとマイグレーション、Google 認証（許可メールのみ）、design_rule.md 準拠のデザイントークン、品質ゲート（typecheck/lint/tests/build）の実行環境、ヘルスチェックまで。以降の全ユニットはこの上に構築される。

## Discipline
backend - This unit will be executed by backend-focused agents.

## Domain Entities
intent.md「Domain Model」の全エンティティのスキーマを本ユニットで定義する: Song, GenreTag(+song_genre_tags), Instrument, Venue, Session, Performance, PerformanceFrontInstrument, RecommendationRequest, RecommendationCandidate, PendingSong, Setting。SelectionIntent は RecommendationRequest 内のスナップショット（JSON列）+「前回値」保持用の Setting キーとして表現する。

## Data Sources
- SQLite ファイル（開発: `./data/next-call.db`、本番: `/data/next-call.db`。環境変数 `DATABASE_PATH` で指定）
- Drizzle ORM + better-sqlite3（同期ドライバ）。マイグレーションは drizzle-kit generate で生成し、**アプリ起動時に自動適用**する
- 環境変数: `DATABASE_PATH`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS`（カンマ区切り許可メール）

## Technical Specification

1. **プロジェクト初期化**: Next.js 15 (App Router) + TypeScript strict + Tailwind CSS + shadcn/ui。`create-next-app` 相当の構成に、`docs/design_rule.md` のカラートークン（--background/--foreground/--card/--muted/--border/--primary/--destructive 等 + success/warning/info）を `app/globals.css` に Light/Dark 両対応で定義。shadcn/ui の Button/Card/Badge/Input/Dialog/Sheet/Slider/Checkbox/Select/Table/Toast を導入
2. **スキーマ定義**（`src/db/schema.ts`）: 上記全エンティティ。主なポイント:
   - songs: needs_review(bool, default false), season は enum(SPRING/SUMMER/AUTUMN/WINTER/ALL), listener_level/energy_level は 1–5 int default 3
   - genre_tags: 固定9種を初期シード（バラード/ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環/キメが多い曲）
   - instruments: 初期シード vo, ss, as, ts, bs, tp, fl, fh, harm, tb, cl, g（code + label + sort_order）。追加可能
   - performance_front_instruments: (performance_id, instrument_code, position) — 順序付き・同一楽器の重複可
   - recommendation_requests: 編成条件・意図値・condition_signature・created_at をスナップショット保存。recommendation_candidates: (request_id, song_id, score, reasons JSON, is_conditional, condition_label)
   - settings: (key TEXT PRIMARY KEY, value TEXT[JSON])。engine.* の暫定値を初期シード（値は discovery.md「Provisional Values」に従う）
3. **認証**（Auth.js v5）: Google provider。`signIn` コールバックで `ALLOWED_EMAILS` に含まれないメールを拒否。JWT セッション戦略（DBユーザーテーブルなし）。middleware で `/api/health` と認証ルート以外の全ルートを保護し、未認証は `/login` へリダイレクト。`/login` は Google サインインボタンのみのシンプル画面（design_rule 準拠）
4. **共通レイアウト**: モバイルファーストの app shell（ヘッダー + 下部ナビ: セッション/推薦/マスター/設定）。ダミーのプレースホルダーページで全ナビ先を用意（後続ユニットが差し替える）
5. **ヘルスチェック**: `GET /api/health` — 認証不要。DB接続確認を含め `{status:"ok", db:"ok"}` を返す
6. **品質ゲート環境**: package.json scripts — `typecheck`(tsc --noEmit), `lint`(eslint), `test`(vitest run), `build`(next build)。vitest + testing-library セットアップ。ESLint は next/core-web-vitals ベース
7. **シードスクリプト**: `npm run db:seed` — ジャンルタグ・楽器・engine.* 設定の初期値投入（冪等）

## Success Criteria
- [ ] `npm run db:migrate && npm run db:seed` 後、全テーブルが作成され、ジャンルタグ9種・楽器12種・engine.* 設定が投入されている（テストで検証）
- [ ] ALLOWED_EMAILS に含まれる Google アカウントでログインでき、含まれないアカウントはサインイン拒否される（signIn コールバックの単体テスト）
- [ ] 未認証で任意のページ/APIにアクセスすると /login にリダイレクトされる（/api/health を除く）
- [ ] app/globals.css に design_rule.md の必須トークンが Light/Dark 両方定義され、共通レイアウトが bg-background/text-foreground を使用している
- [ ] GET /api/health が認証なしで 200 と DB 接続状態を返す（deployable/observable: コンテナのヘルスチェックと監視の基点）
- [ ] typecheck / lint / test / build の4ゲートすべてがローカルでパスする
- [ ] マイグレーションがアプリ起動時に自動適用される（deployable: 新規コンテナ起動だけでスキーマが最新化。operable: ロールバックは直前イメージへの切替のみで成立）

## Risks
- **スキーマの手戻り**: 後続ユニットの実装で列不足が判明する可能性。影響: マイグレーション追加。Mitigation: 追加的マイグレーションで対応（列削除・改名を避ける）。discovery.md のドメインモデルを厳密に反映してから着工する
- **Auth.js v5 と Next.js 15 の組み合わせ**: バージョン互換の落とし穴。Mitigation: Auth.js 公式の Next.js App Router ガイド構成に従い、独自実装を避ける
- **better-sqlite3 のネイティブビルド**: Docker/CI でのビルド失敗リスク。Mitigation: unit-09 と同じ node:22-bookworm-slim を CI でも使用

## Boundaries
このユニットは各機能のAPI・画面を実装しない: マスター/記録APIは unit-03、推薦は unit-02/04、画面は unit-05/06/07、CSVインポートは unit-08、Docker/CI/CDは unit-09。本ユニットの画面はログイン画面と空のapp shellのみ。

## Notes
- design_rule.md のトークン命名は shadcn/ui 標準に一致させる（bg-background 等がそのまま効く状態にする）
- 設定キーの初期値は discovery.md「Provisional Values」の表を唯一の情報源とする
- schema.ts は後続全ユニットが参照する契約。列名は仕様書の用語（黒本キー=song_key 等）との対応コメントを付す
