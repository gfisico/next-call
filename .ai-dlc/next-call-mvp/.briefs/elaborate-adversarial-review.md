---
intent_slug: next-call-mvp
worktree_path: /Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-mvp
---

# Intent

---
workflow: default
git:
  change_strategy: intent
  auto_merge: true
  auto_squash: false
announcements: [changelog]
passes: []
active_pass: ""
iterates_on: ""
created: 2026-07-12
status: active
epic: ""
quality_gates:
  - name: typecheck
    command: npm run typecheck
  - name: lint
    command: npm run lint
  - name: tests
    command: npm run test
  - name: build
    command: npm run build
---

# next-call — ジャズセッション向け選曲提案アプリ MVP

## Problem

ジャズセッションで「次に何をコールするか」を決めるには、当日すでに演奏された曲・直前の曲のキーや構成・過去約5年の演奏履歴・自分の選曲傾向・編成（管楽器人数、初心者の有無）・その時の意図（攻めるか安全か、盛り上げるか等）を全部踏まえる必要があり、演奏の合間の短い時間では負荷が高い。結果として似た条件で同じ曲ばかり選びがちで、発想も広がらない。既存の記録はiPhoneメモで、集計や参照に使えない。

## Solution

セッション中のセットリストをリアルタイム記録しながら、記録がそのまま演奏履歴として蓄積されるモバイル対応Webアプリを構築する。「次の曲を考える」モードでは、再現可能・説明可能な固定ロジック（9ステージの純関数パイプライン：完全除外→編成条件→強制条件→スコアリング→繰り返し減点→候補集団→重み付き抽選→固定テンプレート理由生成→条件別ブランチ）が候補約3曲を推奨理由付きで30秒以内に提示する。最終判断は利用者自身。AIによる理由生成は初期版では使わない。

技術構成: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui（docs/design_rule.md 準拠）／ SQLite + Drizzle ORM ／ Auth.js（Google・許可メールのみの単一ユーザー）／ VPSへDocker配置、GitHub Actions自動デプロイ。

## Domain Model

詳細は `.ai-dlc/next-call-mvp/discovery.md` を参照（一次仕様: `docs/jazz_session_song_recommendation_spec_v2.md`）。

### Entities

- **Song（曲マスター）**: 推薦の中心 — title, song_key(黒本キー), form(AABA/ABAC/BLUES12/OTHER), composer, has_played(演奏経験=コール可能判定), no_chart_ok, is_standard(超定番), simple_form, in_kurobon1, season(SPRING/SUMMER/AUTUMN/WINTER/ALL), listener_level(1–5), energy_level(1–5), needs_review(属性未整備・クイック登録用), note
- **GenreTag**: 固定9種（バラード/ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環/キメが多い曲）。Song と多対多
- **Instrument（楽器マスター）**: vo, ss, as, ts, bs, tp, fl, fh, harm, tb, cl, g を初期値とし追加可能
- **Venue（店舗マスター）**: name, is_home（母店/母店以外。初回登録時に一度だけ判定）
- **Session**: session_date, venue_id, has_listeners（セッション中変更可）, status(ACTIVE/ENDED), note
- **Performance（演奏記録）**: session_id, song_id, order_index, participated, instrument(SAX/PIANO/NONE), called_by_me, no_chart(事実記録), note。自分不参加の曲も全記録
- **PerformanceFrontInstrument（フロント編成）**: performance_id, instrument_code, position。順序付き・重複可（例: vo, as, as, ts）。任意入力。§12.5のヴォーカル判定は直前Performanceのフロント編成に vo が含まれるかで行う
- **SelectionIntent（選曲意図）**: 5段階スライダー×5（珍しい曲/久しぶり/安全⇔攻める/落ち着かせる⇔盛り上げる/バラード）+ チェック×2（季節感/リスナー向け）。前回値引き継ぎ
- **RecommendationRequest / RecommendationCandidate（推薦履歴）**: 条件・意図スナップショット + condition_signature + 提示曲・score・reasons。繰り返し減点の根拠
- **PendingSong（保留曲）**: song_id + created_at。セッションまたぎ保持、スコア不干渉、コール時に自動解除
- **Setting**: key-value。§21未確定事項の全暫定値を設定化（engine.* キー）
- **User**: DBテーブルなし（Auth.js JWT + ALLOWED_EMAILS 許可リスト）

### Relationships

- Venue 1—N Session 1—N Performance N—1 Song
- Song N—M GenreTag ／ Performance 1—N PerformanceFrontInstrument N—1 Instrument
- Session 1—N RecommendationRequest 1—N RecommendationCandidate N—1 Song
- Song 1—0..1 PendingSong

### Data Sources

- **SQLite（VPS、唯一の永続層）**: 全エンティティ。曲数百・演奏記録数千行規模
- **iPhoneメモ（約5年分の履歴+曲マスター元データ）**: 実データフォーマット未入手。songs.csv / setlists.csv のCSV受け口で取込（列定義は discovery.md）
- **PiaScore（季節曲）**: 自動連携なし。CSVのseason列へ手動転記

### Data Gaps

- iPhoneメモの実フォーマット未入手 → インポート実装前にサンプル提供が必要（unit-08のリスクに記載）
- 仕込み済み曲はアプリ管理外 → アプリ内コール可能曲 = has_played=true のみ
- 母店の実店舗名 → 設定 + 初回登録UIで確定

## Success Criteria

- [ ] セッション記録: セッション開始（店舗・リスナー客）→ 曲の追加（曲名・参加有無・楽器・コール有無・譜面なし・フロント編成）→ 終了までがモバイルUIで完結し、SQLiteに永続化される。マスタ未登録曲は曲名のみのクイック登録（needs_review付き）で記録できる
- [ ] 推薦の正しさ: 「次の曲を考える」→ 編成条件・選曲意図調整 → 通常候補約3曲が推奨理由（各2件以上）付きで表示される。完全除外ルール（当日演奏済み／直前と同構成／コール不能曲／初心者AND条件違反／黒本1制約違反）に該当する曲が通常候補に一切出ないことがエンジン単体テストで検証される
- [ ] 繰り返し防止: 同一条件での連続リクエストで、直前に提示した曲・同一特殊ジャンルばかりが繰り返されない（繰り返し減点・重み付き抽選がテストで検証される）
- [ ] 編成不明時: 管楽器・初心者が「わからない」のとき条件別候補が表示される
- [ ] 保留曲: 保留登録 → セッションをまたいで表示 → コール（演奏登録）時に自動解除、が動作する
- [ ] 一括インポート: songs.csv / setlists.csv で曲マスター＋約5年分の履歴を投入でき、登場回数・久しぶり度の集計に反映される
- [ ] 性能（NFR）: 曲マスター500曲・演奏記録5,000件の条件で推薦APIのp95応答が2秒未満。「次の曲を考える」から候補表示までタップ3回以内
- [ ] データ保護（NFR）: SQLiteの週次バックアップが20世代保持され、任意断面をピン留めスナップショットとして明示削除まで永続保持できる。全データをエクスポートできる
- [ ] 認証: 許可リスト外のGoogleアカウントはサインイン拒否。未認証アクセスは全ルートでログインにリダイレクト
- [ ] 品質・デザイン: typecheck / lint / test / build がCIで全てパスし、全画面が docs/design_rule.md に準拠する（Primary1つ/h-10/focus-visible/コントラスト等）

## Context

- 一次仕様書: `docs/jazz_session_song_recommendation_spec_v2.md`（852行）。デザインルール: `docs/design_rule.md`
- 仕様§21の未確定事項はすべて暫定値で実装し、Setting（engine.*）から調整可能にする。暫定値一覧は discovery.md「Provisional Values」
- ドメインモデルレビューでの確定事項: フロント編成の記録（楽器コード12種+追加可・順序付き重複可）／保留曲はコール時自動解除／ジャンル上書きはフィルタでなく強い加点
- アライメントゲートでの確定事項: バックアップは週次20世代+ピン留め永続／マスタ未登録曲のクイック登録（needs_review）／participated=true の演奏で has_played 自動更新
- ワークフロー: intent全体は default、unit-02（推薦エンジン）のみ tdd をユニット単位で上書き
- 推薦理由は固定テンプレート。LLM/AI連携・PWA化・iReal Pro等の外部連携は本インテントの対象外（仕様§19）

# Units

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

---

---
status: pending
last_updated: ""
depends_on: [unit-01-app-foundation]
branch: ai-dlc/next-call-mvp/02-recommendation-engine
discipline: backend
pass: ""
workflow: tdd
ticket: ""
design_ref: ""
views: []
---

# unit-02-recommendation-engine

## Description
推薦の中核となる**DB非依存の純関数パイプライン**を実装する。`(曲+事前集計, 編成条件, 選曲意図, 設定, 乱数seed) → (通常候補+条件別候補+理由)` の副作用なし関数。仕様書§8/§10/§11/§12/§13/§14/§15の全ルールを、discovery.md「Recommendation Logic Analysis」の9ステージ構成で実装する。**TDDワークフロー**: ルール1つにつき失敗するテストを先に書く。

## Discipline
backend - This unit will be executed by backend-focused agents.

## Domain Entities
Song（全属性+ジャンル集合）、SelectionIntent（スライダー5+チェック2）、直前Performance（key/form/composer/genres/kurobon1/season/フロント編成のvo有無）、推薦履歴（繰り返し減点の入力）、Setting（engine.*）。エンティティはDB行ではなく **エンジン専用の入力型（EngineInput）** として定義し、DBからの詰め替えは unit-04 が担う。

## Data Sources
- なし（純関数）。`src/engine/` 配下に実装し、DB・fetch・Date.now()・Math.random() を直接使わない
- 乱数は seed 注入（xorshift等の決定的PRNG）、現在日時・現在季節は引数で受け取る
- 設定値は `EngineConfig` オブジェクトで受け取る（キーと既定値は discovery.md「Provisional Values」が唯一の情報源。ただしジャンル上書きは**ユーザー決定によりフィルタではなく強い加点 +15**: `engine.genre_override_bonus`、指定ジャンルの低頻度減点は無効化）

## Technical Specification

`src/engine/` のモジュール構成（関数シグネチャは実装時に確定してよいが、ステージ分割とテスト容易性を維持すること）:

1. `types.ts` — EngineInput / EngineConfig / EngineResult（candidates, conditionalCandidates, pendingSongs, isSparse）/ Reason 型
2. `exclude.ts` — **Stage 1 完全除外**: has_played=false／当日演奏済み／直前曲とform同一／初心者AND条件（is_standard AND no_chart_ok AND simple_form）違反／kurobon1_only時の非掲載。needs_review 等で属性が未設定の曲は該当ルールを安全側にスキップ（除外条件が評価不能なら除外しない、初心者ANDは満たさない扱い）
3. `score.ts` — **Stage 2–4**: 編成減点（horns=MULTIの歌もの −15）／スコア = BASE(50) + スライダー寄与（珍しい曲・久しぶり・安全性・雰囲気・バラード）+ チェック寄与（季節感+10・リスナー (listener_level−3)×4）− ルール減点（同キー−15/F・B♭−8、特殊ジャンル連続8種 −15/種、ブルース−10、同作曲者−5、累計コール上位10曲 −12、低頻度ジャンル −8）。**ジャンル上書き指定時は該当曲 +15 かつ当該ジャンルの低頻度減点なし**。**§12.5: 直前曲のフロント編成に vo が含まれる場合、歌もの属性の曲に減点（engine.after_vocal_vocal_penalty、既定−15。直前曲のフロント編成未入力時はスキップ）**。各寄与式・係数は discovery.md の表に厳密に従う
4. `repeat.ts` — **Stage 5 繰り返し減点**: 前回提示 −12／直近5リクエスト（30日）−6／同一condition_signature 3回以上 追加−6／前回提示ジャンル −3。Stage1–3通過曲数 < 8 で全て半減
5. `select.ts` — **Stage 6–7**: 候補集団（maxScore−10 かつ ≥30、不足時 −15 へ一度だけ拡大、candidate_count未満なら isSparse=true で少ないまま返す）→ softmax重み付き非復元抽出（τ=5、抽出ごとに同特殊ジャンルの残余weight ×0.5）
6. `reasons.ts` — **Stage 8 理由生成**: 固定テンプレート最大4件/曲（discovery.md のテンプレート表に従う。「最終演奏から{n}年ぶり」「この店では登場{a}回と少なめ」等）。各候補に最低2件付くこと
7. `conditional.ts` — **Stage 9 条件別候補**: horns/beginner が UNKNOWN のとき各2ブランチで再実行し、通常候補と重複しない最上位曲のみ「1管なら」等のラベルで追加
8. `pending.ts` — 保留曲の注釈: スコア不干渉・無条件表示。完全除外該当時の警告バッジ判定（当日演奏済み／同構成／黒本1条件外／編成に合いにくい）
9. `index.ts` — `recommend(input, config, seed)` として全ステージを合成
10. `condition-signature.ts` — 編成+黒本1+ジャンル上書き+スライダー符号から署名文字列を生成（繰り返し減点用）

## Success Criteria
- [ ] 完全除外5条件それぞれに「除外される/されない」の境界テストがあり、除外曲が候補・条件別候補に**一切**現れない
- [ ] スコアリングの各寄与（スライダー5・チェック2・減点8種・ジャンル上書き+15）に個別の単体テストがあり、寄与式が discovery.md の表と一致する。§12.5（直前曲vo→歌もの減点）は「voあり/なし/フロント編成未入力」の3ケースをテストする
- [ ] 繰り返し減点: 同一条件で連続実行すると前回提示曲のスコアが下がることをテストで検証。通過曲数<8での半減もテストする
- [ ] 抽選: 固定seedで結果が再現する。高スコア曲ほど選出頻度が高いことを統計的テスト（1000回試行）で確認。同一特殊ジャンル2曲同時選出が weight 減衰により抑制される
- [ ] 理由生成: 各候補に2件以上の理由が付き、発火していないルールの理由が出ない
- [ ] 条件別候補: horns=UNKNOWN で1管/複数管ブランチが実行され、通常候補と重複する場合は追加されないことをテスト
- [ ] 属性未整備曲（needs_review、属性NULL）を入力してもクラッシュせず安全側で処理される
- [ ] 曲500・履歴5000規模の合成データで recommend() が100ms未満（性能基準の余裕分。API全体2秒は unit-04 で検証）
- [ ] エンジン全体で vitest カバレッジ（statements）90%以上

