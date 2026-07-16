# Tactical Plan — unit-01-stats-page-refinement (Bolt 1)

Fullstack refinement of the `/stats` song section. All edits are atomic in one unit
(removing `lastPlayedDate` breaks server map + screen + tests simultaneously).

Branch: `ai-dlc/stats-page-refinement/01-stats-page-refinement`
Worktree: `.ai-dlc/worktrees/stats-page-refinement-01-stats-page-refinement`
`npm ci` done (node_modules present).

---

## Task checklist → mapped to the 8 unit Success Criteria (SC)

- [ ] **T1 — appearanceCount / lastPlayedDate on the contract** (SC1)
  - `types.ts`: `StatsSongStat` add `appearanceCount: number`, remove `lastPlayedDate`.
  - `stats.ts`: add `appearanceCount: countExpr` to `songRows` select + map; remove
    `lastPlayedDate` from select + map; **keep `lastPlayedExpr` for HAVING only**.
- [ ] **T2 — remove 久しぶり + 最終演奏日 column** (SC2)
  - `stats-screen.tsx`: delete `rareSongIds` useMemo, legend badge, in-row badge,
    最終演奏日 `TableHead` + `TableCell`, and the "久しぶり…" phrase in Section description.
- [ ] **T3 — 3 metric columns + client sort + unplayed badge** (SC3, SC4)
  - Add コール/演奏/登場 columns; clickable descending sort (default callCount desc);
    active-column visual indicator; 未演奏 badge when `playCount === 0`.
- [ ] **T4 — lastPlayedBefore filter (server)** (SC5, SC6 server side)
  - `validation/stats.ts`: add `lastPlayedBefore: dateSchema.optional()`.
  - `stats.ts`: conditional `.having(lastPlayedExpr <= :lastPlayedBefore)` on `songRows` ONLY.
  - `client.ts`: `StatsQueryParams.lastPlayedBefore?` + `buildStatsQuery` emit.
  - `hooks.ts`: no change needed — `SWR_KEYS.stats` already delegates to `buildStatsQuery`
    (confirm only).
- [ ] **T5 — threshold select + JST cutoff (client)** (SC5)
  - Threshold `<select>` (なし/3ヶ月/半年/1年/2年) scoped inside 曲別 Section + caption;
    JST day-based cutoff helper (90/180/365/730); pass `lastPlayedBefore` to `useStats`.
- [ ] **T6 — filter-empty distinct message** (SC5 / S2)
  - When threshold active and `stats.songs.length === 0`, show 「該当する曲がありません」
    instead of the generic 「データがありません」.
- [ ] **T7 — API tests** (SC1, SC5, SC6, SC7)
  - `stats.test.ts`: fix `toEqual` (appearanceCount in, lastPlayedDate out); add
    lastPlayedBefore filter test incl. W3 participated-basis + 未演奏 exclusion; add W1
    asymmetry test (distributions/trends/monthly unchanged by the filter).
- [ ] **T8 — screen tests** (SC2, SC3, SC4, SC5)
  - `stats-screen.test.tsx`: update mock to new shape; drop 久しぶり assert; add 3-column,
    sort-reorder, 未演奏 badge, lastPlayedBefore-query-sent, and S2 empty-message tests.
- [ ] **T9 — quality gates** (SC8): `npm run typecheck && lint && test && build`; design_rule compliance.

> SC7 (perf p95<1s) is covered by the existing 性能スモーク test, which keeps passing
> (only shape changes: `count(*)` already computed for distributions; adding it to
> songRows is O(1) extra per group). Distributions/傾向/月別 sections untouched → no regression.

---

## Files + exact regions + concrete edits

### 1. `src/lib/api/types.ts` (L560-569)
Replace the `lastPlayedDate` field with `appearanceCount`:
```ts
export interface StatsSongStat {
  songId: number;
  title: string;
  /** 自分がコールした回数（called_by_me 合計） */
  callCount: number;
  /** 自分が参加した演奏回数（participated 合計） */
  playCount: number;
  /** フィルタ下の総登場回数（参加有無問わず = count(*)） */
  appearanceCount: number;
}
```
Update the doc comment at L559 ("既定ソート callCount DESC" stays true).

