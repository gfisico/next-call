# Tactical Plan — unit-04 (backend) 統計集計 API（要件6 バックエンド）

Bolt: 1 / Discipline: backend / Branch: `ai-dlc/next-call-enhancements/04-stats-api`
Worktree: `.../next-call-enhancements-04-stats-api`（`npm ci` 済み・node_modules 復旧済み）

読み取り専用機能。スキーマ変更なし（migration 追加なし）。unit-01/02/03 マージ済み前提。

---

## 0. 現状確認（実コードに基づく）

- 既存集計は `src/server/recommendation/build-input.ts` L117–189 に閉じている。
  - L119–143: **単一 GROUP BY** で曲別 `appearanceCount`（店舗区分別 `is_home = X` × 期間 `session_date >= windowStart` の CASE 条件付き）/ `lastPlayedDate`（participated のみの max）/ `myPlayCount`（participated 合計・期間無制限）/ `myCallCount`（called_by_me 合計・期間無制限）。
  - L144–154: 統計に現れない曲を `{0, null, 0, 0}` でゼロ埋め。
  - L167–189: ジャンル別コール比率（推薦専用の比率計算）。
- 呼び出し元は `src/server/recommendation/service.ts` L153 の 1 箇所のみ（`buildEngineInput`）。
- ガードするテスト: `tests/api/recommendation-input.test.ts`（`appearanceCount` の店舗区分/期間、`daysSinceLastPlayed`、`myPlayCount`/`myCallCount`、ゼロ埋め `{0,null,0,0}` を厳密検証）。**このテストは一切変更しない**。
- API 規約（unit-03 確立・従うこと）: 全 Route は `withErrorHandling`（`src/server/http/handler.ts`）で包む。エラーは `src/server/http/errors.ts` の `apiError`/`ApiError` のみ。GET クエリは `Object.fromEntries(new URL(req.url).searchParams)` → zod `.parse()`（`src/app/api/songs/route.ts` パターン）。DTO は camelCase。
- リポジトリ規約: `src/server/repositories/*` に業務ロジック、drizzle 同期 API（`.all()/.get()/.run()`）、`DbOrTx` 引数で `getDb()` 既定（`songs.ts` パターン）。
- 型: 読み取り契約は `src/lib/api/types.ts`（unit-05 が import する SSOT）。
- 季節導出: `src/server/recommendation/season.ts` の `seasonForDate(date, seasonMonths)` と `DEFAULT_SEASON_MONTHS`（SPRING 3-5 / SUMMER 6-8 / AUTUMN 9-11 / WINTER 12,1,2、`settings.engine.season_months` で上書き可）。JST・文字列パース。**再利用する。**
- テスト基盤: `tests/api/helpers.ts`（`setupTestDb`/`teardownTestDb`/`testDb`/`getRequest`/`routeParams`/`expectApiError`）。Route を直接 import して呼ぶ方式。perf 例は `tests/api/recommendations-performance.test.ts`（500曲/5000演奏を決定的一括 INSERT → warmup+20回 → p95）。

---

## 1. タスクチェックリスト（Success Criteria への写像）

- [ ] **T1 リファクタ**: build-input.ts L119–154 の曲別集計を純粋関数へ抽出。推薦は同関数を呼ぶだけにし挙動不変。 → 基準1「build-input 集計が汎用関数として抽出・推薦既存テスト不変で全パス」
- [ ] **T2 stats リポジトリ**: `src/server/repositories/stats.ts` に指標別クエリ（曲別/分布/傾向/月別）を新設、フィルタ引数対応。 → 基準2
- [ ] **T3 フィルタ**: venue（id/home/non_home/all）・season・from/to を全クエリに一貫適用。 → 基準3
- [ ] **T4 バリデーション**: `src/server/validation/stats.ts` に `statsQuerySchema`。 → 基準2/3
- [ ] **T5 API ルート**: `GET /api/stats`（`src/app/api/stats/route.ts`）。 → 基準2
- [ ] **T6 レスポンス型**: `src/lib/api/types.ts` に統計 DTO 追記（unit-05 共有）。 → 基準2/4（型共有）
- [ ] **T7 性能**: 全指標 SQL GROUP BY・N+1 なし（数クエリで完結）。 → 基準4（p95<1s）
- [ ] **T8 テスト**: `tests/api/stats.test.ts`（集計値・フィルタ反映・月別）＋任意の perf smoke。 → 基準5
- [ ] **T9 ゲート**: typecheck / lint / test / build 全パス。 → 基準5