## Risks
- **仕様の解釈違い**: §12.3 特殊ジャンル連続回避の対象は**8種で「循環」は対象外**（誤実装しやすい）。Mitigation: テスト名に仕様条番号を付け、レビュー時に仕様書と突合
- **暫定値の妥当性**: 実際に使うと重みが不自然な可能性。Mitigation: 全係数を EngineConfig 経由にし、ハードコード禁止。設定変更だけで挙動調整可能にする
- **統計的テストのflake**: 抽選の統計検証が稀に失敗するリスク。Mitigation: 固定seedで実行し、閾値に十分なマージンを取る

## Boundaries
DBアクセス・API・UI・推薦履歴の永続化は扱わない（unit-04）。EngineInput の組み立て（SQL集計）も unit-04。設定画面は unit-07。エンジンは `src/engine/` の外に依存しない。

## Notes
- ワークフローは tdd（test-writer → implementer → refactorer → reviewer）。**テストを先に書く**
- discovery.md「Recommendation Logic Analysis」と「Provisional Values」が実装の唯一の情報源。乖離が必要な場合は discovery.md を更新してから実装する
- ジャンル上書き=強い加点はユーザー決定（Alignment/ドメインレビュー確定事項）。discovery.md の Stage 3 記述（フィルタ）より優先する

---

---
status: pending
last_updated: ""
depends_on: [unit-01-app-foundation]
branch: ai-dlc/next-call-mvp/03-master-session-api
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
deployment:
  target: docker
  artifacts: []
  environments: [production]
monitoring:
  metrics: []
  dashboards: []
  alerts: []
  slos: []
operations:
  runbooks: []
  rollback: "ステートレスなAPI層。直前イメージへの切替のみでロールバック可"
  scaling: "単一ユーザー。スケーリング不要"
---

# unit-03-master-session-api

## Description
マスターデータ（曲・ジャンル・楽器・店舗・設定）とセッション記録（セッション・演奏記録・フロント編成）のAPI層を実装する。マスタ未登録曲のクイック登録、participated 演奏時の has_played 自動更新、全データエクスポートを含む。unit-05/06/07 の画面と unit-08 のインポートはこのAPIの上に構築される。

## Discipline
backend - This unit will be executed by backend-focused agents.

## Domain Entities
Song(+GenreTag多対多, needs_review), Instrument, Venue(is_home), Session(has_listeners/status), Performance(+PerformanceFrontInstrument), Setting。スキーマは unit-01 の schema.ts を使用（不足列があれば追加的マイグレーションで拡張）。

## Data Sources
- SQLite（Drizzle 経由）。全エンドポイントは認証必須（unit-01 の middleware 配下）
- リクエスト/レスポンスは zod でバリデーションし、エラーは統一形式 `{ error: { code, message, details? } }` で返す（**このユニットで定義する形式が全APIの規約になる**）

## Technical Specification

Next.js Route Handlers（`app/api/`）+ `src/server/repositories/` のデータアクセス関数として実装:

1. **曲マスター**
   - `GET /api/songs` — 一覧+検索（title部分一致）、フィルタ（needs_review / genre / season / has_played）、ソート（title / 最終更新）。ジャンルタグを含めて返す
   - `POST /api/songs` — 全属性+ジャンルタグ配列で作成
   - `PATCH /api/songs/:id` — 部分更新（ジャンルタグ差し替え含む）。needs_review の解除もここで行う
   - `DELETE /api/songs/:id` — 演奏記録が参照している場合は 409 を返し削除不可（履歴保全）
   - `POST /api/songs/quick` — **クイック登録**: title のみ受け取り needs_review=true, has_played=false, 他属性は既定値で作成。既存曲と title 完全一致なら 409 と既存曲を返す
2. **楽器・ジャンル・店舗マスター**
   - `GET/POST /api/instruments`（code, label, sort_order。初期12種に追加可能。削除は未使用時のみ）
   - `GET /api/genre-tags`（固定9種。読み取りのみ）
   - `GET/POST/PATCH /api/venues` — POST 時に `is_home` を必須で受け取る（初回登録時の一度だけの判定。UIは unit-05）
3. **設定**
   - `GET /api/settings` — engine.* を含む全設定
   - `PUT /api/settings` — key-value の一括/個別更新（zod で既知キーのみ許可、型検証）
4. **セッション**
   - `POST /api/sessions` — 開始（session_date 既定=当日, venue_id, has_listeners）。ACTIVE セッションが既にある場合は 409
   - `GET /api/sessions/active` — 進行中セッション+演奏記録一覧（フロント編成含む）
   - `GET /api/sessions` / `GET /api/sessions/:id` — 履歴一覧・詳細
   - `PATCH /api/sessions/:id` — has_listeners 切替、note、`status: ENDED`（終了）
5. **演奏記録**
   - `POST /api/sessions/:id/performances` — song_id **または** quick_title（内部で quick 登録を呼ぶ）を受け取り、order_index 自動採番で追加。participated, instrument(SAX/PIANO/NONE), called_by_me, no_chart, note, front_instruments（[{code, position}] 順序付き重複可）
   - **participated=true で登録された曲は songs.has_played を true に自動更新**（アライメントゲート確定事項）
   - `PATCH /api/performances/:id` / `DELETE /api/performances/:id` — 修正・削除（order_index 再採番）
6. **エクスポート**
   - `GET /api/export` — 全テーブルのデータを単一 JSON としてダウンロード（Content-Disposition: attachment）。バックアップとは独立したユーザー主導の復旧手段

## Success Criteria
- [ ] 上記全エンドポイントが実装され、正常系+主要異常系（バリデーションエラー400、重複409、参照中削除409、未認証リダイレクト）の統合テストがある
- [ ] クイック登録: title のみで needs_review=true の Song が作成され、同名既存曲では 409 が返る
- [ ] participated=true の演奏記録を追加すると対象曲の has_played が false→true に更新される（テストで検証）
- [ ] フロント編成が順序・重複を保持して保存・取得できる（vo, as, as, ts のケースをテスト）
- [ ] ACTIVE セッションの二重開始が 409 で防がれる
- [ ] GET /api/export が全テーブルを含む JSON を返し、曲数・演奏記録数が DB と一致する（operable: 復旧手段）
- [ ] 全エンドポイントのエラーが統一形式 { error: { code, message } } で返る（observable: 障害調査の基点。サーバー側は console.error でスタックを出力）
- [ ] 新規の環境変数・インフラ変更なしで unit-01 のコンテナ構成のまま動作する（deployable）

## Risks
- **エンドポイント肥大**: CRUD が多く漏れが出やすい。Mitigation: 本仕様の一覧を網羅チェックリストとしてテストを書く
- **order_index の整合**: 削除・並び替えで欠番/重複が起きうる。Mitigation: 追加時は max+1、削除時は詰め直し。トランザクション内で実施
- **has_played 自動更新の巻き戻し**: 演奏記録を削除しても has_played は自動で false に戻さない（履歴と能力は別物）。仕様として明記しテストする

## Boundaries
推薦・保留曲・推薦履歴のAPIは unit-04。CSVインポートは unit-08（ただし本ユニットのリポジトリ関数を再利用してよい）。画面は unit-05/06/07。エンジンの集計クエリ（登場回数・久しぶり度等）は unit-04。

## Notes
- エラー形式・zodスキーマの置き場所（src/server/validation/）は後続ユニットが従う規約になるため、README コメントで明示する
- 店舗の is_home 判定は「未登録店舗の初回登録時に一度だけ」（仕様§4.2）。既存店舗選択時は聞かない

---

---
status: pending
last_updated: ""
depends_on: [unit-01-app-foundation, unit-02-recommendation-engine, unit-03-master-session-api]
branch: ai-dlc/next-call-mvp/04-recommendation-api
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
deployment:
  target: docker
  artifacts: []
  environments: [production]
monitoring:
  metrics: []
  dashboards: []
  alerts: []
  slos: []
operations:
  runbooks: []
  rollback: "ステートレスなAPI層。直前イメージへの切替のみでロールバック可"
  scaling: "単一ユーザー。スケーリング不要"
---

# unit-04-recommendation-api

## Description
unit-02 の純関数エンジンをDBデータで駆動する推薦APIを実装する。EngineInput の組み立て（SQL集計）、推薦履歴の永続化（繰り返し減点の根拠）、選曲意図の前回値引き継ぎ、保留曲のCRUDとコール時自動解除を担う。

## Discipline
backend - This unit will be executed by backend-focused agents.

## Domain Entities
RecommendationRequest / RecommendationCandidate（履歴）、SelectionIntent（前回値は Setting キー `intent.last_values` に保存）、PendingSong、Song・Session・Performance（集計の入力）。

## Data Sources
- SQLite（Drizzle + 生SQL集計）。エンジン（src/engine/）は unit-02 の公開APIのみ使用
- 集計クエリ: 店舗区分別登場回数（設定期間内）、自分の最終演奏日・演奏回数・累計コール回数、累計コール上位10曲、ジャンル別コール比率（低頻度判定）、推薦履歴（前回/直近5回/同一署名回数/前回提示ジャンル）、当日演奏済み集合、直前Performance（フロント編成のvo有無含む）

## Technical Specification

1. **`POST /api/sessions/:id/recommendations`** — 推薦の実行
   - 入力（zod）: 編成条件 `{ horns: ONE|MULTI|UNKNOWN, beginner: NONE|PRESENT|UNKNOWN }`、制約 `{ kurobon1_only: boolean, genre_override?: string[] }`、意図 `{ rare, fresh, safety, mood, ballad: -2..2, seasonal: boolean, listener: boolean }`
   - 処理: (a) 集計クエリ群で EngineInput を組み立て（現在季節はセッション日付+設定の区切り月から算出）→ (b) `recommend(input, config, seed)` 実行（seed は保存して再現可能に）→ (c) RecommendationRequest + Candidates を保存（condition_signature 含む）→ (d) 意図値を `intent.last_values` に保存 → (e) 結果を返す
   - レスポンス: 通常候補（song, score, reasons[], is_pending バッジ）、条件別候補（condition_label 付き）、保留曲一覧（警告バッジ付き）、isSparse（候補が少ない）
   - **性能**: 曲500・演奏記録5,000件で p95 < 2秒（成功基準）。集計はインデックスと単一クエリ化で担保
2. **`GET /api/sessions/:id/recommendations/defaults`** — 選曲支援画面の初期値: 前回意図値（`intent.last_values`、無ければ全て中央/OFF）+ `suggest_seasonal_on: boolean`（1曲目のとき true。仕様§9.7。APIはフラグを返すだけで、初期値への適用は unit-06 のUIが行う）+ 編成条件既定（UNKNOWN）
3. **保留曲API**
   - `GET /api/pending-songs` — 一覧（曲情報込み。セッションをまたいで保持）
   - `POST /api/pending-songs` — 追加（song_id。重複は冪等に成功）
   - `DELETE /api/pending-songs/:songId` — 手動解除
   - **コール時自動解除**: unit-03 の演奏記録作成処理にフックし、`called_by_me=true` で登録された song_id が保留中なら自動削除する（実装は本ユニット。unit-03 のリポジトリ関数にイベントポイントを追加してよい）
4. **繰り返し減点の入力整備**: RecommendationRequest から「前回リクエスト提示曲」「直近5リクエスト（30日、セッション横断）」「同一 condition_signature の提示回数」「前回提示ジャンル」を引く読み取り関数
5. **インデックス**: performances(song_id), performances(session_id, order_index), recommendation_candidates(request_id), recommendation_requests(created_at, condition_signature) 等、集計に必要なインデックスを追加マイグレーションで定義

## Success Criteria
- [ ] POST recommendations が EngineInput を正しく組み立てる: 集計値（登場回数・最終演奏日・コール回数・上位10曲・ジャンル比率・当日演奏済み・直前曲）それぞれに既知データからの期待値テストがある
- [ ] 推薦実行のたびに RecommendationRequest/Candidates が保存され、直後の再実行で繰り返し減点が効く（統合テスト）
- [ ] 意図値が保存され、defaults エンドポイントが前回値を返す。初回は中央値+seasonal推奨を返す
- [ ] 保留曲: 追加→一覧（別セッションでも取得可）→ called_by_me=true の演奏登録で自動解除、の統合テストがある
- [ ] 保留曲が完全除外に該当する場合も一覧から消えず、警告バッジ（当日演奏済み等）が付与される
- [ ] seed が保存され、同一 request の結果を再現できる
- [ ] シードデータ（曲500・演奏記録5,000件）での応答時間テスト: p95 < 2秒
- [ ] エラーは unit-03 の統一形式に従い、ACTIVE でないセッションへの推薦要求は 409（observable/deployable: 既存コンテナ構成のまま、新規環境変数なし）

## Risks
- **集計クエリの性能**: N+1 や全曲スキャンの重複で遅くなる。Mitigation: 集計は曲単位に JOIN/GROUP BY でまとめ、応答時間テストをCIで実行
- **エンジンとの境界崩れ**: API側にスコアロジックが漏れる。Mitigation: レビューで src/engine/ 外のスコア計算を禁止
- **繰り返し減点の履歴肥大**: 履歴テーブルの成長。単一ユーザー規模では問題ないが、読み取りは期間で絞る（30日）

## Boundaries
エンジンのロジック本体は unit-02（本ユニットは呼び出すだけ）。画面は unit-06。マスター/セッションCRUDは unit-03。設定の編集UIは unit-07。