### 2. `src/server/repositories/stats.ts`
- L106: **keep** `lastPlayedExpr` (used only in HAVING now). L107 `countExpr` already exists — reuse.
- L110-125 `songRows`: remove `lastPlayedDate: lastPlayedExpr` from select; add
  `appearanceCount: countExpr`; add conditional HAVING. Build as:
```ts
const songSelect = dbx
  .select({
    songId: performances.songId,
    title: songs.title,
    callCount: callCountExpr,
    playCount: playCountExpr,
    appearanceCount: countExpr,
  })
  .from(performances)
  .innerJoin(sessions, eq(performances.sessionId, sessions.id))
  .innerJoin(venues, eq(sessions.venueId, venues.id))
  .innerJoin(songs, eq(performances.songId, songs.id))
  .where(where)
  .groupBy(performances.songId, songs.title);
const songScoped = filter.lastPlayedBefore
  ? songSelect.having(sql`${lastPlayedExpr} <= ${filter.lastPlayedBefore}`)
  : songSelect;
const songRows = songScoped
  .orderBy(desc(callCountExpr), asc(performances.songId))
  .all();
```
  - `NULL <= date` is not-true → 未演奏曲（participated max NULL）は自動除外（明示 is not null は不要だが可読性のため足しても可）。
  - HAVING は `songRows` だけ。分布/傾向/月別クエリ（L136-269）は一切変更しない（W1）。
- L126-132 map: drop `lastPlayedDate`, add `appearanceCount: r.appearanceCount`.

### 3. `src/server/validation/stats.ts` (L26-32)
Add to `statsQuerySchema`:
```ts
  /** 曲別リストを participated 最終演奏日 <= この日付 に絞る（曲別クエリのみ） */
  lastPlayedBefore: dateSchema.optional(),
```
`dateSchema` (L11) reused. `route.ts` は無変更（`Object.fromEntries(searchParams)` → `parse` で自動的に拾う）。

### 4. `src/lib/api/client.ts` (L323-349)
- `StatsQueryParams` add `lastPlayedBefore?: string;`.
- `buildStatsQuery` after the `to` line: `if (params.lastPlayedBefore) p.set("lastPlayedBefore", params.lastPlayedBefore);`

### 5. `src/lib/api/hooks.ts` (L40-53)
No functional change — `SWR_KEYS.stats(params)` already routes through `buildStatsQuery`,
so adding the param to `buildStatsQuery` propagates to the cache key and triggers refetch.
(Confirm-only; may refresh the L52 comment to mention the threshold.)

### 6. `src/components/stats/stats-screen.tsx`
- L11 import: keep `useMemo` (used by sort), `useState`.
- **Remove** L88-98 `rareSongIds`.
- **State add** (near L82-83):
```ts
type SortKey = "callCount" | "playCount" | "appearanceCount";
const [sortKey, setSortKey] = useState<SortKey>("callCount");
const [threshold, setThreshold] = useState<ThresholdKey>("none");
```
- **useStats param** (L85): `useStats({ venue, season, lastPlayedBefore: cutoffFor(threshold) })`
  where `cutoffFor` returns `undefined` for `"none"`.
- **Section description** (L190): remove 「久しぶりの曲にはバッジを表示します。」 → e.g.
  「コール/演奏/登場回数を比較できます。列見出しで並び替えできます。」
- **Legend badge** L192-199: delete entirely.
- **Threshold control**: render inside the 曲別 `Section`, above the table, as a labeled
  `<select>` using `filterSelectClass` (h-10, focus-visible per design_rule) with a caption
  「この絞り込みは曲別リストのみに適用されます」 (W1). Options: なし/3ヶ月/半年/1年/2年.
