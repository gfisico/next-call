---
status: in_progress
last_updated: "2026-07-12T12:48:25Z"
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
hat: planner
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