## Notes
- condition_signature の生成は unit-02 の condition-signature.ts を使用（重複実装しない）
- 「珍しい曲」の集計期間・母店区分は設定値（engine.appearance_window_days 等、discovery.md Provisional Values のキー名に従う）を参照
- 意図フィールド名はAPI契約として rare, fresh, safety, mood, ballad を正とする（discovery.md の long_unplayed は fresh に対応）

---

---
status: pending
last_updated: ""
depends_on: [unit-03-master-session-api]
branch: ai-dlc/next-call-mvp/05-session-screen
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
wireframe: mockups/unit-05-session-screen-wireframe.html
views: ["/", "/sessions", "/sessions/[id]"]
deployment:
  target: docker
  artifacts: []
  environments: [production]
---

# unit-05-session-screen

## Description
アプリの主画面であるセッション記録画面を実装する。セッション開始（店舗選択/新規登録+母店判定）、演奏された曲の追加（クイック登録・フロント編成含む）、セットリスト表示・編集、リスナー客トグル、セッション終了、過去セッション閲覧まで。スマートフォン片手操作を最優先する。

## Discipline
frontend - This unit will be executed by do-frontend-development agents.

## Domain Entities
Session, Venue, Performance(+FrontInstrument), Song（検索・クイック登録）, Instrument。

## Data Sources
unit-03 のAPIのみ使用: /api/sessions*, /api/venues, /api/songs（検索）, /api/songs/quick, /api/instruments, /api/sessions/:id/performances。UI状態は React state + SWR/React Query 系のフェッチ（実装時に選定、依存は軽く）。

## Technical Specification

discovery.md「UI Mockup: セッション記録画面」を出発点とし、docs/design_rule.md に準拠する。

1. **ホーム `/`**:
   - ACTIVEセッションがある場合: セッション記録画面を表示
   - ない場合: 「セッションを開始」ボタン（Primary）+ 直近セッションのリスト（venue名・日付・曲数）
2. **セッション開始フロー**: ボタン → シート（Sheet）で店舗選択。既存店舗はリストから1タップ、新規は名前入力+「母店ですか？」の一度だけの選択（仕様§4.2: 以後表示しない）。リスナー客の有無トグル。開始で `POST /api/sessions`
3. **セッション記録画面（ACTIVE時の `/`）**:
   - ヘッダー: 日付・店舗名・母店バッジ・リスナー客トグル（即時 PATCH）
   - セットリスト: 演奏順のリスト（曲名、参加バッジ（SAX/PIANO/不参加）、コールバッジ、譜面なしアイコン、フロント編成表示）。タップで編集シート、スワイプまたはメニューで削除
   - **曲追加シート**（画面下部の Primary ボタン「曲を追加」）:
     - 曲名検索（インクリメンタル、title部分一致）→ 候補タップで選択
     - **ヒットなし時「『{入力}』を新規登録」ボタン → クイック登録**（needs_review。「あとでマスターを整備」のヒント表示）
     - 自分の参加: 不参加/サックス/ピアノ（セグメント選択、既定=サックス）
     - 自分がコールした（チェック）、譜面なしだった（チェック）
     - フロント編成（任意・折りたたみ）: 楽器コードのチップ（vo ss as ts bs tp fl fh harm tb cl g +追加分）をタップで順に追加。同一楽器の複数追加可。追加順が position。選択済みはチップ列で表示し、タップで削除
     - メモ（任意）
     - 保存で `POST performances` → シートを閉じずに連続追加できる「保存して次へ」も用意
   - **「次の曲を考える」ボタン**: 画面下部固定。unit-06 の選曲支援画面へ遷移（unit-06 未完成時はプレースホルダーへ）
   - セッション終了: メニューから（確認ダイアログ、Destructive ではなく通常ボタン。終了後は履歴へ）
4. **履歴 `/sessions` / `/sessions/[id]`**: 過去セッション一覧と詳細（読み取り中心。終了済みセッションの演奏記録の修正も可能）
5. **オフライン耐性（成功基準の範囲）**: 曲追加の POST 失敗時、入力内容を保持したままエラー表示+リトライボタン。二重送信防止
6. **アクセシビリティ**: design_rule §8 に従う（フォーカス可視化、タップ領域 h-10 以上、色のみに依存しない状態表示）

## Success Criteria
- [ ] セッション開始→曲追加（既存曲・クイック登録の両方）→ 編集・削除 → リスナートグル → 終了、の一連のフローがモバイルビューポート（375px）で操作できる（コンポーネント/E2E相当のテスト）
- [ ] 新規店舗登録時のみ母店判定が表示され、既存店舗選択時は表示されない
- [ ] 曲追加シートでフロント編成を vo, as, as, ts の順で登録でき、表示にも順序が反映される
- [ ] 検索ヒットなし→クイック登録→そのまま演奏記録として追加、が一連で行える
- [ ] POST 失敗時に入力値が消えず、リトライで成功する（fetch をモックしたテスト）
- [ ] 「曲を追加」タップから保存まで、必須入力は曲名のみ（他は既定値）で完了できる（＝短時間登録）
- [ ] 全画面が design_rule.md 準拠: Primary ボタンは画面内1つ、状態はバッジ+テキスト、focus-visible リング、コントラスト（deployable: 既存コンテナ構成のまま追加インフラなし）

## Risks
- **セッション中の誤操作**: 削除・終了の誤タップ。Mitigation: 削除は確認、終了は確認ダイアログ
- **検索のもたつき**: 入力毎のAPI呼び出し。Mitigation: debounce 250ms + 直近結果のキャッシュ
- **フロント編成UIの複雑化**: 任意入力なので折りたたみ既定で邪魔にしない

## Boundaries
選曲支援・推薦結果の画面は unit-06。曲マスターの属性編集画面は unit-07（needs_review 曲の属性補完も unit-07）。APIの実装は unit-03。

## Notes
- ワイヤーフレーム（mockups/）が生成されたら見た目の基準として従う
- 「次の曲を考える」導線は最重要（仕様§22-1: 記録が主機能、途中から選曲支援モードへ移る）

---

---
status: pending
last_updated: ""
depends_on: [unit-04-recommendation-api, unit-05-session-screen]
branch: ai-dlc/next-call-mvp/06-recommend-screen
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
wireframe: mockups/unit-06-recommend-screen-wireframe.html
views: ["/sessions/[id]/recommend"]
deployment:
  target: docker
  artifacts: []
  environments: [production]
---

# unit-06-recommend-screen

## Description
選曲支援画面（編成条件・選曲意図の入力）と推薦結果表示を実装する。仕様§17.2の画面構造に対応。「次の曲を考える」→ 条件調整 → 候補3曲+理由 → コール登録 or 保留、の体験を30秒以内・タップ3回以内で成立させる。

## Discipline
frontend - This unit will be executed by do-frontend-development agents.

## Domain Entities
SelectionIntent（スライダー5+チェック2、前回値引き継ぎ）、編成条件（horns/beginner）、制約（kurobon1_only/genre_override）、RecommendationCandidate（理由付き候補）、PendingSong。

## Data Sources
unit-04 のAPIのみ: POST /api/sessions/:id/recommendations、GET .../recommendations/defaults、/api/pending-songs*。コール登録は unit-03 の POST performances を再利用（called_by_me=true 既定）。

## Technical Specification

discovery.md「UI Mockup: 選曲支援画面」「UI Mockup: 推薦結果表示」を出発点とし、docs/design_rule.md に準拠。1画面（`/sessions/[id]/recommend`）で条件と結果を上下に配置し、モーダル遷移を避ける。

1. **初期表示**: GET defaults で前回意図値をロード。1曲目のときのみ季節感チェックを推奨ONで初期化（ユーザーはOFFにできる。仕様§9.7）。編成は「わからない」既定
2. **編成条件セクション**:
   - 管楽器: 1人／複数／わからない（セグメント）
   - 初心者: いない／いる／わからない（セグメント）
3. **制約セクション**:
   - 黒本1: 制限なし／黒本1曲載のみ（セグメント。次の曲を選ぶ都度変更可。仕様§11.2）
   - ジャンル上書き（任意・折りたたみ）: ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環 のチップ複数選択（バラードは独立スライダーのため対象外。仕様§10.2）。「指定すると該当ジャンルを強く優先します」の説明文
4. **今回の意図セクション**（5段階スライダー×5 + チェック×2）:
   - 珍しい曲（強い減点⇔強い加点）／久しぶりの曲／安全に行く⇔攻める／落ち着かせる⇔盛り上げる／バラード（避けたい⇔やりたい）— 各スライダーに左右のラベルを直接表示（仕様§9.1）
   - **スライダーの外観はApple(iOS)風**（ユーザー指定・ワイヤーフレームレビュー確定）: 細いレール+中央からの青系ティント+白い円形ノブ（影付き）+5段階スナップのドット。shadcn/ui Slider をベースにカスタムスタイルで実現。unit-07 の設定画面スライダーも同スタイルに統一
   - 季節感チェック（現在の季節を「春の曲を重視」の形でラベル表示）／リスナー受けチェック（セッションのリスナー客=なしのとき無効化はせず、単に既定OFF）
5. **「候補を出す」ボタン**（Primary・画面下部固定）→ POST recommendations → 結果セクションへスクロール
6. **推薦結果表示**:
   - 通常候補カード（約3曲）: 曲名（大）、キー・構成・作曲者のメタ行、推奨理由（2〜4件の箇条書き）、保留中バッジ（該当時）。アクション: 「この曲をコール」（Primary相当は候補カード外に1つなので Secondary で統一）／「保留に追加」
   - isSparse のとき: 「条件が強く、候補が{n}曲に絞られました」の注記（無理に増やさない。仕様§14.5）
   - 条件別候補: 「1管なら」「複数管なら」「初心者が参加するなら」のラベル付きカード（存在時のみ）
   - **保留曲枠**: 通常候補の下に無条件で全保留曲を表示。警告バッジ（当日演奏済み／直前と同構成／黒本1条件外／編成に合いにくい）。アクション: 「コール」／「保留解除」
   - 「条件を変えて再抽選」ボタン（意図セクションへ戻る）
7. **コール登録フロー**: 候補の「この曲をコール」→ unit-05 の曲追加シートを called_by_me=true・曲確定済みの状態で開く（参加楽器等を確認して保存）→ 保存後セッション記録画面へ戻る。保留中の曲なら自動解除される（unit-04）
8. **タップ数の担保**: セッション記録画面「次の曲を考える」(1) → 「候補を出す」(2) → 候補確認、で最短2タップ。条件調整は任意

## Success Criteria
- [ ] defaults ロード→スライダー・チェック・編成・制約の変更→「候補を出す」→ 候補+理由表示、の一連が375pxで動作する（APIモックのテスト）
- [ ] 前回意図値が引き継がれて表示され、変更した項目だけが変わる（仕様§9冒頭）
- [ ] 1曲目のとき季節感が推奨ONで表示され、OFFに変更できる
- [ ] 候補カードに推奨理由が2件以上表示される。isSparse 時に注記が出る
- [ ] 条件別候補がラベル付きで区別して表示される（horns=UNKNOWN のモックデータ）
- [ ] 保留曲枠が通常候補と独立して常時表示され、警告バッジ・コール・解除が機能する
- [ ] 「この曲をコール」→ 曲追加シート（called_by_me=true・曲確定）→ 保存 → セッション画面へ戻る、が動作する
- [ ] 「次の曲を考える」から候補表示まで最短2タップ（テストシナリオで確認。成功基準のタップ3回以内を満たす）
- [ ] design_rule.md 準拠（スライダー・チップ・カード・バッジの実装は shadcn/ui ベース）（deployable: 追加インフラなし）

## Risks
- **スライダーのモバイル操作性**: 誤タッチ。Mitigation: スライダーは5段階スナップ、タッチ領域を大きく
- **結果待ちの体感**: 推薦APIが重い場合の不安。Mitigation: スケルトン表示+ボタン無効化（二重実行防止）
- **画面の縦長化**: 全セクション展開で長くなる。Mitigation: 制約・ジャンル上書きは折りたたみ既定、結果へ自動スクロール

## Boundaries
推薦ロジック・理由文の生成はエンジン（unit-02）とAPI（unit-04）。曲追加シートは unit-05 の部品を再利用（重複実装しない）。設定画面は unit-07。

## Notes
- 理由はAPIが返す文字列をそのまま表示する（フロントで加工しない）
- ジャンル上書きは「強い加点」であることをUI文言でも誤解なく（「絞り込み」とは書かない）

---

---
status: pending
last_updated: ""
depends_on: [unit-03-master-session-api, unit-08-csv-import-api]
branch: ai-dlc/next-call-mvp/07-master-settings-screen
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
wireframe: mockups/unit-07-master-settings-screen-wireframe.html
views: ["/songs", "/songs/[id]", "/settings", "/settings/import"]
deployment:
  target: docker
  artifacts: []
  environments: [production]
---

# unit-07-master-settings-screen

## Description
曲マスター管理画面（一覧・検索・属性編集・needs_review補完）、エンジン設定画面（engine.* の調整）、CSVインポートウィザード（unit-08 の4段階フローのUI）、エクスポートダウンロードを実装する。セッション外（自宅等）でのメンテナンス用画面群。

## Discipline
frontend - This unit will be executed by do-frontend-development agents.

## Domain Entities
Song(+GenreTag), Instrument, Venue, Setting, ImportJob。

## Data Sources
unit-03 のAPI（songs/genre-tags/instruments/venues/settings/export）と unit-08 のAPI（import 4段階）。

## Technical Specification

discovery.md「UI Mockup: 曲マスター / インポート / 設定（概要）」を出発点とし、docs/design_rule.md に準拠。

