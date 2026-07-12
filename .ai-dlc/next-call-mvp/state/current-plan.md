# Plan — unit-08-csv-import-api (backend)

**Branch:** ai-dlc/next-call-mvp/08-csv-import-api
**Worktree:** /Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-mvp-08-csv-import-api
**Bolt:** 1（単一ボルト。ImportJob マイグレーション + 4段階インポートAPI + Excel抽出スクリプト + テスト）
**Depends on:** unit-01（基盤/DB/schema）, unit-03（マスター/セッションAPI・エラー規約・zod・リポジトリ）— 全マージ済み

## 前提調査サマリ（確定した契約・再利用資産）

- **DB/ORM**: better-sqlite3 + Drizzle（同期API .all()/.get()/.run()、同期 db.transaction((tx)=>{})）。schema は additive のみ（列削除・改名禁止）。マイグレーションは drizzle-kit generate → src/db/migrations/000N_*.sql、runMigrations()（src/db/migrate.ts）で適用。既存最新は 0001。
- **エラー規約**（src/server/http/errors.ts）: { error: { code, message, details? } }。code = VALIDATION_ERROR(400)/NOT_FOUND(404)/CONFLICT(409)/INTERNAL_ERROR(500)。ショートハンド validationError/notFound/conflict。
- **Route 規約**（src/server/http/handler.ts）: 全 Route を withErrorHandling() で包む。ZodError→400自動変換。parseJsonBody(req, schema) あり（JSON用）。POST=201・DELETE=204・GET/PATCH=200・camelCase・リソース名エンベロープ。Route は薄く、業務ロジックは server 層へ。
- **正規化**（src/lib/normalize-title.ts）: normalizeTitle() = NFKC+小文字+trim+連続空白圧縮。曲名マッチの唯一の規則。songs.titleNormalized 列（index 済み idx_songs_title_normalized）に一致させる。
- **再利用リポジトリ関数**:
  - src/server/repositories/songs.ts: normalizeTitle 連携、resolveTagIds（private・genre名→id、未知は validationError）、attachGenreTags、quickCreateSong（正規化一致で既存返却 / 無ければ needsReview=true スタブ作成）。※createSong/updateSong は自前で db.transaction を開くので commit の単一トランザクション内では呼ばず、tx レベルの insert/update を直書きする（ネスト回避）。genre 解決は genreTags を直接引く同等ロジックを commit 内 tx で実装。
  - src/server/repositories/masters.ts: venues/genreTags の参照。venue 作成は commit tx 内で直書き（createVenue もトランザクションを開くため）。
  - src/server/repositories/performances.ts: insertFrontInstruments（position 0..振り直し）・assertInstrumentCodes（未知コード400）・markSongPlayed の実装パターンを踏襲（同ファイルは private のため commit 内に同等ロジックを tx で実装）。
- **スキーマ既知値**:
  - songs: title(unique)/titleNormalized(notNull,index)/songKey(nullable)/form enum(AABA|ABAC|BLUES12|OTHER,default OTHER)/composer/hasPlayed/noChartOk/isStandard/simpleForm/inKurobon1/season enum(SPRING|SUMMER|AUTUMN|WINTER|ALL,default ALL)/listenerLevel(1-5,default3)/energyLevel(default3)/needsReview/note。
  - genre_tags: 固定9種（GENRE_TAG_NAMES in src/db/seed.ts: バラード/ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環/キメが多い曲）。song_genre_tags 中間表。
  - venues: name(unique)/isHome(default false)。sessions: sessionDate(YYYY-MM-DD)/venueId/hasListeners/status(ACTIVE|ENDED,default ACTIVE)。performances: sessionId/songId/orderIndex/participated/instrument enum(SAX|PIANO|NONE,default NONE)/calledByMe/noChart/note。performance_front_instruments: PK(performanceId,position)、instrumentCode→instruments。
  - instruments（12種: vo ss as ts bs tp fl fh harm tb cl g）。
