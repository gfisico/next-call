# Plan — unit-05-stats-screen (frontend, Bolt 1)

要件6のフロント。unit-04 が出荷した `GET /api/stats`（`StatsResponse`）を用いた統計画面 + ボトムナビ導線。**このユニットは表示専任。集計は書かない（unit-04）。**

## 0. Grounding（実コード確認済み）

- **API**: `GET /api/stats`（`src/app/api/stats/route.ts`）は `StatsResponse` を**エンベロープ無しでトップレベル直返し**（`return NextResponse.json(getStats(query))`）。→ クライアントヘルパは `.then(b => b.x)` の剥がし不要。
- **クエリスキーマ**（`src/server/validation/stats.ts`）: `venue`（`"all"|"home"|"non_home"|正の整数id`、既定 `all`）/ `season`（`SPRING|SUMMER|AUTUMN|WINTER|ALL`、任意・未指定/ALL=全期間）/ `from` `to`（`YYYY-MM-DD`、任意）。すべて任意。
- **DTO**（`src/lib/api/types.ts` L559-624、SSOT）:
  - `StatsSongStat { songId, title, callCount, playCount, lastPlayedDate: string|null }`（既定ソート callCount DESC, songId ASC）
  - `StatsDistributions { byGenre, byKey, byForm: StatsBucket[] }`、`StatsBucket { key, count }`（null キーは "(未設定)" 正規化済み）
  - `StatsTrends { bySeason: StatsSeasonTrend[], byVenue: StatsVenueTrend[], byHome: { home, nonHome } }`（`StatsSeasonTrend { season, count }`、`StatsVenueTrend { venueId, venueName, count }`）
  - `StatsMonthlyPoint { month: "YYYY-MM", songsPlayed, newSongRate(0-1), diversity(0-1) }`
  - `StatsResponse { songs, distributions, trends, monthly }`
- **client 規約**（`src/lib/api/client.ts`）: 読み取りは `fetchX` 命名（`fetchVenues`/`fetchSessions`）、クエリ組み立ては `buildSongsQuery` パターン。全 fetch はここ集約（criterion 5 のモックを容易化）。
- **SWR フック**（`src/lib/api/hooks.ts`）: `useSWR<T>(key, fetcher)`、`SWR_KEYS`、`useSongs` はクエリ直列化文字列を key にして `keepPreviousData: true`（フィルタ変更で自動再取得）。`useVenues()` あり（フィルタの店リスト取得に流用）。
- **layout**（`src/app/(main)/layout.tsx`）: `max-w-lg` モバイル shell、`<main class="… px-4 py-6 pb-20">`、ページ本体は `.tsx` から screen コンポーネントへ委譲（`songs/page.tsx` → `<SongListScreen />`）。
- **既存 UI 部品**（`src/components/ui/`）: `table.tsx`, `card.tsx`, `select.tsx`(radix), `badge.tsx`, `button.tsx`。`Segment`（radiogroup, `src/components/session/segment.tsx`）は import して流用可（session screen 本体ではないので Boundary 違反にならない）。
- **bottom-nav**（`src/components/shell/bottom-nav.tsx`）: 現状 4 項目（`/` セッション / `/suggest` 推薦 / `/songs` マスター / `/settings` 設定）。テキストのみ、アイコン無し、`flex-1` 等幅、`h-14`。design_rule に nav 項目上限の明記なし。
- **テストハーネス**（`tests/components/helpers/`）: `installFetch(routeHandler)` で `global.fetch` を差し替え（`vi.fn` 呼び出し履歴を返す）、`renderWithSWR(ui)`（毎回まっさら Map キャッシュ）、`bodyOf` で POST ボディ検証。route ハンドラは `{ method, path, search, body }` を受ける。参考: `tests/components/recommend-screen.test.tsx`。

## 1. タスクチェックリスト（Success Criteria 対応）

- [ ] **T1 client ヘルパ** `buildStatsQuery` + `fetchStats` を `client.ts` に追加 — 全 criteria の土台 / criterion 2, 5
- [ ] **T2 SWR フック** `useStats(params)` を `hooks.ts` に追加（`SWR_KEYS.stats` 追加、`keepPreviousData`）— criterion 2, 4
- [ ] **T3 ページ** `src/app/(main)/stats/page.tsx`（`<StatsScreen />` へ委譲）— criterion 1, 3
- [ ] **T4 画面本体** `src/components/stats/stats-screen.tsx`（フィルタ state + `useStats` + `useVenues` + 4 セクション + 空/読込/エラー）— criterion 1, 2, 4
- [ ] **T5 バー表示部品** `src/components/stats/stat-bar-list.tsx`（分布/傾向の共通横バー）— criterion 1, 5
- [ ] **T6 ナビ導線** `bottom-nav.tsx` に `/stats`「統計」を追加 — criterion 3
- [ ] **T7 テスト** `tests/components/stats-screen.test.tsx`（フィルタ→API 再取得のクエリ検証・各セクション描画・空/エラー）+ nav に統計リンク存在 — criterion 全て
- [ ] **T8 品質ゲート** typecheck / lint / test / build パス — criterion 5

