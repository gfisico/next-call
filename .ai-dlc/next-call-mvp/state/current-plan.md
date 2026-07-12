# 実装計画 — unit-07-master-settings-screen（frontend / Bolt 1）

## 概要
曲マスター（一覧・編集）／設定（エンジン・楽器・母店・エクスポート）／CSVインポートウィザード（4段階UI）を実装する。
API はすべて実装済み（unit-03 マスタ/設定/エクスポート・unit-08 インポート4段階）。本ユニットは **UIのみ**（パース/解決/コミット処理・API 追加はしない）。
唯一の fetch 集約点 `src/lib/api/client.ts` を拡張し、SWR フックとフォームは必ずここを通す（criterion 5 の fetch モックテスト容易化）。

## 事前調査で確定した事実（設計判断の根拠）
- **API 契約**（既存・そのまま利用）:
  - `GET /api/songs?q&needsReview&genre&season&hasPlayed&sort=title|updated` → `{ songs: Song[] }`（title 部分一致・フィルタは AND・サーバ側）
  - `POST /api/songs`（title のみ必須・他は DB 既定）→201 `{ song }`／`PATCH /api/songs/:id`（部分更新・needsReview 解除・genreTags 差し替え）→`{ song }`／`DELETE /api/songs/:id`→204、参照中は **409 CONFLICT**
  - `GET/PUT /api/settings` → `{ settings: Record<string,unknown> }`。PUT は既知キーのみ strict（未知キー400）、値の型はシード型（number/boolean/object）
  - `GET/POST /api/instruments`（POST=201・code 重複409）、`PATCH /api/venues/:id`（name/isHome）、`GET /api/genre-tags`、`GET /api/venues`
  - `GET /api/export` → JSON 添付（`content-disposition: attachment`）
  - インポート4段階（handoff 通り・ジョブ系は `import/jobs/[jobId]` 配下）:
    1. `POST /api/import/[type]`（type=songs|setlists・**multipart/form-data**の file）→201 `{ job:{id,type,status}, totalRows, validRows, errors:ErrorRow[], unknowns }`（setlists の unknowns= `{venues:string[], titles:[{csvTitle,candidates:TitleCandidate[]}]}`、songs は `{}`）
    2. `POST /api/import/jobs/[jobId]/resolutions` body `{ venues:{[name]:boolean}, titles:{[csvTitle]:{action:"match"|"create_stub"|"skip", songId?}} }` → PREVIEW 以外は409
    3. `GET  /api/import/jobs/[jobId]/dry-run` → `{ summary: DryRunSummary }`（songsToCreate/Update, venuesToCreate, unresolvedVenues, sessionsToCreate, duplicateSessions, performancesToCreate, skippedRows, stubsToCreate）
    4. `POST /api/import/jobs/[jobId]/commit` body `{ recalcHasPlayed?:boolean }` → `{ summary: CommitSummary }`（...Created 各種 + hasPlayedRecalculated）／`DELETE .../[jobId]`→204（DISCARDED）
- **設定値の唯一の情報源**: `src/db/seed.ts` の `SETTING_SEEDS`（discovery「Provisional Values」を転記済み）。既定値・キー集合はここに一致させる。
- **既存の再利用資産**: `Segment`(radiogroup) / `Toggle`(pill radiogroup) / `Badge` / `Card` / `Button` / `Checkbox` / `Dialog`(shadcn) / `Table`(shadcn) / `ConfirmDialog`(session/confirm-dialog.tsx) / `ios-slider`。Toaster は `(main)/layout.tsx` にマウント済み・testing-library 導入済み・SWR 採用・dom テスト基盤（tests/setup/dom.ts, helpers/mock-fetch.ts, helpers/render.tsx renderWithSWR）あり。
- **共有シェル**: `(main)/layout.tsx` の `<main>` は `max-w-lg`（モバイル最適・unit-05/06 が依存）。