---

## 2. リファクタ方針（T1・最重要リスク管理）

**原則: 純粋リファクタに留め、推薦側の呼び出し結果を 1 ビットも変えない。`recommendation-input.test.ts` が回帰の唯一の担保。**

- 新規 `src/server/stats/aggregate.ts`（両者が import する中立な集計ユーティリティ）に抽出:
  ```
  aggregatePerSongStats(dbx, {
    songIds: number[],            // ゼロ埋め対象（engineSongs.map(id)）
    isHome: boolean,              // 店舗区分（appearanceCount の CASE 条件）
    windowStart: string,          // appearanceCount の期間下限
    asOfDate: string,             // daysSinceLastPlayed の基準日（= session.sessionDate）
  }): Record<number, SongStats>
  ```
  - 中身は build-input.ts L119–154 を **逐語移設**（同一 SQL・同一ゼロ埋め・同一 `daysBetween` clamp `Math.max(...,0)`）。`SongStats` 型は `@/engine/types` から。
  - `dateDaysBefore`/`daysBetween`（build-input L41–52）も同モジュールへ移し、build-input からは再エクスポート or import して既存内部利用を維持（他に使っていないか grep 済み: build-input 内のみ）。
- build-input.ts は該当ブロックを `aggregatePerSongStats(dbx, { songIds: engineSongs.map(s=>s.id), isHome, windowStart, asOfDate: session.sessionDate })` の 1 呼び出しに置換。ジャンル比率（L167–189）は**推薦専用ロジックのため抽出しない**（統計の分布とは意味が異なる＝結合させない）。
- 配置理由: `src/server/stats/` を新設し recommendation がそこを import する形（recommendation → stats util）。逆（stats → recommendation）にすると統計が推薦の as-of/店舗区分意味論に縛られるため避ける。`aggregate.ts` は「画面」ではなく汎用集計 util と位置づける。
- **検証**: リファクタ直後に `npm run test -- recommendation-input` を回して緑を確認してから T2 以降へ進む。

### 統計側とのコード共有の線引き（重要な設計判断）
推薦の `aggregatePerSongStats` は「現在セッション基準・店舗区分別・期間付き appearanceCount」という推薦固有の意味論を持つ。統計画面が要るのは「フィルタ可能な素のコール/演奏/最終演奏日」。両者は**同じ GROUP BY 骨格だが条件が別**。そこで:
- 共有するのは SQL 骨格を作る小さな述語ヘルパ（`aggregate.ts` 内に `venueFilter()/dateRangeFilter()/seasonMonthFilter()` を置く）。
- 推薦の `aggregatePerSongStats` は無改変で温存。統計の曲別集計は stats.ts が独自に組む（下記 3-A）。これで推薦回帰リスクをゼロに保ちつつ「集計ロジックの汎用化」を満たす（骨格＋述語を共有）。

---

## 3. 統計クエリ設計（T2/T3/T7）— すべて SQL GROUP BY・N+1 なし

共通フィルタ（`performances p JOIN sessions se ON p.session_id=se.id JOIN venues v ON se.venue_id=v.id` に対して WHERE を合成。drizzle `SQL[]` を `and(...)`、`songs.ts` の条件配列パターン）:
- **venue**: `all`→条件なし / `home`→`eq(venues.isHome, true)` / `non_home`→`eq(venues.isHome, false)` / `<id>`→`eq(sessions.venueId, id)`
- **season**（`ALL` 以外）: `settings` から `engine.season_months` を読み `DEFAULT_SEASON_MONTHS` フォールバックで当該季節の月配列を解決 → `inArray(sql\`cast(substr(${sessions.sessionDate},6,2) as integer)\`, months)`。JST 月境界（discovery 決定事項）。`songs.season` は使わない。
- **from/to**: `sessions.sessionDate >= from` / `<= to`（ISO 文字列の辞書順比較で可）。任意。

