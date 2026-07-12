---
status: in_progress
last_updated: "2026-07-12T17:11:29Z"
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
hat: planner
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
- [ ] setlists 取込が performances テーブルに正しい日付（date+venue_name のセッション経由）・called_by_me で保存される（ユニット内で検証可能な基準。集計への反映の結合テストは unit-04 の成功基準に移設済み）
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