## 設計判断（調査で判明した制約への対処）
1. **エンジン設定は「スライダー」でなく「数値入力」を採用**。理由: 共有 `ios-slider` は min=-2/max=2/step=1 固定で、engine.* は 730・15・0.05 等レンジがバラバラで不適合。ワイヤーフレーム Screen 3 自体も数値入力フィールド（`.field.sm`）で描画している。→ 各項目は `type=number` の入力＋min/max（zod と整合）＋説明文＋グループ単位「既定値に戻す」。boolean 項目は既存 `Toggle` を流用。
2. **「黒本1」フィルタチップはクライアント側フィルタ**。GET /api/songs に inKurobon1 パラメータが無いため、取得済みリストを `song.inKurobon1` で絞り込む（一覧は数百件で軽量・API 境界を侵さない）。needsReview/hasPlayed/season/genre はサーバ側パラメータを使用。
3. **設定のネスト JSON キー**（repeat_penalties, slider_weights, safety_weights, same_key_penalty_overrides, consecutive_genre, season_months）は、`settings-meta` で「親キー＋パス」を持つ葉フィールドとして展開編集。保存時は現在の親オブジェクトへ葉値をマージして親キーごと PUT する（PUT は object 型を丸ごと受ける）。複雑・非数値の season_months は読み取り専用表示に留める。
4. **インポートの再開（中断中ジョブ一覧）はクライアント sessionStorage で実現**。プレビュー応答（errors/unknowns/counts）を再取得する GET API が unit-08 に存在しない（jobs 一覧/単体 GET 無し）ため、Step2 復元に必要なデータをサーバから引けない。→ ウィザード進行状態（jobId・type・プレビュー結果・解決選択・現在ステップ）を sessionStorage に保存し、`/settings/import` 上部に「中断中のインポート」を同ストアから列挙して再開。※ 別端末/別ブラウザ再開は範囲外（unit-08 に GET /api/import/jobs を足す followup 候補として明記）。
5. **multipart アップロード対応**: `apiFetch` は body があると `Content-Type: application/json` を付与するため FormData で壊れる。→ `apiFetch` に「body が FormData なら JSON ヘッダを付けない」分岐を追加し、`uploadImport(type, file)` を新設。
6. **エクスポートDL**: `downloadExport()` を新設（fetch→blob→objectURL→`<a download>` クリック）。JSON パースを通さないため apiFetch とは別経路。
7. **PC(1024px) 対応**: 共有シェルの `max-w-lg` は維持（session 画面の意匠を壊さない）。マスター一覧/インポートの表は `overflow-x-auto` で横スクロールし崩さない（criterion 7=崩れない）。真の広幅が要る一覧/表は lg+ でフルブリード（`lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2 lg:max-w-[1024px]`）に展開する方式を採る。モバイルはカードリスト、sm+ はテーブル表示。

## タスク（Bolt 1）

### Task 1 — API クライアント/フック/型の拡張（土台）
- `src/lib/api/types.ts`: `SongUpsertPayload`（全属性 partial・title 必須）, `Instrument`（既存）, `InstrumentCreatePayload`, `VenueUpdatePayload`, `SettingsMap=Record<string,unknown>`, インポート系型（`ImportType`, `ErrorRow`, `TitleCandidate`, `SetlistUnknowns`, `PreviewResult`, `ResolutionsPayload`, `DryRunSummary`, `CommitSummary`）を追加（サーバ実装の shape に一致）。
- `src/lib/api/client.ts`: `listSongs(query)` / `createSong` / `updateSong` / `deleteSong` / `getSettings` / `putSettings(entries)` / `createInstrument` / `updateVenue` / `fetchGenreTags` / `uploadImport(type,file)` / `saveResolutions` / `fetchDryRun` / `commitImport` / `discardImport` / `downloadExport` を追加。`apiFetch` に FormData 分岐を追加。
- `src/lib/api/hooks.ts`: `useSongs(query)` / `useSettings()` / `useInstruments()`（既存を拡張） / `useVenues()`（既存） / `useGenreTags()`、`SWR_KEYS` に songs(list key)・settings・genreTags を追加。ミューテーション後 `mutate` 再検証運用を踏襲。
- 対象基準: 全基準の土台（特に 5=fetch モックの単一集約点）。

### Task 2 — 共有UI部品の追加（design_rule 準拠・既存優先）
- `src/components/ui/chip.tsx`: フィルタ/選択チップ（`role` 準拠・aria-pressed・rounded-full・色＋太字で状態表現）。単一/複数選択の両用途。
- `src/components/ui/number-field.tsx`: ラベル＋説明＋`type=number`（min/max/step）＋focus-visible ring（design_rule §6.4）。
- `src/components/master/wizard-steps.tsx`: 4段階ステッパ（done/on/todo・aria-current）。
- ジャンル9チップは Task4/6 で `GENRE`定数（types の `Genre`）＋Chip で構成。既存 Segment/Toggle/Badge/Table/Dialog/ConfirmDialog を最大限流用（新規は上記3点のみ）。
- 対象基準: 8（design_rule 準拠：チップ・フォーム・バッジ・テーブル・トースト）。

