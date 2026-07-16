---
status: pending
last_updated: ""
depends_on: []
branch: ai-dlc/stats-page-refinement/01-stats-page-refinement
discipline: fullstack
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: ["/stats"]
---

# unit-01-stats-page-refinement

## Description
統計ページ（`/stats`）の曲別セクションを再設計するフルスタックユニット。API 集計（`stats.ts`）・レスポンス型/契約（`types.ts`・`client.ts`・`hooks.ts`・`validation/stats.ts`）・画面（`stats-screen.tsx`）を一括で改修する。`lastPlayedDate` の削除がサーバ集計・型・唯一の消費者（画面）をアトミックに変更する必要があるため1ユニットに統合。分布・傾向・月別セクション、統計以外の機能、推薦エンジン（`src/engine`）、`aggregate.ts` は変更しない。

## Discipline
fullstack - API 層（Drizzle SQL / zod / route）と frontend（React コンポーネント）の両方を一括実装する。general-purpose エージェントが担当。

## Domain Entities
- **StatsSongStat（レスポンス型）**: `appearanceCount` 追加、`lastPlayedDate` 削除。
- **Performance / Session**: 集計元（`callCount`=called_by_me、`playCount`=participated、`appearanceCount`=全登場、最終演奏日=participated の max session_date）。
- スキーマ変更なし。

## Data Sources
- `src/server/repositories/stats.ts` の `getStats` / `songRows` クエリ（performances INNER JOIN sessions/venues/songs、`groupBy(songId)`）。
- `src/server/validation/stats.ts` の `statsQuerySchema`。
- `src/app/api/stats/route.ts`（`GET /api/stats`、`withErrorHandling`）。
- `src/lib/api/types.ts`（`StatsResponse` / `StatsSongStat`）、`src/lib/api/client.ts`（`fetchStats` / `buildStatsQuery` / `StatsQueryParams`）、`src/lib/api/hooks.ts`（`useStats` / `SWR_KEYS.stats`）。
- `src/components/stats/stats-screen.tsx`（曲別セクション・フィルタUI）。

## Technical Specification

### API / 契約
1. **`appearanceCount` 追加**: `songRows` select に `count(*)`（フィルタ後の全登場回数）を `appearanceCount` として追加。`StatsSongStat` 型に `appearanceCount: number` を追加。`songStats` map に反映。
2. **`lastPlayedDate` 削除**: `StatsSongStat` から `lastPlayedDate` を削除し、`songRows` の select・`songStats` map からも除去。ただし `max(case when participated=1 then session_date end)` の式は **HAVING 用に SQL 内部で保持**（要件4）。
3. **`lastPlayedBefore` フィルタ**: `statsQuerySchema` に `lastPlayedBefore`（`dateSchema`、任意）を追加。指定時、`songRows` に `HAVING max(case when participated=1 then session_date end) <= :lastPlayedBefore` を付与。未演奏曲（式が NULL）は HAVING 比較で自動除外される。**この HAVING は曲別 `songRows` クエリのみに適用**し、分布/傾向/月別クエリには影響させない。
4. **クライアント契約**: `StatsQueryParams` / `buildStatsQuery`（client.ts）に `lastPlayedBefore` を追加（未指定時は URL に載せない）。`SWR_KEYS.stats`（hooks.ts）のキーに含めてフィルタ変更で再フェッチ。
5. サーバ既定ソート `callCount DESC`（初期/タイブレーク）は維持。サーバに新規ソート引数は追加しない。