### 3-A 曲別（SongStat[]）
```
SELECT p.song_id, s.title,
  sum(case when p.called_by_me then 1 else 0 end) AS callCount,
  sum(case when p.participated then 1 else 0 end) AS playCount,
  max(case when p.participated then se.session_date end) AS lastPlayedDate
FROM performances p JOIN sessions se ... JOIN venues v ... JOIN songs s ON s.id=p.song_id
WHERE <filters>
GROUP BY p.song_id, s.title
```
フィルタ下で 1 度でも登場した曲のみ返す（未登場曲は含めない）。配列で返し、既定ソートは callCount DESC, song_id ASC（決定的）。UI 側で並べ替え可能。

### 3-B 分布（distributions）— フィルタ下の**演奏件数**カウント
- byGenre: `p JOIN sessions/venues + JOIN song_genre_tags sgt ON sgt.song_id=p.song_id JOIN genre_tags g` → `GROUP BY g.name`（1曲複数ジャンルは各ジャンルで加算）。
- byKey: `... JOIN songs s` → `GROUP BY s.song_key`（null は `"(未設定)"` バケットへ app 側で正規化 or SQL `coalesce`）。
- byForm: `GROUP BY s.form`（4 値固定）。
各 `{ key: string, count: number }[]`。

### 3-C 傾向（trends）
- byVenue: `GROUP BY sessions.venue_id` + venue 名（同 join）。`{ venueId, venueName, count }[]`。
- byHome: `GROUP BY venues.is_home`（2 行）→ `{ home, nonHome }` へ整形。
- bySeason: `GROUP BY cast(substr(session_date,6,2) as int)`（月・最大12行）→ app 側で `seasonForDate` 相当のマップで 4 季節へ畳み込み。`{ season: Season, count }[]`（SPRING/SUMMER/AUTUMN/WINTER）。

### 3-D 月別推移（monthly: MonthlyPoint[]）
CTE ベース単一クエリ（サブクエリ可、N+1 不可）:
```
WITH filtered AS (SELECT p.song_id, se.session_date FROM ... WHERE <filters>),
     firstSeen AS (SELECT song_id, min(session_date) AS first FROM filtered GROUP BY song_id)
SELECT substr(f.session_date,1,7) AS month,
       count(*) AS plays,
       count(DISTINCT f.song_id) AS distinctSongs,
       count(DISTINCT case when substr(fs.first,1,7)=substr(f.session_date,1,7) then f.song_id end) AS newSongs
FROM filtered f JOIN firstSeen fs ON fs.song_id=f.song_id
GROUP BY month ORDER BY month
```
- `songsPlayed` = distinctSongs（その月の演奏曲数）。
- `newSongRate` = newSongs / distinctSongs（0 除算は 0）。**初登場は「フィルタ後集合内での初出」**で自己整合（要件文「その月に初登場」）。← ビルダー確認事項として明記。
- `diversity` = distinctSongs / plays（0–1、高いほど多様＝反復が少ない）。0 除算は 0。← 指標定義は暫定。ビルダーが要件6の意図に照らし確定（代替: distinctGenres）。

---

## 4. レスポンス型（T6）— `src/lib/api/types.ts` 末尾に統計セクション追記（unit-05 が import）
```ts
export interface StatsSongStat { songId: number; title: string; callCount: number; playCount: number; lastPlayedDate: string | null; }
export interface StatsBucket { key: string; count: number; }           // genre名/key/form
export interface StatsDistributions { byGenre: StatsBucket[]; byKey: StatsBucket[]; byForm: StatsBucket[]; }
export interface StatsVenueTrend { venueId: number; venueName: string; count: number; }
export interface StatsSeasonTrend { season: Season; count: number; }
export interface StatsTrends { bySeason: StatsSeasonTrend[]; byVenue: StatsVenueTrend[]; byHome: { home: number; nonHome: number }; }
export interface StatsMonthlyPoint { month: string; songsPlayed: number; newSongRate: number; diversity: number; }
export interface StatsResponse { songs: StatsSongStat[]; distributions: StatsDistributions; trends: StatsTrends; monthly: StatsMonthlyPoint[]; }
```
`Season` は同ファイル既存型を再利用。エンベロープ: `GET /api/stats` は `StatsResponse` を **トップレベルで直接返す**（memo-preview と同じくエンベロープ無し方針）。unit-05 は `StatsResponse` を import。→ ビルダーはこの shape を厳守（unit-05 との齟齬防止）。