### Task 3 — 曲マスター一覧 `/songs`
- `src/app/(main)/songs/page.tsx` を実画面に差し替え（`SongListScreen` を `src/components/master/song-list-screen.tsx` に実装）。
- 検索: 入力 → debounce 250ms（`useSongs` に q 反映・既存 useSongSearch と同方式）。フィルタチップ: 属性未整備(needsReview)／コール可能(hasPlayed)／黒本1(client filter)／季節(単一選択 dropdown)／ジャンル(単一選択 dropdown)。複数チップは AND。
- 上部に **「属性未整備 n曲」バナー**（needsReview=true 件数を別クエリで取得）→ タップで needsReview フィルタ適用（1タップ補完導線）。
- 「＋新規追加」→ `/songs/new` へ push。行タップ→ `/songs/[id]`。
- レスポンシブ: モバイル=カードリスト（曲名・key/構成/黒本1 バッジ・needsReview 警告バッジ）、sm+=テーブル（overflow-x-auto・lg+ フルブリード）。
- 対象基準: 1（検索・各フィルタ・needs_review ショートカット）、7（375/1024）、8。

### Task 4 — 曲編集 `/songs/[id]` ＋ `/songs/new`
- `src/app/(main)/songs/[id]/page.tsx`・`src/app/(main)/songs/new/page.tsx`（共通 `SongEditScreen` を `src/components/master/song-edit-screen.tsx` に）。
- 全属性フォーム: 曲名(必須)・黒本キー・構成(Segment: AABA/ABAC/BLUES12/OTHER)・作曲者・演奏経験あり/譜面なし対応可/超定番/構成が単純/黒本1曲載(Checkbox)・季節(Segment 春/夏/秋/冬/通年)・リスナー受け度/盛り上がり度(Segment 1–5)・ジャンルタグ(9チップ複数選択)・メモ。
- 新規=`createSong`(POST)、既存=`updateSong`(PATCH)。title 重複 409 はトースト表示。
- **needs_review 解除**: 「属性の入力が完了しましたか？」チェック → 保存時に `needsReview:false` を送る。「保存して次の未整備曲へ」= 保存後に needsReview 一覧の次曲へ push（連続補完）。
- 削除: Destructive ボタン → `ConfirmDialog` → `deleteSong`。**409 CONFLICT を捕捉して「履歴があるため削除できません」** を error-block/トーストで表示。
- 対象基準: 2（全属性・ジャンル複数・needs_review 解除）、3（削除409）、7、8。

### Task 5 — 設定 `/settings`
- `src/app/(main)/settings/page.tsx` を実画面に（`SettingsScreen` を `src/components/master/settings-screen.tsx` に）。
- `src/lib/settings-meta.ts` を新設: 各編集項目の {key or 親key+path, group(除外・減点/意図の重み/繰り返し減点/抽選/候補数), label(日本語表示名), desc(説明・既定値), type(number|boolean), min/max/step, default} を **SETTING_SEEDS（discovery Provisional Values）から転記**。これが表示名・説明・グループの UI 側唯一の情報源。
- エンジン設定: グループ見出し＋説明＋各項目（数値=NumberField / boolean=Toggle）＋グループ単位「既定値に戻す」。項目過多対策で「繰り返し減点／抽選／候補数」等は折りたたみ（collapse）。
- 変更は **PUT /api/settings で即時保存**（onBlur/確定時）→ 成功トースト「保存しました（次回の推薦から有効）」。範囲外は input min/max ＋ API zod で防止。ネスト葉は親オブジェクトへマージして PUT。`long_unplayed_days` は handoff の「実装未使用」注記を desc に添える。
- 楽器マスター: 一覧チップ＋（コード・表示名）入力→`createInstrument`（code 重複409 トースト）。
- 母店設定: venues 一覧を Toggle(母店/母店以外)→`updateVenue({isHome})`。
- データ管理: 「全データをエクスポート」→`downloadExport()`、「CSVインポート →」→ `/settings/import`。Primary は置かない（design_rule §9・ワイヤーフレーム指示）。
- 対象基準: 4（engine.* 変更保存・既定値に戻す）、6（エクスポートDL）、7、8。