- **Empty branch** L200-201: differentiate (S2/T6):
```tsx
{sortedSongs.length === 0 ? (
  <p className="text-xs text-muted-foreground">
    {threshold !== "none" ? "該当する曲がありません" : "データがありません"}
  </p>
) : ( ...table... )}
```
- **Header row** L206-211: replace with 4 headers — 曲名 (left) + 3 sortable metric headers.
  Each metric `TableHead` gets `aria-sort={sortKey===k ? "descending" : "none"}` and contains
  a `<button type="button">` (focus-visible ring, `data-active`), label + ▼ when active,
  `onClick={() => setSortKey(k)}`.
- **Body** L214-236: remove 久しぶり badge span; render title cell + 未演奏 badge when
  `s.playCount === 0`; three metric cells (`callCount` / `playCount` / `appearanceCount`,
  `text-right font-mono tabular-nums`); **remove** the 最終演奏日 cell (L232-234).
- Iterate over `sortedSongs` (see sort design) instead of `stats.songs`.
- `isEmpty` (L108-114): unchanged — it requires *all* sections empty. Under a threshold filter
  only songs empty while distributions remain → falls through to the section-level empty branch,
  so T6/S2 fires there (correct separation from global empty).

### 7. Cutoff helper (module scope in stats-screen.tsx)
```ts
type ThresholdKey = "none" | "3m" | "6m" | "1y" | "2y";
const THRESHOLD_DAYS: Record<Exclude<ThresholdKey, "none">, number> = {
  "3m": 90, "6m": 180, "1y": 365, "2y": 730,
};
const THRESHOLD_OPTIONS: { value: ThresholdKey; label: string }[] = [
  { value: "none", label: "なし" }, { value: "3m", label: "3ヶ月以上前" },
  { value: "6m", label: "半年以上前" }, { value: "1y", label: "1年以上前" },
  { value: "2y", label: "2年以上前" },
];
/** JST の「今日」を YYYY-MM-DD で返す（en-CA は YYYY-MM-DD 形式） */
function jstTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}
/** 閾値 → cutoff 日付（JST今日から day 数だけ遡る・日数ベース）。none は undefined */
function cutoffFor(t: ThresholdKey): string | undefined {
  if (t === "none") return undefined;
  const [y, m, d] = jstTodayYmd().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));   // JST暦日をUTC正午基準の暦日として扱う
  dt.setUTCDate(dt.getUTCDate() - THRESHOLD_DAYS[t]);
  return dt.toISOString().slice(0, 10);
}
```
UTC 演算のみで DST/ローカルTZの揺れを排除。session_date は JST の YYYY-MM-DD 文字列
（`src/db/schema.ts` L9,L142-143 で確認）なので文字列比較 `<=` で日付比較が正しく成立する。

---

## Client sort design
- State `sortKey: SortKey` default `"callCount"`.
- Derived list (useMemo over `stats.songs` + `sortKey`):
```ts
const sortedSongs = useMemo(() => {
  const rows = stats?.songs ?? [];
  return [...rows].sort((a, b) =>
    (b[sortKey] - a[sortKey]) ||          // selected metric DESC
    (b.callCount - a.callCount) ||        // tiebreak: callCount DESC (mirrors server)
    (a.songId - b.songId)                 // final stable tiebreak
  );
}, [stats, sortKey]);
```
- Descending only per requirement; clicking a header sets that metric as `sortKey` (no asc toggle).
- Deterministic total order via callCount-desc then songId-asc tiebreak → stable regardless of
  engine sort stability. Default `sortKey="callCount"` reproduces the server default order.
- Visual indicator: active `TableHead` `aria-sort="descending"` + ▼ glyph + bolded button.

---

## Test plan

### `tests/api/stats.test.ts`
- **Edit existing** L110-136 ("callCount…/lastPlayedDate…"): rename intent to appearanceCount;
  scenario has 3 perfs on the song → `toEqual({ songId, title, callCount:2, playCount:2, appearanceCount:3 })`
  (drop `lastPlayedDate`).