- **テスト基盤**: vitest projects（node/dom 分離）。API テストは Route を直接 import して呼ぶ方式（tests/api/helpers.ts: setupTestDb() が一時DB+runMigrations()+seedDatabase()、jsonRequest/getRequest/routeParams/expectApiError/testDb）。
- **既存 scaffold**: tests/api/recommendations-import.test.ts に skipIf(true) の結合テストと「import route が存在しないこと」を検証する backpressure テストあり。unit-08 完成後に有効化する契約（handoff-notes L19）。importRouteExists() は src/app/api/import/route.ts 固定パス判定 → 実ルート構成に合わせて更新が必要。
- **export 網羅**（src/server/repositories/export.ts + tests/api/export.test.ts の固定 EXPORT_TABLE_KEYS）: import_jobs は使い捨て作業表のためエクスポート対象外とする（テストは固定キー配列なので破綻しない）。export.ts に「import_jobs は意図的に除外（transient work table）」のコメントを追加。
- **依存の現状**: CSV/XLSX ライブラリは未導入（csv-parse/exceljs/papaparse/xlsx いずれも無し）。zod v4・tsx あり。
- **実データ**: /Users/fisico/Downloads/やれる曲.xlsx は存在する（list 733曲・logs_all 2,293行）→ 基準12のリハーサル対象。リポジトリにはコミットしない。

## ルーティング設計上の決定（Next.js 制約）
POST /api/import/:type と /api/import/:jobId/... は Next.js の「同一階層で異なる名前の動的セグメント（[type] と [jobId]）を併置できない」制約に抵触する。よってジョブ系は静的 jobs セグメント配下に置く（spec の :jobId 直下記法からの合理的な逸脱・計画に明記）:
- src/app/api/import/[type]/route.ts — POST（アップロード・プレビュー作成）
- src/app/api/import/jobs/[jobId]/resolutions/route.ts — POST
- src/app/api/import/jobs/[jobId]/dry-run/route.ts — GET
- src/app/api/import/jobs/[jobId]/commit/route.ts — POST
- src/app/api/import/jobs/[jobId]/route.ts — DELETE

## ライブラリ選定
- **CSV パース**: csv-parse（csv-parse/sync の同期 parse）を dependencies に追加。理由: BOM除去(bom:true)・引用符・改行内包に堅牢、columns:true でヘッダ→オブジェクト、同期APIが better-sqlite3 の同期モデルと整合。papaparse は代替だが csv-parse を採用。
- **XLSX パース**: exceljs を devDependencies に追加（抽出スクリプトは CLI 専用・アプリ非組込のため本番 bundle に含めない）。理由: 現行メンテ・型定義同梱・シート/行アクセスが明快。SheetJS(xlsx) は npm 配布/セキュリティ勧告の懸念があり回避。フィクスチャ xlsx も exceljs で生成（コミットせずテスト内生成）。

---

## タスク一覧

### Task 1 — ImportJob マイグレーション（additive）[基準 全体の土台]
- src/db/schema.ts に importJobs テーブル追加（末尾・additive）:
  - id PK autoincrement
  - type text enum(songs|setlists) notNull
  - status text enum(PREVIEW|COMMITTED|DISCARDED) notNull default PREVIEW
  - parsedRows text notNull default '[]'（検証済み有効行の JSON。行番号付き）
  - errors text notNull default '[]'（{ line, reason, raw } の JSON 配列）
  - unknowns text notNull default '{}'（songs: 無し / setlists: { venues:[], titles:[{csvTitle, candidates:[{songId,title,matchType}]}] } の JSON）
  - resolutions text（venue is_home マップ + 曲名解決の JSON。nullable）
  - createdAt / updatedAt（utcNow 既定）
- npm run db:generate で 0002_*.sql を生成（手書きではなく drizzle-kit）。tests/db/migrate.test.ts が通ることを確認。
- export.ts に import_jobs 除外コメントを追記（export 網羅契約の明示）。

### Task 2 — zod 行スキーマ・変換（src/server/validation/import.ts）[基準 1,2,3,4,11]
- **songsCsvRow**: CSV ヘッダ（title,key,form,composer,has_played,no_chart_ok,is_standard,simple_form,in_kurobon1,season,listener_level,energy_level,genres,note）→ camelCase + 型変換。
  - title 必須 trim min1。key→songKey（nullable）。form enum 検証。
  - boolean 列（has_played/no_chart_ok/is_standard/simple_form/in_kurobon1）: "1"→true "0"/空→false、それ以外エラー。
  - season: 春→SPRING/夏→SUMMER/秋→AUTUMN/冬→WINTER/通年・空→ALL、それ以外エラー。
  - listener_level/energy_level: 1–5、空→3。
  - genres: | 区切り→配列、各要素は GENRE_TAG_NAMES の9語彙のみ（未知はエラー行に理由付き）。空→[]。
