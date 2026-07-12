---
status: in_progress
last_updated: "2026-07-12T13:20:02Z"
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
hat: planner
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
- [ ] インポート済み履歴（unit-08）が登場回数・久しぶり度の集計に反映される結合テストがある（unit-08 完成後にCIで有効化してよい。unit-08 から移設した基準）

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