1. **曲マスター一覧 `/songs`**:
   - 検索（title部分一致、debounce）+ フィルタチップ: 属性未整備（needs_review）／コール可能（has_played）／黒本1／季節／ジャンル
   - リスト行: 曲名、キー・構成バッジ、ジャンルタグ、needs_review 警告バッジ
   - **「属性未整備 n曲」のショートカット**を画面上部に表示（クイック登録された曲の補完導線。仕様の運用上重要）
   - 「新規追加」ボタン → 編集画面へ
2. **曲編集 `/songs/[id]`（新規は `/songs/new`）**:
   - 全属性のフォーム: 曲名、黒本キー、構成（AABA/ABAC/12小節ブルース/その他）、作曲者、演奏経験あり、譜面なし対応可、超定番、構成が単純、黒本1曲載、季節（春/夏/秋/冬/通年）、リスナー受け度（1–5）、盛り上がり度（1–5）、ジャンルタグ（9種チップ複数選択）、メモ
   - 保存で needs_review を自動解除するか確認（「属性の入力が完了しましたか？」チェック）
   - 削除（演奏記録が参照中の場合はAPIの409を受けて「履歴があるため削除できません」表示）
3. **設定 `/settings`**:
   - エンジン設定: discovery.md「Provisional Values」の設定キーをグループ表示（除外・減点／意図の重み／繰り返し減点／抽選／候補数）。各項目は数値入力またはスライダー（unit-06 と同じ Apple(iOS)風スタイル）+説明文+既定値に戻すボタン
   - 楽器マスター管理: 一覧+追加（コード・表示名）
   - 母店設定: 店舗一覧と is_home の修正（初回判定の訂正手段）
   - データ管理: 「全データをエクスポート」（GET /api/export をダウンロード）
   - 設定変更は PUT /api/settings で即時保存し、トースト表示
4. **インポートウィザード `/settings/import`**（unit-08 の4段階フローのUI）:
   - Step1 アップロード: type選択（曲マスター/セットリスト履歴）+ CSVファイル選択
   - Step2 プレビュー: 総行数/有効行数、エラー行テーブル（行番号・理由・元データ）。setlists の場合: 未知店舗の母店区分確定UI（店舗ごとに 母店/母店以外 を選択）、曲名不一致の解決UI（近似候補から選択／新規スタブ作成／スキップ、を行ごとに選択。一括「すべてスタブ作成」も用意）
   - Step3 ドライラン: 差分サマリ（新規曲n・更新n・新規店舗n・新規セッションn・演奏記録n・スキップn）
   - Step4 コミット: recalc_has_played チェック付き実行 → 結果サマリ表示。破棄ボタンで DISCARDED
   - ウィザードは中断しても job_id で再開可能（PREVIEW中のジョブ一覧を表示）
5. **アクセシビリティ・レスポンシブ**: モバイル最優先だが、マスター整備・インポートはPC利用も想定し、テーブルは overflow-x-auto で崩さない（design_rule §6.5/§8）

## Success Criteria
- [ ] 曲マスター一覧の検索・各フィルタ・needs_review ショートカットが機能する（APIモックテスト）
- [ ] 曲編集で全属性（ジャンル複数選択含む）が保存でき、needs_review が解除できる
- [ ] 参照中の曲の削除で 409 エラーメッセージが表示される
- [ ] 設定画面で engine.* の値を変更・保存でき、「既定値に戻す」が機能する
- [ ] インポートウィザード4段階が一連で動作する: エラー行表示 → 店舗区分確定 → 曲名解決（match/stub/skip） → ドライラン差分 → コミット結果（APIモックで全分岐をテスト）
- [ ] エクスポートがファイルダウンロードとして機能する
- [ ] 375px（モバイル）と 1024px（PC）の両方でレイアウトが崩れない
- [ ] design_rule.md 準拠（テーブル・フォーム・バッジ・トーストの実装規約）（deployable: 追加インフラなし）

## Risks
- **設定項目の過多で迷子**: engine.* は20項目超。Mitigation: グループ化+説明文+既定値表示。「詳細設定」折りたたみ
- **インポートUIの複雑さ**: 曲名解決が数百件になる可能性。Mitigation: 未解決のみ表示・一括操作・件数バッジ
- **設定の誤入力でエンジン破綻**: 範囲外値。Mitigation: zodバリデーション（API側）+ 入力UIの min/max

## Boundaries
インポートのパース・解決・コミット処理は unit-08（本ユニットはUIのみ）。エクスポートAPI・マスターCRUD APIは unit-03。セッション中の画面は unit-05/06。Excel抽出スクリプトはCLI（unit-08）でありUI不要。

## Notes
- 設定キーの表示名・説明文・グループは discovery.md「Provisional Values」の表の日本語説明を流用する
- needs_review 補完の体験を軽くする（一覧から編集へ1タップ、保存後に次の未整備曲へ進むオプション）

---

---
status: pending
last_updated: ""
depends_on: [unit-01-app-foundation, unit-03-master-session-api]
branch: ai-dlc/next-call-mvp/08-csv-import-api
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
deployment:
  target: docker
  artifacts: []
  environments: [production]
monitoring:
  metrics: []
  dashboards: []
  alerts: []
  slos: []
operations:
  runbooks: []
  rollback: "取込は単一トランザクション。失敗時は自動ロールバック、成功後の取り消しはバックアップ/エクスポートから復旧"
  scaling: "単一ユーザー。スケーリング不要"
---

# unit-08-csv-import-api

## Description
曲マスター（songs.csv）と約5年分のセットリスト履歴（setlists.csv）の一括インポートAPI、および**初回限定のExcel抽出スクリプト**（やれる曲.xlsx → CSV）を実装する。discovery.md「Data Import Plan」のCSV仕様・「Excel Source Analysis」のマッピング表・4段階フロー（アップロード→プレビュー→ドライラン→コミット）に従う。インポートウィザードのUIは unit-07。

## Discipline
backend - This unit will be executed by backend-focused agents.

## Domain Entities
Song(+GenreTag), Venue(is_home), Session, Performance。ImportJob（アップロード〜コミットの中間状態を保持する作業テーブル: id, type(songs|setlists), status(PREVIEW/COMMITTED/DISCARDED), parsed_rows JSON, errors JSON, resolutions JSON, created_at）。

## Data Sources
- CSV仕様は discovery.md「Data Import Plan」を唯一の情報源とする:
  - songs.csv: title,key,form,composer,has_played,no_chart_ok,is_standard,simple_form,in_kurobon1,season,listener_level,energy_level,genres,note（genres は `|` 区切り・固定9語彙、season は 春/夏/秋/冬/通年、boolean は 1/0、title で upsert）
  - setlists.csv: date,venue_name,order,title,participated,instrument,called_by_me,no_chart,memo（date+venue_name でセッション自動生成・集約）
- 文字コード: UTF-8（BOM許容）。iPhoneメモ由来を考慮し、title 正規化（全半角・大小・前後空白・NFKC）を共通関数化

## Technical Specification

1. **`POST /api/import/:type`（type=songs|setlists）** — CSVアップロード（multipart）。行単位で zod バリデーションし、ImportJob(PREVIEW) を作成。レスポンス: job_id, 総行数, 有効行数, エラー行（行番号+理由+元データ）, 未知の要素:
   - songs: 未知ジャンル語彙・不正enum等のエラー行一覧
   - setlists: **未知の venue_name 一覧**（is_home の確定が必要）、**マスターに一致しない title 一覧**（正規化後の近似候補を最大3件付与: 完全一致→正規化一致→部分一致の順）
2. **`POST /api/import/:jobId/resolutions`** — プレビューでの解決内容を保存:
   - venue区分: { venue_name: is_home } のマップ
   - 曲名解決: { csv_title: { action: match|create_stub|skip, song_id? } }（create_stub は needs_review=true の曲スタブ作成予約）
3. **`GET /api/import/:jobId/dry-run`** — 解決内容を適用した差分サマリ: 新規曲n件／更新曲n件（songs は title upsert）／新規店舗n件／新規セッションn件／新規演奏記録n件／スキップn件。**DBには書き込まない**
4. **`POST /api/import/:jobId/commit`** — 単一トランザクションで取込。setlists では:
   - date+venue_name の組ごとに Session を作成（既存の同date+venueセッションがあれば追記せずエラー: 二重取込防止）
   - order 順に Performance を作成（instrument: sax→SAX, piano→PIANO, 空→NONE。participated=0 なら NONE）
   - コミット後オプション `recalc_has_played=true`: participated=1 の履歴がある曲の has_played を ON
   - 完了レスポンス: 取込件数サマリ。ImportJob を COMMITTED に更新
5. **`DELETE /api/import/:jobId`** — プレビュー破棄（DISCARDED）
6. **初回Excel抽出スクリプト**（`scripts/extract-excel.ts`。CLIで実行、アプリには組み込まない）:
   - 入力: `やれる曲.xlsx` のパス（引数。**ファイルはリポジトリにコミットしない**）
   - `list` シート（ヘッダー3行目）→ songs.csv: マッピングは discovery.md「Excel Source Analysis」の表に厳密に従う（Ready★ OR Done★ → has_played=1、#1■ → in_kurobon1=1、Genre→9語彙マッピング、Form→AABA/ABAC/BLUES12/OTHER、曖昧値はnoteへ原文保存）
   - `logs_all` シート → setlists.csv: Date+Placeでセッション集約、PlayedPart/CallingByMe/NoScore の変換、**Logs列の括弧内からフロント編成をパース**（カンマ区切り、`as*2`→as,as、`trio`/`all`/空→編成なし、未知コードは警告リスト出力）
   - 導出: NoScore=1 の演奏実績がある曲 → songs.no_chart_ok=1
   - setlists.csv に front_instruments 列（`|`区切り、例: `vo|as|as`）を**追加**し、インポートAPI側もこの列を受け付ける
   - 出力: songs.csv / setlists.csv / 警告レポート（未知ジャンル・未知楽器コード・日付不正等）
   - テスト: 匿名化した小型 .xlsx フィクスチャで抽出結果を検証
7. **冪等性・安全性**: 同一CSVの再コミットは date+venue 重複エラーで防がれる。コミットは1ジョブ1回のみ。5,000行程度を1トランザクションで処理できること（SQLiteでは十分）

## Success Criteria
- [ ] songs.csv の正常取込: title upsert（新規/更新）、genres の複数タグ、season/boolean/レベル値の変換が正しいことをフィクスチャCSVでテスト
- [ ] setlists.csv の正常取込: date+venue_name でセッションが集約され、order 順に演奏記録が作られる（5年分相当・約5,000行のフィクスチャで検証）
- [ ] バリデーションエラー行が行番号+理由付きで返り、エラー行があっても有効行のプレビューは進められる
- [ ] 未知 venue の is_home 解決、曲名不一致の match/create_stub/skip 解決がコミットに反映される（create_stub は needs_review=true）
- [ ] dry-run が DB無変更で差分サマリを返す（dry-run 前後で全テーブル件数不変をテスト）
- [ ] コミットは単一トランザクション: 途中で失敗させた場合に部分取込が残らない
- [ ] 同一 date+venue の二重取込がエラーで防がれる
- [ ] recalc_has_played オプションで participated=1 の曲の has_played が ON になる
- [ ] 取込後、登場回数・久しぶり度の集計（unit-04 の関数）に履歴が反映される（結合テスト。unit-04完成後にCIで有効化してよい）
- [ ] 抽出スクリプト: フィクスチャxlsxから songs.csv/setlists.csv が生成され、has_played（Ready/Done）・in_kurobon1（#1）・Genreマッピング・フロント編成パース（as*2/trio/空を含む）が discovery.md の表どおりであることをテストで検証
- [ ] setlists.csv の front_instruments 列がインポートで PerformanceFrontInstrument に順序どおり保存される
- [ ] 実データ（約733曲・2,293演奏行）での抽出→取込のリハーサルがドライランまで通る（警告リストを人間が確認できる）

## Risks
- **Excel実データの表記揺れ**: 実データは確認済み（/Users/fisico/Downloads/やれる曲.xlsx、list 733曲・logs_all 2,293行）だが、Key の複合表記（Fm(Ab)等）・曲名の別名・Logs列の想定外書式が残る。Mitigation: 抽出は警告リストを出して人間が確認、曲名は NFKC 正規化+近似候補で解決。Excelファイル自体はコミットせず、実行時にパス指定
- **曲名の表記揺れ**: 同一曲が別名で二重登録される。Mitigation: NFKC正規化+近似候補提示で人間が解決する（自動マージしない）
- **大量行のメモリ**: 5,000行程度なので全行メモリ処理で問題ないが、行数上限（20,000行）を設けて明示エラー

## Boundaries
ウィザードUI（アップロード画面・プレビュー表・区分確定UI・曲名解決UI）は unit-07。エクスポートは unit-03。マスターCRUDの再利用は unit-03 のリポジトリ関数経由で行う。

## Notes
- ImportJob の parsed_rows/resolutions はJSON列で持つ（正規化テーブル不要。ジョブは使い捨て）
- 季節曲は PiaScore から CSV の season 列へ手動転記される前提（仕様§9.7）

---

---
status: pending
last_updated: ""
depends_on: [unit-01-app-foundation]
branch: ai-dlc/next-call-mvp/09-infra-deploy
discipline: infrastructure
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
deployment:
  target: docker
  artifacts: [Dockerfile, docker-compose, caddyfile, github-actions]
  environments: [production]
monitoring:
  metrics: []
  dashboards: []
  alerts: []
  slos: []
operations:
  runbooks: [docs/ops.md]
  rollback: "GHCRの直前タグ（:sha）を compose で指定して up -d。DBは追加的マイグレーションのため巻き戻し不要"
  scaling: "単一ユーザー・単一コンテナ。スケーリング対象外"
---

# unit-09-infra-deploy