- **setlistsCsvRow**: ヘッダ（date,venue_name,order,title,participated,instrument,called_by_me,no_chart,memo,front_instruments）。
  - date YYYY-MM-DD 形式検証。venue_name 必須。order int。title 必須。
  - participated 1/0。instrument: sax→SAX/piano→PIANO/空→NONE、participated=0 なら強制 NONE。called_by_me/no_chart 1/0。
  - front_instruments: | 区切りコード列（順序保持・重複可・空可）。コード実在検証は commit 時（instruments マスター）。
- **resolutionsSchema**: { venues: Record<string, boolean>, titles: Record<string, { action: "match"|"create_stub"|"skip", songId?: number }> }（match 時 songId 必須を refine）。
- **commit クエリ**: recalcHasPlayed（boolean、既定 false）。
- 行数上限定数 MAX_ROWS = 20000。

### Task 3 — CSV パース + プレビュー生成（src/server/import/preview.ts）[基準 1,2,3,4]
- multipart から CSV テキスト取得（Route 側で req.formData() → File → text()）。
- csv-parse/sync（bom:true, columns:true, skip_empty_lines:true, trim:true）で行配列化。行数 > MAX_ROWS は 400（明示エラー）。ヘッダ不足/不正列は 400。
- 行ごとに zod 検証 → parsedRows（成功・行番号付き）と errors（{ line, reason, raw }）に振り分け。エラー行があっても有効行でプレビュー継続（基準3）。
- **songs**: 有効行の titleNormalized で既存曲突合 → 新規/更新の内訳を preview サマリに含める。unknowns は空。
- **setlists**:
  - 未知 venue_name 一覧（venues.name に無いもの）を収集 → is_home 解決が必要な集合。
  - マスター未一致 title 一覧（normalizeTitle で titleNormalized 完全一致が無いもの）を収集し、各々に近似候補最大3件を付与。候補順序: (1)完全一致（raw title 一致）→(2)正規化一致→(3)部分一致（titleNormalized の substring / LIKE %q%）。重複除去し先頭3件。
- ImportJob(PREVIEW) を作成（type/parsedRows/errors/unknowns 保存）。
- レスポンス: { job: { id, type, status }, totalRows, validRows, errors, unknowns }。

### Task 4 — Route: アップロード・resolutions・DELETE [基準 3,4,5,6,7]
- import/[type]/route.ts POST: type を songs|setlists に検証（それ以外 404/400）→ formData 取得 → Task3 preview → 201 { job, totalRows, validRows, errors, unknowns }。全て withErrorHandling。
- import/jobs/[jobId]/resolutions/route.ts POST: job 取得（無ければ 404、status!=PREVIEW は 409）→ parseJsonBody(resolutionsSchema) → resolutions 列へ保存 → 200 { job }。
- import/jobs/[jobId]/route.ts DELETE: job を DISCARDED に更新 → 204。
- ImportJob の永続化は src/server/repositories/import-jobs.ts（getJob/createJob/saveResolutions/markStatus）。

### Task 5 — dry-run（src/server/import/dry-run.ts + Route）[基準 5]
- import/jobs/[jobId]/dry-run/route.ts GET: job(PREVIEW) + resolutions を読み、DB 読み取りのみで差分サマリを算出:
  - songs: 新規曲n / 更新曲n（titleNormalized 突合）。
  - setlists: 新規店舗n（未知 venue のうち解決済み）/ 新規セッションn（date+venue の組数、既存重複はエラー予告としてカウント）/ 新規演奏記録n / スキップn（title action=skip、または未解決）。
  - create_stub 予定数も内訳表示。
- 一切 INSERT/UPDATE しない（トランザクションを開かない・読み取りクエリのみ）。基準: dry-run 前後で全テーブル件数不変。
- 200 { summary: {...} }。