### 画面（stats-screen.tsx）
6. **要件1**: `rareSongIds` の useMemo・凡例バッジ・行内「久しぶり」バッジを削除。Section 説明文から該当語を除去。
7. **要件2**: 最終演奏日の列ヘッダ・セルを削除。
8. **要件3**: 曲別テーブルに 3 列（コール回数 / 演奏回数 / 登場回数）を表示。各列ヘッダをクリックで降順ソート（クライアント側、既定=コール回数 降順）。どの指標でソート中かを視覚表示。`playCount===0` の行に未演奏バッジを付ける。
9. **要件4**: venue/season フィルタと並べて「最終演奏日」閾値セレクト（なし/3ヶ月/半年/1年/2年）を追加。選択値からクライアントで cutoff 日付（今日から遡った YYYY-MM-DD）を計算し `lastPlayedBefore` として送る。「なし」時は未指定。
10. design_rule 準拠（単一 Primary・h-10・focus-visible・コントラスト・モバイル・トークンのみ・raw hex 禁止・ダークモード対応）。

### テスト
11. `tests/api/stats.test.ts`: `lastPlayedDate` 期待を除去し `appearanceCount` を検証。`lastPlayedBefore` フィルタ（閾値以上前の曲のみ・未演奏除外）を検証。既存の分布/傾向/月別の assert は不変で通ること。
12. `tests/components/stats-screen.test.tsx`: 久しぶりバッジ関連の assert を除去。3指標列の表示・降順ソート（クリックで並び替わる）・未演奏バッジ・閾値フィルタが `lastPlayedBefore` クエリを送ることを検証。mock の `StatsSongStat` を新形（appearanceCount 追加・lastPlayedDate 削除）に更新。

## Success Criteria
- [ ] `StatsSongStat` に `appearanceCount` があり `lastPlayedDate` が無い（型・レスポンス・stats.test.ts で検証）
- [ ] 曲別テーブルに 久しぶりバッジ・最終演奏日列が無い
- [ ] コール回数/演奏回数/登場回数 の3列が表示され、各列で降順ソートできる（既定=コール回数降順）
- [ ] `playCount===0` の曲に未演奏バッジが付き、登場実績のある曲が全て表示される
- [ ] `lastPlayedBefore` フィルタ（なし/3ヶ月/半年/1年/2年）が該当曲に絞り、未演奏曲を除外する（HAVING、曲別クエリのみ）。UI 選択でクエリ送信・再フェッチされる
- [ ] 分布/傾向/月別セクションと統計以外に回帰が無い（既存テスト更新のうえ全通過）
- [ ] typecheck / lint / test / build がパスし、docs/design_rule.md に準拠する

## Risks
- **HAVING の適用範囲誤り**: 閾値フィルタを分布/傾向/月別にも掛けると意図しない絞り込みになる。Mitigation: HAVING は `songRows`（曲別）クエリだけに付与し、他クエリは不変。テストで分布/傾向が閾値フィルタの影響を受けないことを確認。
- **lastPlayedDate 削除の取りこぼし**: 型から消しても画面/テストに参照が残るとコンパイル/テスト失敗。Mitigation: 型・select・map・画面・テストを同一ユニットで一括変更（1ユニットに統合した理由）。
- **クライアントソートの安定性**: 同値時の順序ブレ。Mitigation: サーバ既定 `callCount DESC` をタイブレークに、ソートは安定ソートで実装。
- **cutoff 日付計算の境界**: 「なし」と閾値の切替、月/年の遡り計算。Mitigation: 「なし」は未指定、閾値は明確な日数/年で計算しテスト。

## Boundaries
分布・傾向・月別セクションのロジック/表示は変更しない。`aggregate.ts`（推薦専用集計）・`src/engine`・DBスキーマ・マイグレーション・統計以外の画面/API は触らない。venue/season フィルタの既存挙動は維持（閾値フィルタを追加するのみ）。

## Notes
- サーバは全件返却＋既定 callCount DESC のまま、3指標ソートはクライアント側で行う（新規ソートAPIは作らない）。
- 「最終演奏日」= participated の max session_date（[stats.ts:106](src/server/repositories/stats.ts#L106) の式）。この定義は不変で、表示はやめるがフィルタ判定に使う。
- 閾値プリセットの cutoff 計算はクライアントで行い、サーバは受け取った日付で HAVING するだけ（サーバを最小限に保つ）。