## 2. 追加/変更ファイル

| ファイル | 種別 | 内容 |
|---|---|---|
| `src/lib/api/client.ts` | 変更 | `StatsResponse`, `Season` を import。`StatsQueryParams`, `buildStatsQuery`, `fetchStats` 追加 |
| `src/lib/api/hooks.ts` | 変更 | `SWR_KEYS.stats(params)` 追加、`useStats(params)` フック追加 |
| `src/app/(main)/stats/page.tsx` | 新規 | `<StatsScreen />` 委譲のみ |
| `src/components/stats/stats-screen.tsx` | 新規 | フィルタ + 4 セクション + 状態表示（"use client"） |
| `src/components/stats/stat-bar-list.tsx` | 新規 | ラベル + 横バー + 件数/割合の共通表示 |
| `src/components/shell/bottom-nav.tsx` | 変更 | NAV_ITEMS に `{ href: "/stats", label: "統計" }` 追加 |
| `tests/components/stats-screen.test.tsx` | 新規 | コンポーネントテスト |

## 3. client ヘルパ signature（決定事項）

```ts
// client.ts — 読み取りヘルパ（envelope 無しなので剥がし不要）
export interface StatsQueryParams {
  venue?: "all" | "home" | "non_home" | number;
  season?: Season;            // "ALL" は全期間扱い → クエリから省略
  from?: string;              // YYYY-MM-DD
  to?: string;
}

/** GET /api/stats のクエリ文字列を組み立てる（既定値 all / ALL は省略しURLをクリーンに保つ） */
export function buildStatsQuery(params: StatsQueryParams = {}): string {
  const p = new URLSearchParams();
  if (params.venue != null && params.venue !== "all") p.set("venue", String(params.venue));
  if (params.season && params.season !== "ALL") p.set("season", params.season);
  if (params.from) p.set("from", params.from);
  if (params.to) p.set("to", params.to);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const fetchStats = (params: StatsQueryParams = {}) =>
  apiFetch<StatsResponse>(`/api/stats${buildStatsQuery(params)}`);
```

**命名判断**: タスクは `getStats(params)` を要求したが、client.ts の読み取りヘルパは一貫して `fetchX`（`fetchVenues`/`fetchSessions`）であり、`getStats` はサーバ側 `src/server/repositories/stats.ts` の関数名と衝突する。**規約優先で `fetchStats` を採用**（機能は同一）。Builder が厳密に `getStats` を要求される場合のみ改名。

```ts
// hooks.ts
SWR_KEYS.stats = (params: StatsQueryParams = {}) => `/api/stats${buildStatsQuery(params)}`;

export function useStats(params: StatsQueryParams = {}) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<StatsResponse>(
    SWR_KEYS.stats(params),
    () => fetchStats(params),
    { keepPreviousData: true },   // フィルタ変更中のちらつき防止（useSongs と同方針）
  );
  return { stats: data ?? null, error, isLoading, isValidating, mutate };
}
```

## 4. セクション別レンダリング（chart/table 選択）

**可視化方針（重要）**: 各バー/行はテキストラベル + 数値を常に併記するため色は非情報（design_rule §8.2 満たす）。**カテゴリ多色パレットは使わず単色トークンバー**（`bg-muted` トラック + `bg-primary` フィル）で統一 → コントラスト/ダークモード問題を回避、raw hex 不要。

1. **曲別（criterion 1）** — `ui/table.tsx` ランキング表。列: 曲名 / コール回数(`callCount`) / 演奏回数(`playCount`) / 最終演奏日(`lastPlayedDate` null は「—」)。API 既定ソート（callCount DESC）をそのまま採用。**「久しぶりの曲」**: `songs.filter(lastPlayedDate != null).sort(date ASC).slice(0, 5)` をクライアント導出し、表上部の小カードまたは該当行に `Badge`（「久しぶり」）で提示。数百件は表 + `overflow-x-auto`（Risk 対応、集計は API 済み）。
2. **分布（criterion 1）** — `StatBarList` を byGenre / byKey / byForm の 3 ブロックで再利用。各バケット: ラベル(`key`) + 横バー(`count / max(count)` 幅) + `count`（%も可）。件数降順。空配列は「データなし」小注記。
3. **傾向（criterion 1）** — bySeason（春夏秋冬ラベルの `StatBarList`）/ byVenue（店名 `StatBarList`）/ byHome（母店 vs 母店以外の 2 バー比較、`{ home, nonHome }`）。
4. **月別推移（criterion 1）** — `month` 昇順の簡易時系列。各月行: songsPlayed（棒）+ newSongRate を `Math.round(rate*100)%` 表示 + diversity（%）。表 + ミニバーで可読性優先（複雑なチャートライブラリは入れない）。