### Task 6 — commit（src/server/import/commit.ts + Route）[基準 1,2,6,7,8,9,11]
- import/jobs/[jobId]/commit/route.ts POST: parseJsonBody(commitSchema)（recalcHasPlayed）→ job 取得（PREVIEW 以外は 409「1ジョブ1回」）→ commit → job を COMMITTED に更新 → 200 { summary }。
- **単一 db.transaction((tx)=>{...})**（途中 throw で全ロールバック → 部分取込ゼロ・基準6）:
  - **songs**: 各有効行を titleNormalized で upsert。既存→UPDATE（列 + genres 差し替え: song_genre_tags 全削除→再挿入）。新規→INSERT（titleNormalized 付与）。genre 名→id は tx 内で genreTags を直接引く（resolveTagIds 同等）。
  - **setlists**:
    - title 解決を適用: action=match→songId 使用 / create_stub→needsReview=true スタブを tx 内 INSERT（既存 quickCreate 相当を tx で）/ skip→当該行除外。マスター一致済み title は自動 match。
    - venue: 既存は id 使用。未知は resolutions の is_home で tx 内 INSERT（name unique）。
    - session: date+venue_name の組ごとに 1 セッション。既存の同 date+venue セッションがあれば throw conflict（二重取込防止・基準7）。無ければ INSERT（status は ENDED=履歴取込。sessionDate=date）。
    - performance: 同一組内で order 昇順に orderIndex を採番し INSERT（instrument マッピング済み、participated=0→NONE、calledByMe、noChart、note=memo）。
    - front_instruments: コードを instruments マスターで検証（未知は throw validationError）、position 0.. で performance_front_instruments へ順序どおり INSERT（基準11）。
  - **recalcHasPlayed=true**: participated=1 の演奏実績を持つ曲の hasPlayed を tx 内で ON（基準8）。
  - サマリ（created/updated/sessions/performances/skipped/stubs）を集計して返す。

### Task 7 — Excel 抽出スクリプト（scripts/extract-excel.ts）[基準 10,12]
- CLI: tsx scripts/extract-excel.ts <xlsx-path> [--out-dir <dir>]（package.json に extract:excel script 追加、アプリには組み込まない）。exceljs で読む。
- **list シート（ヘッダー3行目）→ songs.csv**（discovery.md「Excel Source Analysis」表に厳密準拠）:
  - Title→title、Key→key（Fm(Ab) 等原文）、Composer→composer。
  - Form: AABA→AABA / ABAC→ABAC / Blues→BLUES12 / それ以外→OTHER（原文は note へ）。
  - Ready(可★) OR Done(済★) → has_played=1。#1(■) → in_kurobon1=1。
  - Genre→9語彙マッピング（Ballad→バラード/Bossa→ボサノバ/Waltz→3拍子/Funk→ファンク/Blues→ブルース/Mode→モード/Rhythm Change→循環）。曖昧値(Lain/Ballad?/Swing or Bossa 等)→genres 空 + note に原文 + 警告。
  - is_standard/simple_form/listener_level/energy_level/season は既定値（空/3/通年）。
- **logs_all シート → setlists.csv**:
  - Title/Date/Place→date+venue_name（Date+Place集約）。PlayedPart: as→SAX/pf→PIANO/-→participated=0,NONE。CallingByMe→called_by_me。NoScore→no_chart。
  - Logs(Y列) の括弧内→front_instruments（| 区切り列を追加）: カンマ区切り楽器コード、as*2→as|as、trio/all/空→編成なし、絵文字・※注記は除去、未知コードは警告リスト。
  - 導出: NoScore=1 の実績がある曲 → songs.no_chart_ok=1（list 側 CSV に反映）。
- 出力: songs.csv / setlists.csv（UTF-8）+ 警告レポート（未知ジャンル・未知楽器コード・日付不正等を stderr/ファイルへ）。