### Task 6 — CSVインポートウィザード `/settings/import`
- `src/app/(main)/settings/import/page.tsx`（`ImportWizard` を `src/components/master/import-wizard.tsx` に・4ステップ state machine）。
- **Step1 アップロード**: type Segment(曲マスター/セットリスト履歴)＋file 選択→`uploadImport`→PREVIEW 応答を state＋sessionStorage 保存→Step2。上部に「中断中のインポート」を sessionStorage から列挙し「再開」。
- **Step2 プレビュー**: 総行/有効/エラー件数サマリ＋バッジ。エラー行テーブル（行/理由/元データ・overflow-x-auto）。**setlists のみ**: 未知店舗の母店区分（Toggle）・曲名不一致解決（Segment: 候補に一致/新規スタブ作成/スキップ・近似候補表示・未解決件数バッジ・「未解決をすべてスタブ作成」一括）。→ `saveResolutions` 後「ドライラン実行」で Step3。「戻る」可。
- **Step3 ドライラン**: `fetchDryRun` の差分サマリをテーブル表示（新規曲/更新/新規店舗/新規セッション/演奏記録/スキップ/スタブ・unresolvedVenues>0・duplicateSessions>0 は警告）。「戻る」で Step2 の解決修正、「コミットへ」で Step4。
- **Step4 コミット/結果**: `recalcHasPlayed` チェック→`commitImport`→結果サマリ（hasPlayedRecalculated 含む）を success カードで表示。「破棄」=`ConfirmDialog`→`discardImport`→sessionStorage 破棄→Step1。409（既に COMMITTED/DISCARDED）はトースト。
- 対象基準: 5（4段階＋全分岐）、7、8。

### Task 7 — DOM テスト（fetch モックで全分岐）
- 基盤: `tests/components/helpers/{mock-fetch(installFetch/bodyOf), render(renderWithSWR)}` と next/navigation モックを踏襲。新規 dom テストを `tests/components/` に追加。
- 一覧（`song-list.test.tsx`）: 検索 debounce で q 付き GET、各フィルタ（needsReview/hasPlayed/黒本1 client/season/genre）適用、needs_review バナー件数＋ショートカット遷移。
- 編集（`song-edit.test.tsx`）: 新規 POST（全属性・ジャンル複数）／既存 PATCH／needsReview 解除送信／**削除 409 でメッセージ表示**／「保存して次の未整備曲へ」遷移。
- 設定（`settings.test.tsx`）: engine.* 値変更で PUT ボディ検証、「既定値に戻す」で seed 既定を PUT、楽器追加 POST、母店 Toggle PATCH、エクスポートDL 経路、ネスト葉マージ PUT。
- ウィザード（`import-wizard.test.tsx`）: **全分岐** — アップロード201→エラー行表示→店舗区分確定→曲名解決(match/stub/skip・一括)→resolutions POST→dry-run 差分→commit(recalcHasPlayed)結果／破棄 DELETE／再開（sessionStorage）／PREVIEW以外409。
- 対象基準: 1・2・3・4・5・6（全機能の自動テスト）。
- 完了ゲート: `npm run lint` / `npm run typecheck` / `npm run test` が緑。

## リスクと緩和
1. **再開の read API 欠如**（GET jobs 一覧/単体が unit-08 に無い）→ sessionStorage 永続で同一ブラウザ再開を実現。別端末再開は unit-08 followup（GET /api/import/jobs 追加）として明記。
2. **ios-slider が engine.* に不適合**（-2..2 固定）→ 数値入力採用（ワイヤーフレームと整合）。スライダー要件は解消。
3. **黒本1 フィルタの API パラメータ不在** → クライアント側 inKurobon1 フィルタ（数百件で軽量）。
4. **ネスト JSON 設定の複雑さ** → settings-meta の親key＋path で葉編集・親オブジェクトへマージして PUT。非数値 season_months は読み取り専用。
5. **multipart と apiFetch の Content-Type 競合** → FormData 検出で JSON ヘッダを付けない分岐＋専用 uploadImport。
6. **設定20項目超で迷子**（spec Risk）→ グループ化＋説明＋既定値表示＋折りたたみ＋グループ単位リセット。
7. **PC 1024px** → max-w-lg シェル維持＋overflow-x-auto＋lg+ フルブリード。criterion 7=崩れない を満たす。