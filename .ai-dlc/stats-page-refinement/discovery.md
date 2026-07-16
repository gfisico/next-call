---
intent: stats-page-refinement
created: 2026-07-17
status: active
iterates_on: next-call-enhancements
---

# Discovery Log: 統計ページ改善

Elaboration findings persisted during Phase 2.5 domain discovery.

前 intent: next-call-enhancements（unit-04 stats-api / unit-05 stats-screen）。
関連コード: src/server/stats/aggregate.ts, src/server/repositories/stats.ts,
src/app/api/stats/route.ts, src/lib/api/types.ts (StatsResponse),
src/components/stats/stats-screen.tsx, stat-bar-list.tsx。

---

# Phase 2.5 精読メモ（現行統計コードの実測）

## 前提: 曲別リストを駆動する曲集合（CRITICAL 質問の結論）

- 曲別リストは `getStats`（`src/server/repositories/stats.ts` L110-132）の `songRows` が唯一の源泉。
  クエリは `.from(performances)` → sessions/venues/songs を INNER JOIN → `groupBy(performances.songId, songs.title)`。
  **= フィルタ下で 1 度でも performance 行を持つ曲（登場実績のある曲）だけが載る。** 全曲リストではない。
- 参加有無は集合に無関係。**未演奏(playCount=0)でも「登場」していれば既に載る**（source が performances 存在で駆動されるため）。
  回帰担保テスト: `tests/api/stats.test.ts` L138-149「フィルタ下で 1 度も登場しない曲は songs に含めない」。
- したがって要件（「登場実績のある曲のみ・未演奏も含める」）は **集合レベルでは現状すでに満たされている**。
  曲集合の変更は不要。不足しているのは (a) `appearanceCount` メトリクスの提供、(b) 未演奏バッジ表示、(c) 3指標ソート、(d) 久しぶり閾値フィルタ。
- 注意（誤誘導しやすい点）: `src/server/stats/aggregate.ts` の `aggregatePerSongStats` は
  **推薦専用ユーティリティで、`getStats` からは呼ばれていない**（利用は engine/score.ts・reasons.ts のみ）。
  そこにある `appearanceCount`（店舗区分別×期間付きの CASE 集計）は統計の「登場回数」とは意味が違う。
  統計側の「登場回数」は素の `count(*)`（フィルタ下の performance 行数）で新規に足す。

## `lastPlayedDate` の現状

- `getStats` は `lastPlayedExpr = max(case when participated=1 then session_date end)` を計算し、
  `StatsSongStat.lastPlayedDate`（`src/lib/api/types.ts` L568）としてレスポンスに含めている。
- 現状の唯一の消費者は `stats-screen.tsx` L88-98 の `rareSongIds`（最終演奏日が古い順 上位5件を「久しぶり」判定）
  と L232-234 の「最終演奏日」列表示のみ（`grep` で他消費者なしを確認）。

---

# 要件別: 影響ファイル / 現状 / 変更方針

## 要件1: 「久しぶり」バッジ廃止

- 影響ファイル: `src/components/stats/stats-screen.tsx`（フロントのみ）／
  回帰: `tests/components/stats-screen.test.tsx` L103, L107 付近（「久しぶり」バッジを assert）。
- 現状: L88-98 `rareSongIds`（最終演奏日 古い順 上位5件を Set 化）、L192-199 の凡例バッジ、
  L219-223 の行内バッジで「久しぶり」を強調表示している。
- 変更方針: `rareSongIds` useMemo・凡例・行内バッジをすべて削除。Section description（L190）から
  「久しぶりの曲にはバッジを表示します」を除去。テストの「久しぶり」assert を削除/差し替え。

## 要件2: 最終演奏日「列」廃止

- 影響ファイル: `src/components/stats/stats-screen.tsx`（列削除）、`src/lib/api/types.ts`（`lastPlayedDate` の去就）、
  `src/server/repositories/stats.ts`（レスポンス生成）、回帰: `tests/api/stats.test.ts` L129-135・`tests/components/stats-screen.test.tsx` L34-35, L50。
