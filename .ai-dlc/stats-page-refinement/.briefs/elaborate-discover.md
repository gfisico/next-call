---
intent_slug: stats-page-refinement
worktree_path: /Users/fisico/src/senkyoku/.ai-dlc/worktrees/stats-page-refinement
project_maturity: established
iterates_on: next-call-enhancements
---

# 目的

next-call-enhancements で導入した統計ページ（/stats）の改善 intent。現行の統計実装を精読し、以下4要件＋決定事項を実現するための「影響ファイル・現状・変更方針」を discovery.md に追記せよ。新規発明でなく既存構造（stats.ts / aggregate.ts / route.ts / StatsResponse / stats-screen.tsx）に沿った差分を洗い出す。

# 決定事項（elaborate Q&A で確定）

- 「未演奏」= 自分の演奏回数0（myPlayCount=0、= participated 実績なし）。バッジを付ける。
- 「最終演奏日」= 自分が演奏した最新日（participated の max session_date）。表示列は廃止するがフィルタ用に内部保持。
- リスト対象 = **登場実績のある曲のみ**（appearanceCount>0。=セットリストに一度でも出た曲）。未演奏(myPlayCount=0)でも登場していれば載る。全く登場していない曲は載せない。
- 3指標 = コール回数(myCallCount) / 演奏回数(myPlayCount、コール含む) / 登場回数(appearanceCount、参加有無問わず)。各降順ソート可。既定ソート=コール回数 降順。
- 久しぶりフィルタ = 可変閾値（なし/3ヶ月/半年/1年/2年 等）。最終演奏日がその閾値以上前の曲に絞る。未演奏(最終演奏日なし)は除外。既存 venue/season フィルタと並べて配置。

# 4要件

1. 「久しぶり」バッジ廃止（現行 stats-screen の久しぶり強調表示を削除）。
2. 最終演奏日「列」廃止（曲別テーブルの表示列削除。内部/フィルタ用途では保持）。
3. 3指標＋各降順ソート＋未演奏曲表示＋未演奏バッジ。
4. 久しぶりフィルタ（可変閾値、未演奏除外）。

# 調べて discovery.md に書くこと

- `src/server/stats/aggregate.ts` の `aggregatePerSongStats`: 現在どの songId 集合に対して集計しているか（曲別リストの対象曲集合の決まり方）。appearanceCount/myPlayCount/myCallCount/lastPlayedDate の算出ロジックとカラム。
- `src/server/repositories/stats.ts` の `getStats`: 曲別セクション（perSong）がどの曲を返すか（登場実績のある曲のみか、全曲か）。venue/season/from/to フィルタの実装。要件3で「登場実績のある曲のみ・3指標」を満たすための変更点。要件4の久しぶり閾値フィルタをどこに足すか（SQL 条件・未演奏除外の扱い）。
- `src/app/api/stats/route.ts` と `statsQuerySchema`（src/server/validation/stats.ts）: 新フィルタ（例 lastPlayedBefore / notPlayedWithin など）のクエリパラメータ追加方針。
- `src/lib/api/types.ts` の `StatsResponse` / per-song 型: 表示に必要なフィールド（callCount/playCount/appearanceCount/未演奏フラグ）。lastPlayedDate をレスポンスに残すか（列は消すがフィルタはサーバ側なので不要かもしれない）。
- `src/components/stats/stats-screen.tsx`: 曲別セクションの現在の表示（列・久しぶりバッジ・ソートの有無）。要件1/2/3のUI変更点（バッジ削除・列削除・3指標カラム・降順ソートUI・未演奏バッジ）。フィルタUI（venue/season）の作りと、久しぶり閾値フィルタの追加箇所。`fetchStats`/`useStats`/`buildStatsQuery`（src/lib/api/client.ts, hooks.ts）の変更点。
- 既存テスト（tests/api/stats.test.ts, tests/components/stats-screen.test.tsx）で影響を受けるもの。
- quality_gates: package.json scripts（typecheck/lint/test/build）。

# 出力

discovery.md に、要件ごとの「影響ファイル・現状・変更方針」＋ `## Domain Model Delta`（スキーマ変更は想定しないが、レスポンス型/フィルタ引数の変更を記載）＋ `## Quality Gate Candidates` ＋ `## Unit Decomposition 示唆`（backend/frontend の分割と依存）を追記。日本語で既存 discovery スタイルに合わせる。
