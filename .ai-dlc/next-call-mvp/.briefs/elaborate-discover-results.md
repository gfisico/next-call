---
status: success
error_message: ""
---

# Discovery Results

仕様書 `docs/jazz_session_song_recommendation_spec_v2.md`（全852行）と `docs/design_rule.md` を精読し、全所見を `.ai-dlc/next-call-mvp/discovery.md` に永続化した（Domain Model / Recommendation Logic Analysis / Provisional Values / Tech Stack & Architecture / Deployment Architecture / Data Import Plan / UI Mockup ×4 / Quality Gate Candidates / Open Questions）。

## Domain Model Summary

### Entities

- **Song（曲マスター）**: 推薦の中心 — Fields: title, song_key(黒本キー), form(AABA/ABAC/BLUES12/OTHER), composer, has_played(演奏経験=コール可能判定), no_chart_ok, is_standard(超定番), simple_form, in_kurobon1, season(春/夏/秋/冬/通年), listener_level(1–5), energy_level(1–5), note
- **GenreTag（ジャンル・特徴）**: 固定9種（バラード/ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環/キメが多い曲）。1曲に複数付与可（多対多）
- **Venue（店舗マスター）**: name, is_home（某店/某店以外。初回登録時に一度だけ判定し以後自動）
- **Session**: session_date, venue_id, has_listeners（セッション中変更可）, status(ACTIVE/ENDED), note
- **Performance（演奏記録）**: session_id, song_id, order_index, participated, instrument(SAX/PIANO/NONE), called_by_me, no_chart, note — 自分不参加の曲も全記録
- **SelectionIntent（選曲意図）**: 5段階スライダー×5（珍しい曲/久しぶり/安全⇔攻める/落ち着かせる⇔盛り上げる/バラード）+ チェック×2（季節感/リスナー向け）。前回値引き継ぎ
- **RecommendationRequest / RecommendationCandidate（推薦履歴）**: 条件・意図スナップショット + condition_signature + 提示曲・score・reasons — 繰り返し減点の根拠
- **PendingSong（保留曲）**: song_id + created_at のみ。セッションまたぎ保持、スコアに不干渉
- **Setting**: key-value。§21暫定値をすべて設定化
- **User**: DBテーブルなし（Auth.js JWT + `ALLOWED_EMAILS` 許可リスト、単一ユーザー）

### Relationships

- Venue 1—N Session 1—N Performance N—1 Song
- Song N—M GenreTag
- Session 1—N RecommendationRequest 1—N RecommendationCandidate N—1 Song
- Song 1—0..1 PendingSong

### Data Sources

- **SQLite（VPS上、唯一の永続層）**: 全エンティティ+集計（曲数百・演奏記録数千行規模。30秒以内提示は余裕）。Missing: 初期データ
- **iPhoneメモ（約5年分のセットリスト+曲マスター元データ）**: **実データフォーマット未入手**。CSV受け口（songs.csv / setlists.csv 列定義）を discovery.md に定義済み
- **PiaScore（季節曲セットリスト）**: エクスポート手段なし → 手動転記でCSV season 列へ

### Data Gaps

- ヴォーカル参加フラグが演奏記録にない（§12.5の判定材料）→ 暫定: 直前曲の「歌もの」属性で代替（Open Question #6）
- 仕込み済み曲はアプリ管理外 → アプリ内コール可能曲 = has_played=true のみ。仕込み曲は has_played 手動ONで運用
- listener_level / energy_level の初期値 → デフォルト3+マスター一覧インライン編集+CSV列で段階整備
- 某店の実店舗名・表記揺れ未入手 → 設定 `home_venue_names` 照合+初回登録UIで確定

## Key Findings

- **推薦ロジックは9ステージの純関数パイプラインに整理できた**: 完全除外 → 編成条件 → 強制条件（黒本1/ジャンル上書き）→ スコアリング（基礎50点+意図寄与+ルール減点）→ 繰り返し減点 → 候補集団（max−10点/床30点）→ softmax重み付き抽選（τ=5、同ジャンル×0.5）→ 固定テンプレート理由生成 → 編成不明時の条件別ブランチ。全パラメータ設定化。エンジンはDB非依存・seed注入可でVitest単体テストの主対象
- **§21の未確定14項目すべてに実装可能な暫定値（数値・式）を提案済み**（discovery.md「Provisional Values」）。安全性スコア式・ランダム抽出重み・繰り返し減点期間・低頻度ジャンル復帰条件など、追加の暫定値10項目も定義
- **ORMはDrizzle推奨**（vs Prisma）: better-sqlite3同期ドライバ・軽量ランタイム・生SQL集計との親和性・Dockerイメージの軽さで本件条件（単一ユーザー×SQLite×VPS Docker）に明確に有利
- **認証はAuth.js v5 JWT戦略でDBユーザーテーブル不要**: Google provider + signIn コールバックのメール許可リスト + middleware 全ルート保護。サインアップ画面なし
- **デプロイ**: multi-stage Dockerfile（node:22-bookworm-slim、standalone出力）+ Caddy（TLS自動）+ /data ボリュームのSQLite + 起動時マイグレーション。GitHub Actions 3ジョブ（quality → GHCR image → SSH deploy + /api/health 確認）。日次 sqlite3 .backup 14世代
- **§12.3の特殊ジャンル連続回避の対象は8種で「循環」は対象外**（仕様の列挙どおり）— 実装時に9種全部と誤解しやすい点
- 曲マスターの `no_chart_ok`（能力フラグ）と演奏記録の `no_chart`（事実記録）は別物として設計
- UIモックアップ4画面（セッション記録=主画面/選曲支援/推薦結果/マスター・インポート・設定）をASCIIで discovery.md に作成。design_rule.md（Primary1つ/h-10/focus-visible等）準拠前提

## Open Questions

- iPhoneメモの実データフォーマット（サンプル提供とCSV変換の分担）
- 某店の実店舗名・表記揺れ（自動判定の初期値）
- PiaScore季節曲は手動転記でよいか
- 保留曲コール時の自動解除: 暫定「自動解除せず確認ダイアログ」でよいか
- listener_level / energy_level はデフォルト3開始で問題ないか
- §12.5「ヴォーカル参加曲の後」は直前曲の歌もの属性で代替してよいか（or 演奏記録にフラグ追加）
- 累計コール上位10曲の集計期間（暫定: 全期間）
- ジャンル上書きはフィルタか強い加点か（暫定: フィルタ）
- 「同じような条件」判定の粒度（暫定: 編成+黒本1+上書き+スライダー符号のシグネチャ）
- VPS環境詳細（OS/既存リバプロ/ドメイン/GHCR可否/バックアップ先）
- Googleログイン許可メールアドレスの実値
- §4.1「その他iPhoneメモ管理情報」は note 1フィールドで足りるか

## Mockups Generated

- `.ai-dlc/next-call-mvp/discovery.md` § "UI Mockup: セッション記録画面（主画面）" — セットリスト・曲追加シート・「次の曲を考える」導線
- `.ai-dlc/next-call-mvp/discovery.md` § "UI Mockup: 選曲支援画面（編成・意図）" — 編成条件/黒本1/ジャンル上書き/5スライダー+2チェック（前回値引き継ぎ）
- `.ai-dlc/next-call-mvp/discovery.md` § "UI Mockup: 推薦結果表示" — 候補3曲+理由/条件別候補/保留曲別枠（警告バッジ）/再抽選
- `.ai-dlc/next-call-mvp/discovery.md` § "UI Mockup: 曲マスター / インポート / 設定（概要）" — 一覧インライン編集/4段階インポートウィザード/engine.*設定