- 現状: 曲別テーブルに「最終演奏日」`TableHead`（L210）と `TableCell`（L232-234, `s.lastPlayedDate ?? "—"`）がある。
- 変更方針: テーブルから最終演奏日の見出し・セルを削除。フィルタ（要件4）はサーバ側 HAVING で処理するため
  **表示にも計算にも `lastPlayedDate` をレスポンスへ返す必要はない**（「内部保持」= サーバ内 SQL のみ）。
  → `StatsSongStat.lastPlayedDate` はレスポンス DTO から**削除を推奨**（`getStats` の select は HAVING 用に内部保持）。
  影響テスト（stats.test.ts の `toEqual` 期待値・screen テストのモック）を更新する。
  代替案（churn 最小化）: DTO に残置も可。ただし要件1で唯一の消費者が消えるため実データ用途は無くなる。

## 要件3: 3指標＋各降順ソート＋未演奏曲表示＋未演奏バッジ

- 影響ファイル: バックエンド `src/server/repositories/stats.ts`・`src/lib/api/types.ts`、
  フロント `src/components/stats/stats-screen.tsx`、回帰: `tests/api/stats.test.ts`・`tests/components/stats-screen.test.tsx`。
- 現状:
  - `getStats` の `songRows` は `callCount`(called_by_me 合計) と `playCount`(participated 合計) のみを選択。
    **「登場回数」= 素の `count(*)` は未計算・未提供**。
  - `StatsSongStat` は `{ songId, title, callCount, playCount, lastPlayedDate }`。**`appearanceCount` フィールドが無い**。
  - 並びはサーバ固定 `orderBy(desc(callCountExpr), asc(songId))`（L124）。**インタラクティブなソートUIは無い**。
  - 未演奏の区別表示（バッジ）は無い（`playCount` は列表示のみ）。
- 変更方針:
  - バックエンド: `songRows` に `appearanceCount: countExpr`(=`count(*)`) を追加し、`StatsSongStat` に
    `appearanceCount: number` を追加（3指標 = callCount / playCount / appearanceCount が揃う）。
    未演奏曲は集合的に既に載る（前述）ため集合変更は不要。サーバの既定ソートは callCount DESC のまま初期表示兼タイブレークに使える。
  - フロント: 「登場」列を追加（コール/演奏/登場 の3列）。`playCount === 0` の行に「未演奏」バッジを表示。
    3指標のヘッダをクリックで降順ソートする UI を追加（既定=コール回数 降順）。
  - **ソート責務の推奨: クライアント側ソート**。曲別リストは全件返っており件数も限定的（性能スモークは曲500）なので、
    返却済み配列を選択メトリクスで降順ソートするのが最小変更。サーバは既定順（callCount DESC）を初期値/タイブレークとして維持。
    → 新規クエリパラメータやサーバ再取得は不要。SWR キー汚染も避けられる。

## 要件4: 久しぶりフィルタ（可変閾値・未演奏除外）

- 影響ファイル: `src/server/validation/stats.ts`（スキーマ）、`src/server/repositories/stats.ts`（HAVING）、
  `src/lib/api/client.ts`（`StatsQueryParams`・`buildStatsQuery`）、`src/lib/api/hooks.ts`（`SWR_KEYS.stats`）、
  `src/components/stats/stats-screen.tsx`（閾値セレクトUI）、回帰: `tests/api/stats.test.ts`（新規ケース）。
- 現状: フィルタは venue / season / from / to のみ（`statsQuerySchema` L26-32、`buildConds` L67-89）。
  久しぶり（最終演奏日が閾値以上前）で曲別リストを絞る手段は無い。