`statsQuerySchema`（`src/server/validation/stats.ts`）:
```ts
venue: z.union([z.enum(["home","non_home","all"]), 数値id文字列]).default("all")
season: seasonSchema.optional()  // 既存 seasonSchema 再利用。未指定/ALL は全期間
from: /^\d{4}-\d{2}-\d{2}$/.optional()  to: 同上
```
（`common.ts`・`songs.ts` の zod 流儀を踏襲。`venue` は `all|home|non_home` 以外は正の整数へ coerce。）

---

## 5. 作成/変更ファイル一覧
新規:
- `src/server/stats/aggregate.ts`（抽出した `aggregatePerSongStats` + 日付/フィルタ述語ヘルパ）
- `src/server/repositories/stats.ts`（曲別/分布/傾向/月別クエリ・フィルタ引数・`getStats(filter, dbx=getDb())`）
- `src/server/validation/stats.ts`（`statsQuerySchema`）
- `src/app/api/stats/route.ts`（`GET`・`dynamic="force-dynamic"`）
- `tests/api/stats.test.ts`（＋任意 perf smoke）

変更:
- `src/server/recommendation/build-input.ts`（集計ブロックを `aggregatePerSongStats` 呼び出しへ置換・日付ヘルパ移設）
- `src/lib/api/types.ts`（統計 DTO 追記）

**編集しない**: `src/engine/*`（エンジンコア不変）、`session-record-screen.tsx`、`recommendation-input.test.ts`、既存 migration。

---

## 6. テスト計画（T8）
- 回帰ガード: `recommendation-input.test.ts` を無改変で緑（T1 直後に単体実行し確認）。
- `tests/api/stats.test.ts`（helpers の Route 直接呼び出し方式・`getRequest`/`routeParams`）:
  1. 曲別: called/participated を混在させ callCount/playCount/lastPlayedDate を検証（participated のみが lastPlayed に効く）。
  2. venue フィルタ: home/non_home/id で集計が変わる（某店 is_home=true と別店で切替）。
  3. season フィルタ: 月境界で SUMMER セッションのみ集計されること（`engine.season_months` 既定）。
  4. from/to: 期間外セッションが除外される。
  5. 分布: byGenre（複数ジャンル曲が各ジャンルで加算）/byKey（null→未設定）/byForm。
  6. 傾向: byVenue/byHome/bySeason の畳み込み。
  7. 月別: newSongRate（初出月のみ新曲）・diversity・songsPlayed。
  8. バリデーション: 不正 venue/日付は 400 VALIDATION_ERROR（`expectApiError`）。
- perf smoke（任意・基準4）: `recommendations-performance.test.ts` の決定的シード（~500曲/数千演奏）を流用し `GET /api/stats` が完了する（timing 断言はフレーク回避で緩め or 実行時間ログのみ）。
- ゲート: `npm run typecheck && npm run lint && npm run test && npm run build`。

---

## 7. リスク / 前提
- **推薦回帰（最大）**: 抽出を逐語移設に限定・ジャンル比率は抽出対象外・`recommendation-input.test.ts` 無改変で担保。緑を確認してから統計実装へ。
- **season 意味論**: 「季節」はセッション日付の月境界（JST・`engine.season_months`）で判定＝`songs.season` ではない（discovery 決定事項）。ビルダーはこの前提を守る。
- **newSongRate / diversity の定義**: 要件文が定性的。本プランは newSongRate=フィルタ集合内初出割合、diversity=distinctSongs/plays を提案。ビルダーが要件6の意図で最終確定（代替案も併記済み）。
- **性能とインデックス**: スキーマ変更不可（読み取り専用ユニット）。`sessions.session_date` 無索引だが数千行なら table scan で p95<1s 想定。`idx_performances_song`/`idx_performances_session` は既存。indexが要るなら別ユニット/後続で additive 対応。
- **エンベロープ**: `StatsResponse` をトップレベル直返し（unit-05 と型共有・memo-preview 先例）。ビルダーは shape を型定義に厳密一致させる。
- **前提**: unit-01/02/03 マージ済み・`session_participants`/`sessions` 追加列は本ユニットの集計に不要（現決定の指標は参加者を使わない）。