## Description
next-call をVPSで運用するためのインフラ一式を実装する: multi-stage Dockerfile、docker compose（app + Caddy）、GitHub Actions CI/CD（品質→イメージ→デプロイ）、**週次バックアップ20世代+ピン留めスナップショット（明示削除まで永続）**、運用ドキュメント。discovery.md「Deployment Architecture」を基本設計とし、バックアップ方針のみアライメントゲート決定で上書きする。

## Discipline
infrastructure - This unit will be executed by general-purpose agents with IaC/provisioning context.

## Domain Entities
なし（アプリのドメインには触れない）。対象はビルド成果物・コンテナ・SQLiteファイル（/data/next-call.db）・バックアップファイル。

## Data Sources
- リポジトリ: Dockerfile, docker-compose.yml, Caddyfile, .github/workflows/deploy.yml, scripts/backup.sh, docs/ops.md
- VPS側: /srv/next-call/{data,backup,pinned}/ ディレクトリ、.env（DATABASE_PATH, AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, ALLOWED_EMAILS, AUTH_URL）
- GitHub Secrets: VPS_SSH_KEY / VPS_HOST / VPS_USER（GHCRはGITHUB_TOKEN）

## Technical Specification

1. **Dockerfile**（multi-stage）: build stage は node:22-bookworm-slim + python3/make/g++（better-sqlite3 のネイティブビルド）、実行 stage は slim + Next.js standalone 出力のみ。entrypoint で 生成済みマイグレーションSQLの適用 → node server.js。HEALTHCHECK は /api/health
2. **docker-compose.yml**: app（:3000、volume /srv/next-call/data:/data）+ Caddy（:80/:443、Caddyfile で {domain} → app:3000 のリバースプロキシ+TLS自動）。restart: unless-stopped
3. **GitHub Actions**（.github/workflows/deploy.yml）:
   - job quality: npm ci → lint → typecheck → test → build（品質ゲートと同一コマンド）
   - job image (needs quality): docker build → push ghcr.io/{owner}/next-call:latest と :\${{ github.sha }}
   - job deploy (needs image): SSH で VPS へ → docker compose pull && up -d → https://{domain}/api/health を最大60秒リトライで確認、失敗時はジョブ失敗
   - main への push のみで発火。PR では quality のみ実行する ci.yml を分離
4. **バックアップ（アライメントゲート確定仕様）**:
   - `scripts/backup.sh`: `sqlite3 /data/next-call.db ".backup"` → gzip → /srv/next-call/backup/next-call-YYYY-MM-DD.db.gz
   - **週次実行**（VPS の cron、例: 日曜 04:00）。**20世代を超えた最古の週次バックアップのみ削除**
   - **ピン留めスナップショット**: `scripts/backup.sh --pin [label]` で /srv/next-call/pinned/next-call-YYYY-MM-DD[-label].db.gz に保存。**ローテーション対象外＝明示的に rm するまで永続保持**
   - リストア手順: `scripts/restore.sh <backup-file>`（app停止→展開→整合性チェック(PRAGMA integrity_check)→配置→app起動）
   - バックアップ検証: backup.sh は作成後に gunzip -t と integrity_check を実行し、失敗時は非ゼロ終了+ログ
5. **運用ドキュメント**（docs/ops.md）: 初回セットアップ手順（VPS要件、.env、compose 起動、Google OAuth リダイレクトURI設定、cron登録）、デプロイ・ロールバック手順（:sha タグ指定）、バックアップ/ピン留め/リストア手順、ログ確認（docker compose logs）
6. **VPS固有値の扱い**: デプロイ先は **Xserver VPS**（ユーザー確定。KVM・root権限・Docker利用可）。OSは Ubuntu LTS を推奨。docs/ops.md に Xserver VPS 固有の手順を含める: 管理パネルの**パケットフィルターで 22/80/443 を開放**、OSイメージ選択、SSH鍵登録。ドメイン名・ホストIPは実装時にユーザーへ確認して設定する。Secrets 未設定時は deploy ジョブをスキップし quality/image のみ通す（フォークやSecrets未設定でもCIが赤くならない）

## Success Criteria
- [ ] `docker build` がローカル/CIで成功し、コンテナ起動で自動マイグレーション+ /api/health が 200 を返す（deployable）
- [ ] docker compose up -d で app+Caddy が起動する（Caddyfile はドメインをenv/プレースホルダで受け取る）
- [ ] GitHub Actions: PR で quality が走り、main への push で quality→image→deploy が連鎖する。deploy 後のヘルスチェック失敗でワークフローが失敗する（observable）
- [ ] backup.sh: 実行で世代ファイルが作られ、21世代目で最古の週次のみ削除される（テスト: 一時ディレクトリで21回実行）。--pin のファイルはローテーションで削除されない（operable）
- [ ] restore.sh でバックアップから復元でき、integrity_check が ok を返す
- [ ] Secrets 未設定の環境で deploy ジョブが安全にスキップされる
- [ ] docs/ops.md に初回セットアップ〜リストアまでの手順が揃っている（人間がそのまま実行できる粒度）

## Risks
- **VPS環境の詳細**: デプロイ先は Xserver VPS で確定（Docker/compose/Caddy/cron すべて利用可、非互換なし）。残る未確定はドメイン名・ホストIP・OSバージョン選択のみ。Mitigation: 実装時に確認。パケットフィルター（80/443/SSH開放）の設定漏れを ops.md のチェックリストに含める
- **SQLiteバックアップの整合性**: 稼働中コピーの破損。Mitigation: cp でなく sqlite3 .backup API + 検証を必須化
- **cron の失権**: バックアップが止まっても気づかない。Mitigation: backup.sh がログを残し、docs/ops.md に「月1でバックアップ日付を確認」を運用チェックとして明記（MVPでは通知連携なし）

## Boundaries
アプリコード・スキーマ・ヘルスエンドポイントの実装は unit-01。エクスポート機能（アプリ内）は unit-03。監視ダッシュボード・アラート通知は本インテントの対象外（単一ユーザーMVP。ヘルスチェック+バックアップ検証+ログで代替）。

## Notes
- バックアップ方針は「週次・20世代+ピン留め永続」（アライメントゲートでユーザーが日次14世代から変更）
- デプロイの CI/CD 監視はグローバル運用ルール（gh run watch）と整合するよう、ワークフロー名を分かりやすく（deploy）する

---

# Discovery Context

---
intent: next-call-mvp
created: 2026-07-12
status: active
---

# Discovery Log: ジャズセッション向け選曲提案アプリ (next-call) MVP

Elaboration findings persisted during Phase 2.5 domain discovery.
Builders: read section headers for an overview, then dive into specific sections as needed.

一次仕様書: `docs/jazz_session_song_recommendation_spec_v2.md`（全852行を精読済み。以下「仕様§n」で参照）
デザインルール: `docs/design_rule.md`（Tailwind + shadcn/ui。全画面でこれに準拠）

## Domain Model

### Entities

#### Song（曲マスター）— 仕様§7
推薦の中心となるマスター。1曲に複数のジャンル・特徴を付与できる（多対多）。

| 属性 | 型（案） | 出典 | 備考 |
|---|---|---|---|
| id | integer PK | - | |
| title | text UNIQUE | §7.1 曲名 | 正規化した照合用 title_normalized も持つ（インポート時の曲名マッチ用） |
| song_key | text | §7.1 黒本キー | 例: C, F, Bb, Eb, G, Fm… 黒本記載キー |
| form | enum: AABA / ABAC / BLUES12 / OTHER | §7.1 構成 | 「直前と同構成は完全除外」に使用 |
| composer | text | §7.1 作曲者 | |
| has_played | boolean | §7.1 演奏経験あり | アプリ内での「コール可能」判定の唯一の材料（後述 Key Finding） |
| no_chart_ok | boolean | §6.1/§7.1 譜面なし対応可 | 演奏実績がある曲に付くフラグ。初心者対応AND条件・安全性判定に使用 |
| is_standard | boolean | §7.1 超定番 | 初心者対応AND条件・安全性判定に使用 |
| simple_form | boolean | §7.1 構成が単純 | 同上 |
| in_kurobon1 | boolean | §7.1 黒本1掲載 | 譜面共有環境の制約（§11）。安全性ではない |
| season | enum: SPRING / SUMMER / AUTUMN / WINTER / ALL | §7.1 季節 | PiaScore季節セットリスト由来（§9.7） |
| listener_level | integer 1–5 | §7.1 リスナー向け度 | 付与方法は§21未確定 → Provisional Values 参照（手動付与・デフォルト3） |
| energy_level | integer 1–5 | §7.1 盛り上がり度 | 同上 |
| note | text | §7.1 その他 | 任意メモ |

#### GenreTag（ジャンル・特徴）— 仕様§7.2
固定9種: `バラード / ボサノバ / 3拍子 / モード / ファンク / ブルース / 歌もの / 循環 / キメが多い曲`。
実装はマスターテーブル（将来の追加に備える）+ 中間テーブル `song_genres(song_id, genre_id)`。
「特殊ジャンル連続回避」（§12.3）の対象は上記のうち `キメが多い曲` を含む8種（循環は対象外である点に注意 — §12.3の列挙は バラード/ボサノバ/モード/3拍子/ファンク/キメが多い曲/ブルース/歌もの）。

#### Venue（店舗マスター）— 仕様§4.2
| 属性 | 型（案) | 備考 |
|---|---|---|
| id | integer PK | |
| name | text UNIQUE | 店舗・イベント名 |
| is_home | boolean | 某店=true / 某店以外=false。**初回登録時に一度だけ判定して保存**。以後は自動参照（毎回選ばせない） |
| created_at | datetime | |

店舗区分は「セットリスト登場頻度」（§13）の参照先切替にのみ使う内部区分。

#### Session（セッション）— 仕様§4
| 属性 | 型（案） | 備考 |
|---|---|---|
| id | integer PK | |
| session_date | date | |
| venue_id | FK → Venue | |
| has_listeners | boolean | セッション中いつでも変更可（§4.3）。ヴォーカル客フラグは設けない |
| status | enum: ACTIVE / ENDED | 記録主画面 ⇔ 履歴の切替 |
| note | text | iPhoneメモで管理していたその他情報の受け皿 |

#### Performance（演奏記録 / セットリスト行）— 仕様§5
自分が参加していない曲も含めて全曲登録する（§5）。

| 属性 | 型（案） | 備考 |
|---|---|---|
| id | integer PK | |
| session_id | FK → Session | |
| song_id | FK → Song | |
| order_index | integer | 演奏順。**「直前の曲」= ACTIVEセッション内 order_index 最大の行** |
| participated | boolean | 自分の参加有無 |
| instrument | enum: SAX / PIANO / NONE | §5.1。候補抽出は常にサックス前提、ピアノは履歴のみ（§5.2） |
| called_by_me | boolean | 累計コール回数集計（§12.7）・コール傾向（§10.4）に使用 |
| no_chart | boolean | 「譜面なしだったか」（事実の記録）。曲マスターの no_chart_ok（能力フラグ）とは別物 |
| note | text | |

#### SelectionIntent（選曲意図）— 仕様§9
参加曲の都度変更、**前回値を引き継ぐ**（§9冒頭）。推薦リクエストのスナップショットとして保存しつつ、「最後に使った値」を carry-over 用に保持する。

| 属性 | 型（案） | UI | 備考 |
|---|---|---|---|
| rare | integer −2..+2 | 5段階スライダー | 珍しい曲（§9.2）店舗区分別登場回数を参照 |
| long_unplayed | integer −2..+2 | 5段階スライダー | 久しぶりの曲（§9.3）基準: 最終演奏から1年以上 |
| safety | integer −2..+2 | スライダー（左=安全に行く / 右=攻める） | §9.4 |
| mood | integer −2..+2 | スライダー（左=落ち着かせる / 右=盛り上げる） | §9.5。盛り上げ=ファンク自動優先ではない |
| ballad | integer −2..+2 | スライダー（左=避けたい / 右=やりたい） | §9.6 独立スライダー |
| seasonal | boolean | チェックボックス | §9.7。1曲目はデフォルトON（変更可）。対象季節は日付から自動判定 |
| listener_focus | boolean | チェックボックス | §9.8 |

#### RecommendationRequest / RecommendationCandidate（推薦履歴）— 仕様§14.3
繰り返し減点（同じ曲・同じジャンルの連続提示防止）のために全リクエストと提示候補を永続化する。

- RecommendationRequest: `id, session_id, requested_at, horns(ONE/MULTI/UNKNOWN), beginner(NONE/PRESENT/UNKNOWN), kurobon1_only(bool), genre_override(json)`, intent各値のスナップショット, `condition_signature(text)`（「同じような条件」判定用ハッシュ）, `pool_size(integer)`（緩和判定の記録）
- RecommendationCandidate: `request_id, song_id, candidate_type(NORMAL/ONE_HORN/MULTI_HORN/BEGINNER), score, reasons(json), display_order`

#### PendingSong（保留曲）— 仕様§16
曲だけを保存。理由・期限・スコアは持たない。セッションをまたいで保持。

| 属性 | 型（案） | 備考 |
|---|---|---|
| song_id | FK → Song（UNIQUE） | |
| created_at | datetime | 保留登録日時 |

解除 = 行削除（または is_active=false で履歴保持。MVPは行削除で十分）。コール時自動解除は未確定（§21）→ Provisional Values 参照。

#### Setting（設定）
key-value ストア。§21の全暫定値（スコア重み・減点強度・集計期間・季節の区切り月・候補集団の作り方・乱数温度・候補数など）をここに置き、設定画面から調整可能にする（Clarification回答どおり）。`key text PK, value json, updated_at`。

#### User（認証）
単一ユーザー・Googleログイン。**DBにユーザーテーブルは作らない**方針（Auth.js JWT戦略 + メールアドレス許可リスト環境変数）。サインアップ画面なし。

### Relationships

- Venue 1 — N Session
- Session 1 — N Performance（order_index で順序付け）
- Song 1 — N Performance
- Song N — M GenreTag（song_genres）
- Session 1 — N RecommendationRequest 1 — N RecommendationCandidate（N — 1 Song）
- Song 1 — 0..1 PendingSong