- 変更方針:
  - クエリパラメータ: `statsQuerySchema` に **`lastPlayedBefore`（`dateSchema.optional()`）** を追加（既存 dateSchema を再利用）。
    フロントは「なし/3ヶ月/半年/1年/2年」プリセットを **今日基準の日付に変換** して送る
    （`dateDaysBefore` 相当を UI 側で算出、または月引き算）。代替案: `notPlayedWithinDays`（正整数）を送りサーバで cutoff 算出。
    → **日付 `lastPlayedBefore` 方式を推奨**（サーバは既存 dateSchema 流用で最小、cutoff 計算をクライアントに寄せる）。
  - SQL: この絞り込みは **曲別 `songRows` クエリにのみ** 適用（分布/傾向/月別は不変）。
    `lastPlayedExpr` は集約（max）なので **HAVING 句**で
    `max(case when participated=1 then session_date end) <= :lastPlayedBefore` を課す。
    **未演奏除外は自動**: 最終演奏日 NULL の行は `NULL <= 日付` が真にならず HAVING で落ちる（明示 `is not null` を足すと可読性↑）。
  - フロント配線: `StatsQueryParams` に `lastPlayedBefore?: string` を追加 → `buildStatsQuery` が付与 →
    `SWR_KEYS.stats` のキーに反映され自動再取得。UI は venue/season と並べて閾値セレクトを配置。

---

# Domain Model Delta

DB スキーマ変更なし（読み取り集計のみ）。契約（型）とクエリ引数の差分のみ。

- `StatsSongStat`（`src/lib/api/types.ts`）:
  - 追加: `appearanceCount: number`（フィルタ下の登場回数 = `count(*)`）。
  - 削除推奨: `lastPlayedDate: string | null`（表示列廃止＋フィルタはサーバ HAVING に移行するため不要。churn 最小化なら残置も可）。
  - 結果形: `{ songId, title, callCount, playCount, appearanceCount }`。
- `StatsQuery` / `statsQuerySchema`（`src/server/validation/stats.ts`）:
  - 追加: `lastPlayedBefore?: string`（YYYY-MM-DD、dateSchema 流用）。※代替: `notPlayedWithinDays?: number`。
- `StatsQueryParams` / `buildStatsQuery`（`src/lib/api/client.ts`）・`SWR_KEYS.stats`（`hooks.ts`）:
  - 追加: `lastPlayedBefore?: string`（クエリ文字列に付与しキャッシュキーに反映）。
- ソートはサーバ契約に含めない（クライアント側で並べ替え）。サーバ既定順は callCount DESC を維持。

---

# Quality Gate Candidates

| gate | script | 用途 |
|------|--------|------|
| typecheck | `npm run typecheck`（`tsc --noEmit`） | 型契約（StatsSongStat/StatsQuery/StatsQueryParams）整合 |
| lint | `npm run lint`（`eslint .`） | 静的解析 |
| test | `npm run test`（`vitest run`） | `tests/api/stats.test.ts`・`tests/components/stats-screen.test.tsx` 回帰 |
| build | `npm run build`（`next build`） | 本番ビルド通過 |

---

# Unit Decomposition 示唆

- **backend 変更（stats-api）**: `getStats` に `appearanceCount`(count(*)) 追加＋`lastPlayedBefore` HAVING フィルタ、
  `statsQuerySchema` にパラメータ追加、`StatsSongStat` 型更新（appearanceCount 追加・lastPlayedDate 削除）、
  `tests/api/stats.test.ts` 更新（appearanceCount 検証・久しぶり閾値ケース追加・lastPlayedDate 期待値修正）。
  ※共有契約 `src/lib/api/types.ts`（`StatsSongStat`）と `StatsQueryParams`/`buildStatsQuery`/`SWR_KEYS`（client.ts/hooks.ts）も
  この unit で確定させると contract-first になる。
- **frontend 変更（stats-screen）**: 久しぶりバッジ削除・最終演奏日列削除・「登場」列追加・未演奏バッジ・
  3指標クライアントソートUI・久しぶり閾値セレクト（venue/season 隣接）配線、`tests/components/stats-screen.test.tsx` 更新。
- **依存エッジ**: frontend → backend。フロントは `appearanceCount` フィールドと `lastPlayedBefore` パラメータ（＝型/クエリ契約）に依存する。
  型契約（types.ts + client.ts）を backend unit で先に確定させ、frontend unit がそれを消費する。
- **推奨: 2 unit（backend → frontend、依存 1 本）**。前 intent の unit-04(API)/unit-05(画面) 分割を踏襲でき、
  契約先行でレビュー境界が明確。規模は小さいので 1 unit 統合も妥当だが、SSOT 契約の確定順を守れる 2 unit を推奨。