### Task 8 — テスト [基準 1–12]
CSV 大型フィクスチャ・xlsx フィクスチャはコミットせずテスト内生成（個人データ非混入）。
- tests/api/import-songs.test.ts: songs.csv upsert（新規/更新）・genres 複数タグ・season/boolean/level 変換（基準1）。エラー行（行番号+理由）を返しつつ有効行プレビュー継続（基準3）。
- tests/api/import-setlists.test.ts: 約5,000行を生成して date+venue セッション集約・order 順演奏記録（基準2）。performances が session 経由で正しい date・called_by_me を持つ（基準9）。front_instruments が position 順で保存（基準11）。
- tests/api/import-resolutions.test.ts: 未知 venue の is_home 解決・title match/create_stub(needsReview=true)/skip がコミットに反映（基準4）。近似候補（完全→正規化→部分・最大3件）の順序検証。
- tests/api/import-dry-run.test.ts: dry-run 前後で全テーブル件数不変 + サマリ正当（基準5）。
- tests/api/import-commit.test.ts: 途中失敗（例: 不正 front コード / 二重 session）で部分取込が残らない（基準6）。同一 date+venue 二重取込が 409（基準7）。recalc_has_played で participated=1 曲の has_played=ON（基準8）。1ジョブ2回目 commit は 409。
- tests/scripts/extract-excel.test.ts: exceljs で匿名化小型 xlsx を生成→抽出→ songs.csv/setlists.csv を検証（has_played=Ready/Done・in_kurobon1=#1・Genre マッピング・front 編成 as*2/trio/空 の解釈・no_chart_ok 導出）（基準10）。
- tests/api/recommendations-import.test.ts の有効化: importRouteExists() を実ルート（src/app/api/import/[type]/route.ts）判定に更新、skipIf(true) を外し end-to-end 本体を実装（インポート済み履歴が集計へ反映・基準9 の結合。backpressure テストも実装状態に整合）。
- 基準12（実データリハーサル）: existsSync("/Users/fisico/Downloads/やれる曲.xlsx") ガード付きテスト（無ければ skip）で 抽出→POST import→resolutions→dry-run まで通し、警告リストを出力（コミットはしない）。

### Task 9 — 検証・依存追加
- 依存: csv-parse（dependencies）、exceljs（devDependencies）。npm install。
- npm run db:generate（0002 migration）。
- npm run typecheck / npm run lint / npm run test（既存 60+ テスト + 新規を全て緑）。
- deployable: Docker 構成不変（migration は起動時 runMigrations で自動適用・additive）。

---

## 成功基準カバレッジ（12/12。spec の - [ ] は12項目）
1. songs.csv 正常取込 → Task2,3,6 + import-songs.test
2. setlists.csv 5,000行 集約/order → Task3,6 + import-setlists.test
3. バリデーションエラー行＋有効行継続 → Task3 + import-songs.test
4. venue/title 解決反映（create_stub=needsReview）→ Task2,5,6 + import-resolutions.test
5. dry-run DB無変更 → Task5 + import-dry-run.test
6. commit 単一トランザクション → Task6 + import-commit.test
7. 二重 date+venue エラー → Task6 + import-commit.test
8. recalc_has_played → Task6 + import-commit.test
9. performances 日付/called_by_me（＋集計結合の scaffold 有効化）→ Task6,8 + recommendations-import.test
10. 抽出スクリプト fixture xlsx 検証 → Task7 + extract-excel.test
11. front_instruments 順序保存 → Task2,6 + import-setlists.test
12. 実データ抽出→取込リハーサル（dry-run まで）→ Task7,8（存在ガード付き）

## リスク
- **Next.js 動的セグメント併置不可**（[type] と [jobId]）→ ジョブ系を import/jobs/[jobId]/... に配置（spec の :jobId 記法から合理的逸脱・明記）。scaffold の importRouteExists() も実パスへ更新。
- **単一トランザクションでのリポジトリ再利用**: 既存 createSong/createVenue/startSession/addPerformance は各自 db.transaction を開くためネスト/ロールバック境界が曖昧化。→ commit 内は tx レベルの直書き（同等ロジックを再実装）で 1トランザクションを厳守。共通の純関数（normalizeTitle・genre/instrument 解決）のみ再利用。
- **Excel 実データの表記揺れ**（Key 複合表記・別名・Logs 想定外書式）→ 抽出は警告リスト出力＋人手確認、曲名は NFKC 正規化＋近似候補で解決（自動マージしない）。実データはコミットせずパス引数。
- **大量行のメモリ/性能**: 全行メモリ処理。MAX_ROWS=20,000 で明示エラー。5,000行 1トランザクションは SQLite で十分（テストで実証）。
- **XLSX ライブラリのセキュリティ/配布**: SheetJS 回避、exceljs を devDependency（本番非組込）に限定。フィクスチャは生成しコミットしない。
- **export 網羅契約**: import_jobs を意図的に除外（使い捨て work table）→ export.ts にコメント、EXPORT_TABLE_KEYS（固定配列）は不変で破綻しない。
- **CSV 文字コード/BOM・iPhoneメモ由来の揺れ**: csv-parse bom:true + normalizeTitle で吸収。
- **季節列**: PiaScore 由来の手動転記前提（既定 ALL）。抽出スクリプトは season を設定しない（既定）。