---
status: pending
last_updated: ""
depends_on: []
branch: ai-dlc/next-call-enhancements/04-stats-api
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-04-stats-api

## Description
統計画面（unit-05）が必要とする集計データを提供するサーバサイド機能。既存 `build-input.ts` の集計ロジックを汎用化して再利用し、絞り込み（店/母店・季節）付きの統計エンドポイント/リポジトリを追加する。要件6のバックエンド。

## Discipline
backend - 集計リポジトリ/サービス（`src/server` 配下、必要なら `src/server/stats` 新設）・API ルート（`src/app/api/stats`）を実装する。

## Domain Entities
Performance（コール/演奏回数・最終演奏日の集計元）, Song（曲別集計・ジャンル/キー/構成の分布）, GenreTag（ジャンル分布）, Session/Venue（季節別・店別・母店別の絞り込み軸）。

## Data Sources
- SQLite（Drizzle ORM）。スキーマ変更なし。
- 既存集計: `src/server/recommendation/build-input.ts`（登場回数・最終演奏日・コール回数・ジャンル比率、L117-189 付近）。統計用に共有できる形へ抽出/汎用化する。
- Venue.is_home（母店判定）, Song.season（季節）を絞り込みに使用。

## Technical Specification
1. **集計ロジックの汎用化**: build-input.ts 内の曲別集計を、推薦入力に依存しない再利用可能な集計関数へ抽出（推薦側の挙動は不変に保つ — 既存テストが通ること）。
2. **統計エンドポイント** `GET /api/stats?venue=<id|home|non_home|all>&season=<SPRING|...|ALL>&from=&to=` 等の絞り込みクエリを受け、以下を返す:
   - **曲別**: title, コール回数, 演奏回数, 最終演奏日（久しぶり度）。ソート可能な配列。
   - **分布**: ジャンル別 / キー別 / 構成(form)別 の件数。
   - **傾向**: 季節別・店別・母店/母店以外別の集計。
   - **期間推移**: 月別の演奏曲数・新曲率（その月に初登場した曲の割合）・多様性指標。
3. リポジトリ関数はフィルタ引数を受け、SQL 集計（GROUP BY 等）で数百曲/数千 performance を即時応答できるよう実装。N+1 を避ける。
4. レスポンス型を明示（型定義を unit-05 と共有できる場所に置く）。

## Success Criteria
- [ ] build-input.ts の集計が汎用関数として抽出され、推薦側の既存テストが不変で全てパスする（エンジンコア不変）
- [ ] `GET /api/stats` が曲別（コール/演奏回数・最終演奏日）・分布（ジャンル/キー/構成）・傾向（季節/店/母店）・月別推移を返す
- [ ] venue（店/母店/母店以外/全体）・season の絞り込みが集計結果に正しく反映される
- [ ] 数千 performance 規模で集計 API が即時応答する（p95 < 1s 目安、SQL 集計で N+1 なし）
- [ ] 集計リポジトリのユニットテストがあり、typecheck / lint / test / build がパスする

## Risks
- **build-input 汎用化での推薦回帰**: 共有抽出で推薦入力が変わると回帰。Mitigation: 抽出は純粋なリファクタに留め、推薦側の既存テストで担保。
- **集計性能**: アプリ側ループ集計だと遅い。Mitigation: SQL の GROUP BY/集約で実装。
- **母店判定の取り違え**: Venue.is_home の意味（母店=true）に忠実に。

## Boundaries
UI・チャート・ナビは含まない（unit-05）。セッション編集/削除/詳細記録は扱わない。`session-record-screen.tsx` を編集しない。depends_on: なし（独立着手可）。

## Notes
- 統計は読み取り専用。書き込み系の副作用を持たせない。
- 絞り込みクエリのキー名・レスポンス shape は unit-05 と齟齬が出ないよう型を共有する。
