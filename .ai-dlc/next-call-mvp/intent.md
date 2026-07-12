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