### Lifecycle

1. **セッション**: 開始（日付・店舗入力。未登録店舗なら某店/某店以外を初回のみ判定）→ ACTIVE（曲を順次登録、リスナー客トグルはいつでも変更）→ 「次の曲を考える」で選曲支援モードへ何度でも往復 → 終了（ENDED）→ 以後は演奏履歴として集計対象。
2. **推薦**: 編成条件+意図（前回値引き継ぎ）入力 → パイプライン実行 → 候補提示（+保留曲を無条件で別枠表示）→ コール登録（Performance生成、called_by_me=true）or 保留登録 or 再抽選。
3. **保留曲**: 登録 → セッションまたぎで保持 → 手動解除（コール時の自動解除は暫定OFF+確認ダイアログ）。

### Data Sources

- **SQLite（クラウドDB・VPS上、アプリ唯一の永続層）**:
  - Available: 上記全エンティティ。集計はすべてSQLで賄える規模（曲マスター数百曲、セッション数百件、演奏記録は5年×週次でも数千〜1万行程度）。30秒以内の候補提示（§20）は余裕。
  - Missing: 初期データ（下記）。
- **iPhoneメモ（セットリスト履歴 約5年分 + 曲マスター元データ）**:
  - Available: 利用者が手動管理してきたテキスト。
  - Missing: **実データのフォーマットは未入手**（Open Questions）。CSV化はユーザー作業 or 変換支援が必要。
- **PiaScore（季節曲: 春夏秋冬のセットリスト）**:
  - Available: 曲名の一覧（アプリ内で目視可能）。
  - Missing: エクスポートAPIなし。手動転記→曲マスターCSVの season 列に反映する想定（§21未確定 → Provisional）。

### Data Gaps

1. **ヴォーカル参加フラグが存在しない**: §12.5「ヴォーカル参加曲の後は歌ものを避ける」の判定材料が演奏記録にない。→ 暫定: 直前曲の「歌もの」属性で代替（§12.3の連続回避と同一化）。演奏記録への「ヴォーカル参加」フラグ追加は Open Question。
2. **仕込み済み曲はアプリ管理外**（§6/§19）: よってアプリ内の「コール可能曲」= `has_played=true` のみ。仕込み曲を候補に出したい場合はユーザーが has_played を手動でONにする運用（マスター編集画面で可能にする）。
3. **has_played と演奏履歴の二重管理**: has_played はマスターの明示フラグとして持ち、履歴から自動導出しない（インポート前の曲や記録漏れに対応）。ただしインポート時に「participated=true の履歴がある曲は has_played を ON にする」再計算オプションを提供。
4. **listener_level / energy_level の初期値**: 全曲手動付与は負担。→ デフォルト3で開始し、マスター一覧のインライン編集+CSV列で段階的に整備（Provisional）。
5. **某店の判定ルール**: 某店の実店舗名・表記揺れが未入手。→ 設定 `home_venue_names`（正規化名リスト）と照合、未登録店舗は初回登録UIで利用者が1回だけ確定（Open Question）。

## Recommendation Logic Analysis

仕様§8/§10/§11/§12/§13/§14 を、実装可能な**9ステージの純関数パイプライン**に整理した。エンジンは `(曲リスト+集計値, 編成条件, 意図, 設定) → 候補+理由` の副作用なし関数とし、単体テストを厚くする。

### 入力（エンジンに渡す事前集計）

- 全曲 + ジャンル集合
- 当日セッションの演奏済み song_id 集合、直前曲（key / form / composer / genres / in_kurobon1 / season / listener_level / energy_level）
- 曲ごと: 店舗区分別登場回数（設定期間内）、自分の最終演奏日、自分の演奏回数、自分の累計コール回数
- 全体: 自分のコール回数上位10曲、ジャンル別自分のコール比率（低頻度ジャンル判定）
- 推薦履歴: 直近リクエストの提示曲、直近N回の提示曲、同一 condition_signature での提示回数、直近リクエストの提示ジャンル
- 現在の季節（セッション日付+設定の区切り月から判定）

### Stage 1: 完全除外（§12.1）

| 条件 | 出典 |
|---|---|
| has_played=false（コール可能曲でない） | §6/§12.1 |
| 当日すでに演奏済み | §12.1 |
| 直前の曲と form が同じ | §12.1 |
| 初心者対応時（beginner=PRESENT）: NOT(is_standard AND no_chart_ok AND simple_form) | §8.2/§12.1 |
| kurobon1_only=true かつ in_kurobon1=false | §11/§12.1 |

### Stage 2: 編成条件（§8）

- horns=MULTI: 歌もの → **強い減点**（完全除外ではなく減点。§8.3「今後調整」→ Provisional: −15、除外/減点は設定で切替可）
- horns=UNKNOWN / beginner=UNKNOWN: 通常候補に加え、条件別ブランチ（Stage 9）を実行

### Stage 3: 強制条件

- kurobon1_only は Stage 1 で除外済み
- genre_override（§10）: **強い加点**（ユーザー確定。フィルタではない）— 指定ジャンル該当曲に `engine.genre_override_bonus`（既定 +15）を加点し、指定ジャンルの低頻度ジャンル減点を無効化。他ジャンルの曲も候補に残る

### Stage 4: スコアリング

`score = BASE(50) + Σ(意図スライダー寄与) + Σ(チェックボックス寄与) − Σ(ルール減点)`

**意図スライダー寄与**（s = スライダー値 −2..+2）:

| 項目 | 寄与式 | metric |
|---|---|---|
| 珍しい曲 | s × 6 × m_rare | 店舗区分別登場回数 a（期間内）: a=0→1.0, 1–2→0.8, 3–5→0.5, 6–10→0.2, 11+→0.0 |
| 久しぶり | s × 6 × m_old | m_old = min(自分の最終演奏からの日数 / 730, 1.0)。未演奏（has_played=trueだが履歴なし）→1.0 |
| 安全性 | (−s) × 1.2 × (safety_score − 5) | safety_score(0–10) = 2×is_standard + 3×no_chart_ok + 2×simple_form + min(自分の演奏回数,5)×0.4 + min(自分のコール回数,3)×⅓。左(−2)=安全曲に最大+12 / 右(+2)=未知曲に最大+12 |
| 雰囲気 | s × 6 × (energy_level − 3) / 2 | ファンク自動優先はしない（属性でなく energy_level のみ参照。§9.5） |
| バラード | バラード属性を持つ曲に s × 8 | s≥+1 のときバラードの低頻度ジャンル減点を免除 |

**チェックボックス寄与**:

| 項目 | 寄与 |
|---|---|
| 季節感 ON | 曲の season == 現在の季節 → +10（通年・不一致は0。避ける方向なし。§9.7） |
| リスナー向け ON | (listener_level − 3) × 4（−8..+8。§9.8） |

**ルール減点**（すべて設定値。既定値は Provisional Values 参照）:

| ルール | 既定 | 出典 |
|---|---|---|
| 直前曲と同じ黒本キー | −15（F・B♭のみ −8 に緩和） | §12.2 |
| 直前曲と特殊ジャンル・特徴が重複（8種、1種ごと） | −15（ジャンル別に 減点/除外 切替可） | §12.3 |
| ブルース常時減点 | −10 | §12.4 |
| 直前曲と同じ作曲者 | −5（やや減点。除外しない） | §12.6 |
| 累計コール回数 上位10曲 | −12（beginner=PRESENT または safety≤−1 で半減 −6） | §12.7 |
| 低頻度ジャンル（自分のコール比率 < 5% のジャンル） | −8（当該曲の意図由来プラス寄与合計 ≥ +10 なら免除 = 「条件に十分合う場合だけ候補へ戻す」§10.4） | §10.3–10.4 |
| horns=MULTI の歌もの | −15 | §8.3 |
| 直前曲のフロント編成に vo あり → 歌もの曲 | −15（フロント編成未入力時はスキップ） | §12.5（ドメインレビュー確定: voで判定） |

### Stage 5: 繰り返し減点（§14.3–14.4）

| 条件 | 既定 |
|---|---|
| 前回リクエストで提示した曲 | −12 |
| 直近5リクエスト（30日以内、セッション横断）で提示した曲 | −6 |
| 同一 condition_signature で30日以内に3回以上提示した曲 | 追加 −6 |
| 前回リクエストの候補に含まれた特殊ジャンルを持つ曲 | −3（ジャンル繰り返し抑制 §14.4） |

**緩和**: Stage 1–3 通過曲数 < 8 のとき、上記をすべて半減（「強い条件指定で候補が少ない場合は減点を緩和」§14.3、「多様性より条件適合を優先」§22-11）。

### Stage 6: 候補集団の作成（§14.2）

- `score ≥ maxScore − 10`（点差バンド）かつ `score ≥ 30`（最低スコア床）
- 集団サイズ < candidate_count+2 の場合、バンドを −15 まで一度だけ拡大
- それでも候補が candidate_count 未満なら**無理に増やさず、少ないことをUIに明示**（§14.5）

### Stage 7: 重み付きランダム抽出（§14.2/§14.4）

- weight = exp((score − maxScore) / τ)、τ=5（softmax。高得点ほど選ばれやすい非均等抽選）
- candidate_count（既定3）曲を非復元抽出。1曲引くたびに、同じ特殊ジャンルを持つ残余曲の weight を ×0.5（ジャンル偏り抑制）

### Stage 8: 推薦理由生成（固定テンプレート。LLM不使用）

発火したルール・事実からテンプレート文を最大4件/曲。例（§15.1準拠）:

| トリガー | テンプレート |
|---|---|
| m_old ≥ 1.0 / ≥0.5 | 「最終演奏から{n}年{m}ヶ月ぶり」 |
| m_rare ≥ 0.8 | 「この店（区分）では直近{期間}の登場{a}回と少なめ」 |
| キー・構成・特殊ジャンルすべて直前曲と不一致 | 「直前曲とキー・構成・雰囲気が変わる」 |
| mood寄与 > 0 | 「今回の『{やや/強く}{盛り上げる/落ち着かせる}』に合う」 |
| listener ON かつ level≥4 | 「リスナーが楽しみやすい曲」 |
| seasonal ON かつ一致 | 「いまの季節（{季節}）の曲」 |
| beginner=PRESENT | 「超定番・譜面なし対応可・構成が単純で初心者向き」 |
| safety寄与 > 0（左） | 「演奏経験・譜面なし対応ありで手堅い」 |
| safety寄与 > 0（右） | 「最近やっていない攻めの一手」 |
| バラード s≥+1 かつ該当 | 「バラードをやりたい意向に合致」 |

### Stage 9: 条件別候補（§8/§15.2）

horns=UNKNOWN → horns=ONE と horns=MULTI の2ブランチ、beginner=UNKNOWN → beginner=NONE と PRESENT の2ブランチでパイプラインを再実行（Stage 5 の履歴減点は共有）。各ブランチの最上位曲が通常候補と重複しない場合のみ「1管なら」「複数管なら」「初心者が参加するなら」ラベル付きで追加提示。重複する場合は追加しない（§8.1/§15.2）。

### 保留曲の扱い（§16）

推薦スコアに一切影響しない。推薦結果の下に**無条件で別枠表示**。完全除外に該当していても隠さず、警告バッジを付ける: 「当日演奏済み」「直前曲と同じ構成」「黒本1条件外」「今回の編成に合いにくい（複数管×歌もの等）」。通常候補と重複した場合は候補側に「保留中」バッジ。

## Provisional Values

§21の未確定事項に対する実装用暫定値。**すべて Setting テーブルに置き、設定画面から変更可能**（Clarification回答どおり）。

| # | §21項目 | 暫定値 | 設定キー（案） |
|---|---|---|---|
| 1 | セットリスト登場回数の集計期間 | 直近2年（730日）。全期間集計は将来の比較検証用に画面表示のみ | `engine.appearance_window_days = 730` |
| 2 | キー別の除外・減点強度 | 完全除外にせず減点。既定 −15、F と B♭ は −8 | `engine.same_key_penalty = 15` / `engine.same_key_penalty_overrides = {"F":8,"Bb":8}` |
| 3 | 特殊ジャンル連続時の扱い | 全8種とも「強い減点 −15」（除外にしない）。ジャンル別に penalty/exclude を切替可 | `engine.consecutive_genre = {"default":{"mode":"penalty","value":15}}` |
| 4 | 管楽器複数時の歌もの | 強い減点 −15（完全除外にしない） | `engine.multi_horn_vocal_penalty = 15` |
| 5 | 安全性スコアの計算式 | safety_score(0–10) = 2×超定番 + 3×譜面なし対応可 + 2×構成単純 + min(演奏回数,5)×0.4 + min(コール回数,3)×⅓、寄与 = (−s)×1.2×(safety_score−5) | `engine.safety_weights = {...}` |
| 6 | 盛り上がり度・リスナー向け度の付与方法 | 1–5の整数を手動付与。未設定はデフォルト3。CSVインポート列+マスター一覧インライン編集で整備 | `master.default_level = 3` |
| 7 | ジャンル上書きのUI | 選曲支援画面の折りたたみ「詳細条件」内にジャンルチップ（複数選択、OR条件の**フィルタ**）。既定は未選択=指定なし | - |
| 8 | 候補集団の作り方 | 最高点から10点以内 かつ スコア30以上。不足時はバンドを15点へ一度だけ拡大 | `engine.pool_band = 10` / `engine.pool_band_relaxed = 15` / `engine.score_floor = 30` |
| 9 | ランダム抽出の重み | softmax: exp((score−max)/τ)、τ=5 | `engine.random_temperature = 5` |
| 10 | 推薦履歴による減点期間 | 前回提示 −12 / 直近5回(30日) −6 / 同条件3回以上 追加−6。候補<8で半減 | `engine.repeat_penalties = {...}` / `engine.repeat_window_days = 30` / `engine.relax_pool_threshold = 8` |
| 11 | 通常候補の表示数 | 3曲（設定で1–5） | `engine.candidate_count = 3` |
| 12 | 保留曲コール時の自動解除 | **自動で解除する**（ユーザー確定・ドメインモデルレビュー） | `pending.auto_release_on_call = true` |
| 15 | ジャンル上書きの加点値（ユーザー確定: フィルタでなく強い加点） | 指定ジャンル該当曲に +15。指定ジャンルの低頻度減点は無効化 | `engine.genre_override_bonus = 15` |
| 16 | §12.5 直前曲ヴォーカル後の歌もの減点 | 直前Performanceのフロント編成に vo が含まれる場合、歌もの属性の曲に −15（フロント編成未入力時はスキップ） | `engine.after_vocal_vocal_penalty = -15` |
| 13 | 季節曲のPiaScore移行 | エクスポート手段がないため、春夏秋冬セットリストの曲名を手動転記し、曲マスターCSVの season 列で投入 | - |
| 14 | 低頻度ジャンルを候補に戻す条件 | 低頻度判定: 自分のコール比率<5%。当該曲の意図由来プラス寄与合計 ≥ +10、またはジャンル上書き指定時に減点免除 | `engine.low_freq_threshold = 0.05` / `engine.low_freq_penalty = 8` / `engine.low_freq_waiver_bonus = 10` |

