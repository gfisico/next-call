---
status: success
intent_slug: stats-page-refinement
worktree_path: /Users/fisico/src/senkyoku/.ai-dlc/worktrees/stats-page-refinement
files_read:
  - src/server/stats/aggregate.ts
  - src/server/repositories/stats.ts
  - src/app/api/stats/route.ts
  - src/server/validation/stats.ts
  - src/lib/api/types.ts
  - src/components/stats/stats-screen.tsx
  - src/components/stats/stat-bar-list.tsx
  - src/lib/api/client.ts
  - src/lib/api/hooks.ts
  - tests/api/stats.test.ts
  - tests/components/stats-screen.test.tsx
  - package.json
files_written:
  - .ai-dlc/stats-page-refinement/discovery.md（要件別・Domain Model Delta・Quality Gate・Unit Decomposition を追記）
source_modified: false
committed: false
---

# サマリ

現行統計コードを精読し、discovery.md に要件別「影響ファイル/現状/変更方針」＋
Domain Model Delta・Quality Gate Candidates・Unit Decomposition 示唆を追記した。
ソース未変更・未コミット（読み取り探索＋discovery.md 追記のみ）。

## CRITICAL 質問の結論

- 曲別リストは `getStats`（src/server/repositories/stats.ts L110-132）の `songRows` が源泉。
  `.from(performances)` 起点＋`groupBy(songId)` のため **フィルタ下で 1 度でも登場した曲（登場実績あり）だけ**が載る。
  全曲ではない。未演奏(playCount=0)でも登場していれば既に載る（回帰: stats.test.ts L138-149）。
  → 「登場実績のある曲のみ・未演奏含む」は集合レベルで現状すでに充足。曲集合の変更は不要。
- ただし **`appearanceCount`(登場回数=count(*)) は現状レスポンスに無い**（callCount/playCount のみ）→ 要件3 で追加が必要。
- `aggregate.ts` の `aggregatePerSongStats` は推薦専用で getStats からは未使用（誤誘導注意）。
- `lastPlayedDate` はレスポンスに含まれ、消費者は stats-screen の rareSongIds＋最終演奏日列のみ。
  要件1/2で消費者が消え、要件4のフィルタはサーバ HAVING に移るため **レスポンスからは削除推奨**。

## 変更方針の要点

- API: `StatsSongStat` に `appearanceCount` 追加・`lastPlayedDate` 削除推奨。
  `statsQuerySchema` に `lastPlayedBefore`(YYYY-MM-DD, dateSchema 流用) 追加。
  久しぶりフィルタは曲別クエリの **HAVING**（`max(participated 日) <= lastPlayedBefore`）でのみ適用（未演奏は自動除外）。
  ソートは契約に含めず **クライアント側**（サーバ既定 callCount DESC は初期値/タイブレークで維持）。
- 画面: 久しぶりバッジ削除・最終演奏日列削除・「登場」列追加・未演奏バッジ(playCount===0)・
  3指標クリック降順ソートUI（既定=コール降順）・久しぶり閾値セレクト（venue/season 隣接）。
  client.ts `StatsQueryParams`/`buildStatsQuery`・hooks.ts `SWR_KEYS.stats` に `lastPlayedBefore` 配線。
- Quality Gate: typecheck / lint / test / build（package.json scripts）。
- Unit 分割: **2 unit 推奨**（backend stats-api → frontend stats-screen、依存 1 本）。
  契約（types.ts + client.ts）を backend unit で先行確定。小規模ゆえ 1 unit 統合も妥当だが契約先行順を守れる 2 unit を推奨。