## 5. フィルタ UX + 再取得（criterion 2）

- state: `const [venue, setVenue] = useState<StatsQueryParams["venue"]>("all")`, `const [season, setSeason] = useState<Season>("ALL")`。
- **店フィルタ**: `ui/select.tsx`（radix）。オプション = 全体(all) / 母店(home) / 母店以外(non_home) + `useVenues()` の各店（value=`String(id)`）。value が "home"/"non_home"/"all" 以外なら `Number()` 化して state へ。
- **季節フィルタ**: `Segment`（radiogroup）を流用。options = 全て(ALL) / 春(SPRING) / 夏(SUMMER) / 秋(AUTUMN) / 冬(WINTER)。5 セグメントは `max-w-lg` で収まる（§8.3 h-10 は Segment が担保）。
- **再取得**: `useStats({ venue, season })` の SWR key が `buildStatsQuery` 経由で変化 → 自動 refetch。手動 fetch 不要。`keepPreviousData` で切替中も直近表示維持。

## 6. ナビ配置判断（criterion 3）

- 現状 4 → **5 項目**（セッション / 推薦 / マスター / **統計** / 設定）。`/stats` を **マスターと設定の間**に挿入（データ閲覧系をまとめ、設定を末尾維持）。
- design_rule に nav 上限規定なし。`max-w-lg`(512px) / 5 等分 ≈ 102px/項目、`h-14` タップ域は §8.3 充足。テキストのみ既存規約に合わせアイコン追加はしない（過密回避、Risk「ナビ過密」対応）。「その他」寄せは 5 項目で不要と判断。
- active 判定は既存ロジック（`pathname.startsWith("/stats")`）に自動追従。

## 7. 空 / 読込 / エラー（criterion 4）

- **loading**: `isLoading && !stats`（初回のみ）→ `text-muted-foreground` で「読み込み中…」（既存 suggest ページと同トーン）。フィルタ切替の再取得中は `keepPreviousData` により旧データ表示継続（全画面ローディングにしない）。
- **error**: `error != null` → `text-destructive` メッセージ + 「再読み込み」ボタン（`mutate()`）。Primary は 1 つ（§9）。
- **empty（全体）**: `stats` あり かつ `songs.length===0 && byGenre/Key/Form 全空 && monthly.length===0` → 「該当データがありません」空状態 + フィルタ緩和の案内。
- **empty（セクション個別）**: 各セクションで対象配列が空なら小さな「データなし」注記（セクション見出しは残す）。

## 8. テスト計画（criterion 全て）

`tests/components/stats-screen.test.tsx`（`installFetch` + `renderWithSWR`、recommend-screen.test.tsx を雛形）:
- route ハンドラで `GET /api/venues`（店リスト）と `GET /api/stats`（`search` で分岐可）をモック。`StatsResponse` のモックデータ生成ヘルパを用意。
- **描画**: 曲別表の行（曲名/回数）、分布バーのラベル、傾向、月別が表示されること（`screen.findByText`）。
- **フィルタ→再取得（核心）**: 季節 Segment で「夏」クリック → `fetchMock.mock.calls` のいずれかの URL が `season=SUMMER` を含むこと。店 Select で「母店」→ URL が `venue=home` を含むこと。個別店選択 → `venue=<id>` を含むこと。（`installFetch` の `search` で検証）
- **空状態**: 全空 `StatsResponse` → 「データがありません」表示。
- **エラー**: `/api/stats` を status 500 で返す → エラーメッセージ + 再読み込みボタン表示。
- **ナビ**: `bottom-nav` に「統計」リンク（href `/stats`）が存在すること（既存 nav テストがあれば追記、無ければ本テストか別ファイルで最小確認）。

## 9. リスク / 前提

- **前提**: unit-04 の `StatsResponse` DTO と route は merge 済み（確認済み・エンベロープ無し直返し）。`node_modules` 未インストール → Builder は `npm ci` 後に typecheck/lint/test/build。
- **リスク: ナビ過密** → 5 項目・テキストのみで収まると判断（§6 mitigation）。崩れる場合はラベル短縮で対応、機構は変えない。
- **リスク: チャート色/コントラスト** → 単色トークンバー + テキスト併記でカテゴリ多色を回避（§8.2/§8.4 準拠、dark: 特別対応不要）。
- **リスク: 大量データ表描画** → 集計は API 完結、UI は表 + `overflow-x-auto` のみ。必要なら曲別表を上位 N + 「もっと見る」だが Bolt 1 は全件表描画で十分。
- **Boundary 厳守**: 集計/API 不実装。session-record-screen / header / settings / ダークモード機構（unit-06）に触れない。`Segment` は import 流用のみ（編集しない）。