**追加の暫定値（§21外だが実装に必要）**:

| 項目 | 暫定値 | 設定キー（案） |
|---|---|---|
| 基礎点 | 50 | `engine.base_score = 50` |
| スライダー重み | 珍しさ/久しぶり/雰囲気: 6、バラード: 8、安全性: 1.2（式内係数） | `engine.slider_weights = {...}` |
| 季節一致加点 | +10 | `engine.seasonal_bonus = 10` |
| リスナー向け重み | (level−3)×4 | `engine.listener_weight = 4` |
| 季節の区切り月 | 春=3–5月, 夏=6–8月, 秋=9–11月, 冬=12–2月 | `engine.season_months = {...}` |
| 「久しぶり」基準 | 365日（理由文の閾値。metric は730日で飽和） | `engine.long_unplayed_days = 365` |
| ブルース常時減点 | −10 | `engine.blues_penalty = 10` |
| 同一作曲者減点 | −5 | `engine.same_composer_penalty = 5` |
| コール上位N曲減点 | N=10, −12（初心者対応/安全時 −6） | `engine.top_called_n = 10` / `engine.top_called_penalty = 12` |
| 1曲目の季節チェック初期値 | ON（§9.7の案を採用） | `engine.first_song_seasonal_default = true` |

## Tech Stack & Architecture

### 構成一覧

| レイヤ | 採用技術 | 理由 |
|---|---|---|
| フレームワーク | Next.js（App Router）+ TypeScript strict | Clarification確定。モバイルWeb→将来PWA化可能 |
| UI | Tailwind CSS + shadcn/ui | `docs/design_rule.md` 準拠（カラートークン、h-10タップ領域、focus-visible等） |
| DB | SQLite（WALモード）+ **Drizzle ORM** + better-sqlite3 | 下記比較 |
| 認証 | Auth.js (next-auth v5) Google provider、**JWT セッション戦略 + メール許可リスト** | DBアダプタ不要・ユーザーテーブル不要。`ALLOWED_EMAILS` 環境変数と signIn コールバックで照合。middleware で全ルート保護。サインアップ画面なし |
| バリデーション | Zod | CSVインポート・フォーム・設定値の検証を共通化 |
| ミューテーション | Server Actions | 単一ユーザー・小規模のためAPIレイヤを薄く |
| テスト | Vitest（+ Testing Library） | 推薦エンジン純関数の単体テストが中心 |
| Lint/Format | ESLint + Prettier | |

### Technology Choice: ORM（Drizzle vs Prisma）

| 観点 | Drizzle | Prisma |
|---|---|---|
| SQLite適合 | better-sqlite3 同期ドライバを直接利用。軽量・高速 | 動作するが Rust クエリエンジン同梱でイメージが重い（driver adapter は改善中） |
| Docker/Alpine | ネイティブモジュール（better-sqlite3）のビルドのみ | エンジンバイナリのプラットフォーム整合に注意が必要 |
| スキーマ定義 | TypeScriptコードそのもの（codegen不要） | 独自DSL + generate ステップ |
| 生SQL/集計 | `sql` タグで自在（推薦用の集計クエリと相性良） | 可能だが型付けが弱い |
| マイグレーション | drizzle-kit generate/migrate | prisma migrate（成熟） |
| 管理GUI | drizzle-kit studio | Prisma Studio（強み） |

**推奨: Drizzle ORM**。単一ユーザー・SQLite・Docker自前ホスティングという本件条件では、ランタイムが薄く生SQL集計と親和的な Drizzle が明確に有利。マイグレーションは drizzle-kit で生成した SQL をコンテナ起動時に適用する。

### ディレクトリ構成（案）

```text
src/
  app/
    (auth)/login/page.tsx        # Googleログインのみ
    page.tsx                     # ホーム: ACTIVEセッション or 開始/履歴一覧
    sessions/[id]/page.tsx       # セッション記録画面（主画面）
    sessions/[id]/suggest/page.tsx  # 選曲支援画面（編成・意図・結果）
    songs/page.tsx               # 曲マスター一覧（インライン編集）
    songs/[id]/page.tsx          # 曲マスター編集
    venues/page.tsx              # 店舗マスター（某店区分の確認・修正）
    pending/page.tsx             # 保留曲一覧・解除
    import/page.tsx              # CSVインポート（曲マスター/セットリスト履歴）
    settings/page.tsx            # 設定画面（Provisional Values の全キー）
    api/health/route.ts          # デプロイ用ヘルスチェック
  components/ui/                 # shadcn/ui 生成物
  components/session/ components/suggest/ components/songs/ ...
  db/
    schema.ts                    # Drizzle スキーマ（単一ファイルで開始）
    client.ts                    # better-sqlite3 + WAL 設定
    migrations/                  # drizzle-kit 生成SQL
  lib/
    engine/                      # ★推薦エンジン（純関数・フレームワーク非依存）
      types.ts exclusions.ts scoring.ts repeat.ts pool.ts draw.ts reasons.ts index.ts
    aggregate.ts                 # 事前集計クエリ（登場回数・最終演奏日・コール回数等）
    settings.ts                  # Setting の読み書き + Zodスキーマ + 既定値
    season.ts                    # 季節判定
    auth.ts                      # Auth.js 設定（許可リスト）
  server/
    actions/                     # Server Actions（薄く。engine/queries を呼ぶだけ）
    queries/                     # 読み取り系データアクセス
```

### データアクセス層の設計方針

- **推薦エンジンはDB非依存の純関数**: `recommend(input: EngineInput, settings: EngineSettings): RecommendationResult`。`aggregate.ts` がSQLで EngineInput を組み立てる。乱数は seed 注入可能にしてテスト決定性を確保。
- 書き込みは Server Actions 経由のみ。Zodで入力検証。SQLiteは単一書き込みのため排他は実質不要（WAL + busy_timeout 設定のみ）。
- 集計（店舗区分別登場回数・キー/構成/ジャンル別の当日集計など）はSQL側で実施し、アプリ側で二重集計しない。

## Deployment Architecture

Clarification確定事項: VPS自前ホスティング、GitHub Actions + Docker、mainへのpushで自動デプロイ。

### コンテナ構成（VPS上、docker compose）

```text
[Internet] → Caddy（:443, TLS自動取得/更新, リバースプロキシ） → next-call app（:3000, Next.js standalone）
                                                                    └ volume: /data（SQLite: /data/next-call.db + WAL）
```

- **app イメージ**: multi-stage Dockerfile。`node:22-bookworm-slim` ベース（better-sqlite3 のネイティブビルドのため build stage に python3/make/g++、実行 stage は slim + `next build` の standalone 出力のみ）。
- **起動シーケンス**: entrypoint で `drizzle migrate（生成済みSQL適用）` → `node server.js`。
- **SQLite永続化**: named volume または `/srv/next-call/data` の bind mount。`DATABASE_PATH=/data/next-call.db`。
- **リバースプロキシ/TLS**: Caddy を推奨（Caddyfile 数行で Let's Encrypt 自動化）。VPSに既存の Nginx がある場合はそれに従う（Open Question）。
- **バックアップ**: VPS の cron で毎日 `sqlite3 /data/next-call.db ".backup /backup/next-call-$(date +%F).db"` → gzip、14世代保持。任意で rclone によるオフサイト退避。（将来 Litestream によるレプリケーションも選択肢）

### CI/CD（GitHub Actions）

```text
on: push(main)
  job quality:  npm ci → lint → typecheck → test → build      # Quality Gates と同一コマンド
  job image:    docker build → push ghcr.io/{owner}/next-call:latest + :sha   (needs: quality)
  job deploy:   ssh VPS → docker compose pull && docker compose up -d
                → curl https://{domain}/api/health で確認      (needs: image)
```