- **New describe "lastPlayedBefore フィルタ"**:
  - **W3 participated 基準**: songA participated on `2025-01-01`, plus a *non-participated*
    appearance on `2026-07-01` (newer). `?lastPlayedBefore=2026-01-01` → participated-max
    (2025-01-01) ≤ cutoff → **songA IS returned** (proves filter keys on participated date,
    not appearance date — if it used the appearance it'd be 2026-07-01 and excluded).
  - songB participated on `2026-06-01` → participated-max > cutoff → **excluded**.
  - songC only non-participated appearances → participated-max NULL → **excluded** (未演奏除外).
  - Assert `stats.songs.map(s=>s.songId)` equals `[songA.id]`.
- **New test — W1 asymmetry (SC6)**: same data as above; call once without filter and once with
  `?lastPlayedBefore=2026-01-01`. Assert `stats.distributions`, `stats.trends`, `stats.monthly`
  are deep-equal between the two calls, while `stats.songs` differ (songB/songC still counted in
  distributions/trends/monthly even though filtered out of the song list).
- Existing distribution/傾向/月別/validation/perf tests unchanged and must still pass.

### `tests/components/stats-screen.test.tsx`
- **Mock update** (L32-51): new `StatsSongStat` shape. Set discriminating values so sort reorders:
  - song1 `{callCount:5, playCount:2, appearanceCount:6}`
  - song2 `{callCount:3, playCount:9, appearanceCount:4}`
  - song3 `{callCount:1, playCount:0, appearanceCount:2}` (drives 未演奏 badge)
  Remove all `lastPlayedDate`.
- **Remove** L103 久しぶり assert.
- **3-column test**: assert headers コール / 演奏 / 登場 present.
- **Sort test**: default (callCount desc) row order = [song1, song2, song3]. Click 演奏 header →
  playCount desc → [song2, song1, song3]. Click 登場 header → appearanceCount desc →
  [song1, song2, song3]. Assert by reading row/title order within the 曲別 table.
- **未演奏 badge test**: assert 未演奏 badge present on song3 row and absent on song1/song2.
- **lastPlayedBefore query test**: select a threshold (e.g. 1年以上前); assert
  `calledWith(fetchMock, "lastPlayedBefore=")` becomes true (and matches `/lastPlayedBefore=\d{4}-\d{2}-\d{2}/`).
- **S2 empty test**: route returns `{ ...STATS, songs: [] }` (distributions non-empty → not global
  empty); select a threshold; assert 「該当する曲がありません」 is shown (not 「データがありません」).
- Existing venue/season refetch, error+reload, bottom-nav, empty-state tests unchanged.

---

## Design_rule compliance (SC8)
- Threshold `<select>` uses `filterSelectClass` (h-10, rounded-lg, focus-visible ring) — matches venue select.
- Sort header buttons: `focus-visible:ring` + `outline-none`; text tokens only, no raw hex.
- 未演奏 badge via existing `Badge` variant (`secondary` neutral, or `warning`); dark-mode covered
  by existing token-based variants (badge.tsx L23-24). Single Primary unaffected.
- No new colors/hex; reuse `bg-primary`, `text-muted-foreground`, `tabular-nums`.

## Risks / assumptions
- **HAVING scope (W1)**: only `songRows` gets `.having(...)`; verified other 6 queries untouched.
  Guarded by the W1 asymmetry test.
- **JST cutoff (W2/S1)**: UTC-only arithmetic on the JST calendar day; string `<=` valid because
  session_date is JST YYYY-MM-DD. Boundary behavior exercised via the API filter test (server side);
  client cutoff value shape asserted by regex in screen test.
- **participated-basis erosion (W3)**: `lastPlayedDate` leaves the DTO but `lastPlayedExpr` stays in
  SQL for HAVING; the W3 test locks the participated-vs-appearance distinction.
- **lastPlayedDate removal fallout**: type/select/map/screen/tests all changed in this one unit →
  no intermediate non-compiling state.
- **Sort stability**: explicit callCount-desc + songId-asc tiebreak → deterministic, engine-independent.
- **Assumption**: `drizzle-orm` query builder supports `.having(sql\`...\`)` after `.groupBy()` and
  before `.orderBy()` (standard drizzle API; validated by typecheck + tests during build).
- **Assumption**: `route.ts` needs no change — `statsQuerySchema.parse` picks up the new optional
  param from the searchParams object automatically.