- Secrets: `VPS_SSH_KEY` / `VPS_HOST` / `VPS_USER`（GHCR は `GITHUB_TOKEN` で可）。
- アプリ環境変数（VPS側 `.env`）: `DATABASE_PATH`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS`, `AUTH_URL`。
- 電波不安定な店内利用（Clarification）への対策はMVPでは「クラウドDB+リトライ表示」まで。オフラインキュー/PWA化は後続インテント。

## Data Import Plan

初期データ: 曲マスター（数百曲）+ セットリスト履歴（約5年分、iPhoneメモ由来）。**実データのフォーマットは未入手**（Open Questions #1）のため、以下のCSV仕様をアプリ側の受け口として定義し、ユーザーのメモ→CSV変換は別途支援する。

### 曲マスターCSV（songs.csv）

```csv
title,key,form,composer,has_played,no_chart_ok,is_standard,simple_form,in_kurobon1,season,listener_level,energy_level,genres,note
Stella By Starlight,Bb,AABA,Victor Young,1,1,1,0,1,通年,4,3,歌もの,
Recorda Me,C,OTHER,Joe Henderson,1,0,0,0,1,通年,3,3,ボサノバ,
```

- form: `AABA / ABAC / BLUES12 / OTHER`、season: `春/夏/秋/冬/通年`（省略時=通年）、boolean: `1/0`
- genres: `|` 区切り複数可（例: `3拍子|歌もの`）。9種の固定語彙以外はエラー
- listener_level / energy_level: 1–5、省略時 3
- title で upsert（正規化: 全半角・大小・前後空白）

### セットリスト履歴CSV（setlists.csv）

```csv
date,venue_name,order,title,participated,instrument,called_by_me,no_chart,memo
2024-05-12,某店,1,Alone Together,1,sax,1,0,
2024-05-12,某店,2,Blue Bossa,0,,0,0,
```

- `date + venue_name` でセッションを自動生成（同一組は1セッションに集約、order で並び順）
- instrument: `sax / piano / 空`（participated=0 なら空）
- front_instruments: `|` 区切りの楽器コード（例: `vo|as|as`、順序保持・重複可・省略可）※Excel抽出スクリプトが Logs列から生成
- venue_name が未登録の場合: プレビュー画面で某店/某店以外の区分をまとめて確定してから取込

### インポートフロー（4段階）

1. **アップロード** → Zodで行単位バリデーション
2. **プレビュー**: エラー行一覧（行番号+理由）、未知の店舗の区分確定UI、曲名不一致の解決UI（既存曲へのマッチ候補提示 / 新規曲スタブ作成 / スキップ）
3. **ドライラン差分表示**: 新規曲n件・新規セッションn件・更新n件
4. **コミット**: 単一トランザクションで取込。完了後に has_played 再計算オプション（participated=1 の履歴がある曲を ON）

## UI Mockup: セッション記録画面（主画面）

**Source:** collaborative（デザインファイルなし。docs/design_rule.md 準拠、モバイル幅想定）
※ 議論用にラベルは英語表記。実装UIは日本語（例: Suggest next call = 次の曲を考える）。

### Layout

```
┌──────────────────────────────────────────────────┐
│ next-call            2026-07-12    [End session] │
│ Venue: Jazz Spot XYZ   (badge: Home)             │
│ Listeners:  [ Yes | *No ]  (toggle)              │
├──────────────────────────────────────────────────┤
│ Setlist                                          │
│  1. Stella By Starlight     sax  CALL      [...] │
│  2. Alone Together          --   --        [...] │
│  3. Blue Bossa              pf   --        [...] │
│                                                  │
│  [+ Add song]                                    │
├──────────────────────────────────────────────────┤
│           [ Suggest next call ]  (Primary)       │
└──────────────────────────────────────────────────┘
```

曲追加（ボトムシート / shadcn Dialog）:

```
┌──────────────────────────────────────────────────┐
│ Add performed song                               │
│  Song title  [ incremental search............. ] │
│  My part     ( )sax   ( )piano   (*)none         │
│  Called by me [ ]      No chart [ ]              │
│  Memo        [.............................. ]   │
│                          [Cancel]   [Add]        │
└──────────────────────────────────────────────────┘
```

### Interactions

- Listeners トグル: セッション中いつでも即時保存（§4.3）
- 曲行の [...]: 編集/削除メニュー。行タップで参加楽器・コール有無をその場修正
- Add song: 曲名インクリメンタル検索（曲マスター）。未登録曲は「新規登録して追加」導線（最低限 title のみで作成、属性は後で）
- 自分の参加=none の場合 instrument 選択は無効化。called_by_me=ON でコール曲として記録
- Suggest next call: 選曲支援画面へ遷移（Primaryボタンは画面内1つ = design_rule §9）
- End session: 確認ダイアログ → status=ENDED

### Data Mapping

- ヘッダ ← Session.session_date / Venue.name / Venue.is_home / Session.has_listeners
- Setlist 行 ← Performance（order_index 順）+ Song.title
- 楽器表示 ← Performance.instrument（sax/pf/--）、CALL ← called_by_me

## UI Mockup: 選曲支援画面（編成・意図）

**Source:** collaborative

### Layout

```
┌──────────────────────────────────────────────────┐
│ [< Back]        Next call                        │
├──────────────────────────────────────────────────┤
│ Formation (next tune)                            │
│  Horns:     (*)one    ( )multi    ( )unknown     │
│  Beginner:  (*)none   ( )present  ( )unknown     │
│                                                  │
│ Constraints                                      │
│  Kurobon1 only  [ ]                              │
│  > Genre override (collapsed by default)         │
├──────────────────────────────────────────────────┤
│ Intent (carried over from last request)          │
│  Rare song        [---|---|-*-|---|---]          │
│  Long-unplayed    [---|---|---|-*-|---]          │
│  Safe   <-> Bold  [---|-*-|---|---|---]          │
│  Calm   <-> Lift  [---|---|-*-|---|---]          │
│  Ballad avoid<->want [---|---|-*-|---|---]       │
│  [x] Seasonal (autumn)   [ ] Listener-friendly   │
├──────────────────────────────────────────────────┤
│           [ Get candidates ]  (Primary)          │
└──────────────────────────────────────────────────┘
```

### Interactions

- 全スライダー5段階（−2..+2）、前回値を初期表示（§9）。中央=何もしない
- Seasonal: 現在の季節を括弧内に自動表示（利用者は季節を選ばない §9.7）。セッション1曲目はデフォルトON
- Genre override: 折りたたみを開くとジャンルチップ（7種: ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環。バラードは独立スライダーのため除外 §10.2）。複数選択=ORフィルタ
- Get candidates: 推薦実行 → 結果画面へ（同一画面下部への差込みでも可）

### Data Mapping

- Formation/Constraints ← RecommendationRequest.horns / beginner / kurobon1_only / genre_override
- Intent ← SelectionIntent（前回値 carry-over）
- Seasonal の自動季節 ← Session.session_date + Setting engine.season_months

## UI Mockup: 推薦結果表示

**Source:** collaborative

### Layout

```
┌──────────────────────────────────────────────────┐
│ Candidates (3)                    [Re-roll]      │
│ ┌──────────────────────────────────────────────┐ │
│ │ I Remember You        key:F  AABA  (PENDING) │ │
│ │  - 1y2m since you last played it             │ │
│ │  - Rare at this venue (2y: once)             │ │
│ │  - Key/form/feel differ from previous        │ │
│ │            [ Call this ]   [ Hold ]          │ │
│ └──────────────────────────────────────────────┘ │
│  (+2 more cards)                                 │
│                                                  │
│ If horns = unknown:                              │
│ ┌──────────────────────────────────────────────┐ │
│ │ For multi horns: Softly ... (reasons)        │ │
│ └──────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────┤
│ Pending songs (always shown)                     │
│  - Song D   [! played today]   [Call] [Release]  │
│  - Song E                      [Call] [Release]  │
└──────────────────────────────────────────────────┘
```

### Interactions

- 各候補: 推薦理由を複数行表示（固定テンプレート §15.1）。Call this → Performance 作成（called_by_me=ON, instrument 既定 sax）→ 記録画面へ戻る。Hold → PendingSong 登録（カードに PENDING バッジ）
- Re-roll: 同条件で重み付き再抽選（RecommendationRequest は新規保存 → 繰り返し減点が効く）
- 候補が3未満のとき: 「条件に合う曲が少ないため n 曲のみ表示」と明示（§14.5）
- 保留曲: 無条件で全件表示。除外条件該当時は警告バッジ（played today / same form / not in Kurobon1 / hard for this formation）。Call 時に「保留を解除しますか？」確認（Provisional #12）

### Data Mapping

- 候補カード ← RecommendationCandidate.score/reasons + Song（title/key/form）
- 条件別候補 ← candidate_type = ONE_HORN/MULTI_HORN/BEGINNER
- 保留曲 ← PendingSong + 完全除外チェックの再評価結果（警告バッジ）

## UI Mockup: 曲マスター / インポート / 設定（概要）

**Source:** collaborative

### Layout

```
┌──────────────────────────────────────────────────┐
│ Songs (312)   [Search......]  [+ New]  [Import]  │
│ ┌──────────────────────────────────────────────┐ │
│ │ Title            Key  Form   L  E  Genres    │ │
│ │ Alone Together   F    AABA   3  3  --        │ │
│ │ Blue Bossa       C    OTHER  4  3  bossa     │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│ Import  (step 2/4: Preview)                      │
│  songs.csv: 298 ok / 3 errors                    │
│  - line 41: unknown genre "swing"                │
│  New venues: [Jazz Bar ABC]  Home? ( )Y (*)N     │
│  Unmatched titles: 2  -> [resolve...]            │
│              [Back]   [Dry-run diff]             │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│ Settings                                         │
│  Aggregation window (days)      [730 ]           │
│  Same-key penalty               [15  ]           │
│  ... (all engine.* keys, grouped)                │
│  Season months / Candidate count / tau ...       │
│                         [ Save ]                 │
└──────────────────────────────────────────────────┘
```

### Interactions

- 曲マスター一覧: L(listener_level)/E(energy_level) はインライン編集可（Data Gaps #4 の段階的整備用）。行タップで詳細編集（全属性+ジャンルチップ）
- インポート: 4段階ウィザード（Data Import Plan 参照）
- 設定: engine.* をグループ表示、Zod検証、保存即反映（次回推薦から有効）

### Data Mapping

- 一覧 ← Song + song_genres、設定 ← Setting（key-value）

## Quality Gate Candidates

Greenfield のため既存ツーリングなし。導入予定スタック（Next.js + TypeScript + Vitest + ESLint）から以下を提案する。package.json の scripts に定義し、CI（GitHub Actions quality ジョブ）と同一コマンドにする。

| Gate | Command | Source |
|---|---|---|
| typecheck | `npm run typecheck`（tsc --noEmit） | tsconfig.json（導入予定） |
| lint | `npm run lint`（eslint .） | eslint.config（導入予定） |
| tests | `npm run test`（vitest run） | vitest.config（導入予定。推薦エンジン純関数が主対象） |
| build | `npm run build`（next build） | next.config（導入予定） |

```yaml
quality_gates:
  - name: typecheck
    command: npm run typecheck
  - name: lint
    command: npm run lint
  - name: tests
    command: npm run test
  - name: build
    command: npm run build
```

## Open Questions

1. **iPhoneメモの実データフォーマット未入手**: セットリスト履歴・曲マスターの現物サンプルの提供が必要。CSV変換は誰が/どう行うか（変換スクリプト支援の要否）。
2. **某店の実店舗名と表記揺れ**: 自動判定（`home_venue_names` 照合）の初期値として実名が必要。
3. **PiaScore季節セットリストの移行**: 手動転記（CSV season 列）でよいか。曲数の目安は。
4. **保留曲コール時の自動解除**: 暫定「自動解除せず確認ダイアログ」でよいか（§21）。
5. **listener_level / energy_level の初期付与**: デフォルト3で開始し段階整備、で運用上問題ないか。CSVに含めて一括投入するか。
6. **「ヴォーカル参加曲の後は歌ものを避ける」(§12.5)**: 演奏記録に「ヴォーカル参加」フラグを追加するか、直前曲の歌もの属性による連続回避（§12.3）で代替してよいか（暫定: 代替）。
7. **累計コール回数上位10曲（§12.7）の集計期間**: 全期間でよいか（暫定: 全期間）。
8. **ジャンル上書きの意味**: 「フィルタ（絞り込み）」でよいか、「強い加点」にすべきか（暫定: フィルタ）。
9. **推薦履歴の「同じような条件」判定粒度**: 暫定 = horns + beginner + kurobon1_only + genre_override + 各スライダーの符号（−/0/+）のシグネチャ一致。これで十分か。
10. **VPS環境の詳細**: OS、既存リバースプロキシ（Nginx等）の有無、ドメイン名、GHCR利用可否（Docker Hub代替の要否）、バックアップ先。
11. **Googleログインの許可メールアドレス**: `ALLOWED_EMAILS` に設定する実アドレス（複数端末・複数アカウントの想定有無）。
12. **セッション基本情報の「その他、既存のiPhoneメモで管理している情報」（§4.1）**: note 1フィールドで足りるか、構造化すべき項目が他にあるか。

---

## Domain Model Review Decisions（2026-07-12 ユーザーレビュー確定事項）

ドメインモデルは「正確に捉えている」で承認。以下の4点を確定:

1. **フロント編成の記録（§12.5ギャップ対応・ユーザー指定）**: Performance にフロント編成を記録する。
   - 楽器コード: `vo, ss, as, ts, bs, tp, fl, fh, harm, tb, cl, g`（ヴォーカル/ソプラノSax/アルトSax/テナーSax/バリトンSax/トランペット/フルート/フリューゲルホルン/ハーモニカ/トロンボーン/クラリネット/ギター）
   - 楽器マスターは追加可能（設定またはマスター管理から）
   - **順序付き・重複可の複数登録**（例: `vo, as, as, ts` = ヴォーカル+アルト2+テナー）→ InstrumentマスターとPerformanceFrontInstrument（performance_id, instrument_code, position）の設計とする
   - §12.5「歌ものはヴォーカル参加曲の後は避ける」は **直前Performanceのフロント編成に `vo` が含まれるか** で判定
   - 入力は任意（未入力なら判定はスキップ＝減点なし）
2. **保留曲のコール時**: 演奏登録した曲が保留中なら**自動で解除**する
3. **ジャンル上書き**: フィルタではなく**強い加点**（指定ジャンルを優先しつつ他ジャンルの曲も候補に残る）。暫定値: +15点/指定ジャンル該当（設定 `engine.genre_override_bonus`）
4. ドメインモデル本体（エンティティ10種+関係）: 承認済み。上記1により Instrument / PerformanceFrontInstrument を追加

## Alignment Gate Decisions（2026-07-12 確定）

- ユニット分解（9ユニット）: 承認（下記2点の修正を反映）
- **バックアップ方針の変更**: 日次14世代 → **週次・20世代保持**。加えて**任意の断面をピン留めスナップショットとして保存し、明示的に削除しない限り永続保持**できるようにする（unit-09、成功基準#8を更新）
- **マスタ未登録曲のクイック登録**: セッション中の曲追加で検索ヒットしない場合、曲名のみで Song を即時作成できる。この Song は `needs_review=true`（属性未整備）フラグ付きで作成し、マスター管理画面の「属性未整備」フィルタから後で属性を補完する。推薦エンジンは属性未設定の曲を安全側（該当ルールをスキップ）で扱う。自分が participated=true で演奏した曲は has_played を自動で true に更新する
- 納品戦略: intent（全ユニット完成後に1つのPR、auto_merge）
- イテレーションパス: dev単一パス（passes: [], active_pass: ""）

## Excel Source Analysis（2026-07-12 実データ確認済み）

初期データの実体は `/Users/fisico/Downloads/やれる曲.xlsx`（iPhoneメモではなくExcel）。主要シート:

### `list` シート（曲マスター、ヘッダー行=3行目、実データ約733曲）
| Excel列 | 取込先 | 備考 |
|---|---|---|
| Title | songs.title | |
| Key | songs.song_key | `Fm(Ab)` 等の複合表記あり。原文のまま取込 |
| Form | songs.form | AABA→AABA / ABAC→ABAC / Blues→BLUES12 / それ以外（特殊, ABAB, A16A16BA16等）→OTHER（原文はnoteへ） |
| Composer | songs.composer | |
| Ready(可★=仕込み済み193曲) / Done(済★=演奏済み186曲) | **Ready★ OR Done★ → has_played=true**（ユーザー決定） | 仕様§6のコール可能定義に対応 |
| #1（■=227曲） | songs.in_kurobon1 | 黒本1掲載。<黒本1>162/227 の集計と整合 |
| Genre | GenreTag | Ballad→バラード, Bossa→ボサノバ, Waltz→3拍子, Funk→ファンク, Blues→ブルース, Mode→モード, Rhythm Change→循環（ユーザー確認済）。曖昧値（Lain, Ballad?, Swing or Bossa等）は未設定+noteに原文 |
| （Excelに無い） | is_standard / simple_form / listener_level / energy_level / season | 既定値で取込み、後でマスター画面から補完。「歌もの」「キメが多い曲」タグも同様 |

### `logs_all` シート（演奏履歴、実データ2,293行、2021-10-30〜2026-07-04）
| Excel列 | 取込先 | 備考 |
|---|---|---|
| Title / Date / Place | performance / session（Date+Placeで集約） | Place: Somethin'=1280件（**母店=Somethin'**）、Unten=416, 水道橋=144 ほか |
| PlayedPart（-/as/pf） | participated + instrument | as→SAX, pf→PIANO, -→不参加(NONE) |
| CallingByMe | called_by_me | |
| NoScore | no_chart | さらに **NoScore=1の実績がある曲 → songs.no_chart_ok=true を導出** |
| WithVo | （検証用） | Logs列のvoと整合確認に使用 |
| **Logs（Y列）** | **front_instruments** | 「曲名 (as, ts) ※メモ」形式。括弧内をパース: カンマ区切り楽器コード、`as*2`→as,as、`trio`/`all`/空→フロント記録なし。絵文字・※注記は取り込まない |

### 取込方式（ユーザー決定）
- **初回限定の抽出スクリプト**（`scripts/extract-excel.ts` 等）: やれる曲.xlsx → songs.csv / setlists.csv を生成し、既存のCSVインポートAPIへ流す。アプリAPIはCSVのまま
- Excelファイル自体はリポジトリにコミットしない（個人データ）。スクリプトはパス引数で受け取る。テストは匿名化した小型フィクスチャで行う
