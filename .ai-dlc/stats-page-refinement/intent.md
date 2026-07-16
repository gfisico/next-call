---
workflow: default
git:
  change_strategy: intent
  auto_merge: true
  auto_squash: false
announcements: [changelog]
passes: []
active_pass: ""
iterates_on: "next-call-enhancements"
created: 2026-07-17
status: completed
epic: ""
quality_gates:
  - name: typecheck
    command: npm run typecheck
  - name: lint
    command: npm run lint
  - name: tests
    command: npm run test
  - name: build
    command: npm run build
---

# 統計ページ改善 — 集計指標の再設計・未演奏曲の可視化・久しぶりフィルタ

## Problem

`next-call-enhancements` で導入した統計ページ（`/stats`）を実運用したところ、曲別セクションの指標・表示・絞り込みに改善余地が見つかった。

- 「久しぶり」バッジ（最終演奏日の古い上位を強調）は不要。
- 「最終演奏日」列は表示不要。
- コール回数・演奏回数・登場回数の3指標を並べて比較し、それぞれで降順ソートしたい。未演奏（自分が一度も演奏していない）曲も把握したい。
- 「しばらく演奏していない曲」を洗い出したいが、最終演奏日が1年以上前の曲を絞り込む手段がない。

## Solution

統計ページのバックエンド集計（`src/server/repositories/stats.ts`）とフロント（`src/components/stats/stats-screen.tsx`）を改修する。曲別セクションの指標・ソート・表示・絞り込みを再設計する。分布・傾向・月別セクション、統計以外の機能、推薦エンジンは不変。DBスキーマ変更なし（既存カラムの集計のみ）。

`lastPlayedDate` の削除がサーバ集計・レスポンス型・唯一の消費者（画面）をアトミックに変更する必要があるため、**1つのフルスタックユニット**で実装する（discipline を分割すると型削除で画面がコンパイル不能になる中間状態が生じる）。

### スコープ（改修要件）

1. **「久しぶり」バッジ廃止**: 曲別セクションの久しぶり強調表示・凡例・`rareSongIds` を削除。
2. **最終演奏日「列」廃止**: 曲別テーブルの最終演奏日列を削除。レスポンス型 `StatsSongStat` からも `lastPlayedDate` を削除（SQL内部でのみ使用）。
3. **3指標＋降順ソート＋未演奏曲表示**:
   - コール回数（`callCount` = myCallCount）
   - 演奏回数（`playCount` = myPlayCount、コール含む）
   - 登場回数（`appearanceCount`、参加有無問わず。**新規にレスポンスへ追加**）
   - 各指標で降順ソートできる（既定=コール回数 降順、ソートはクライアント側）。
   - 登場実績のある曲（appearanceCount>0）を全てリスト表示。未演奏曲（`playCount===0`）に**未演奏バッジ**を付ける。
4. **久しぶりフィルタ**: 全体の絞り込みに「最終演奏日が◯以上前」を追加（なし/3ヶ月/半年/1年/2年）。サーバ側で `lastPlayedBefore`（YYYY-MM-DD）を受け、`songRows` の HAVING で `max(participated の session_date) <= lastPlayedBefore` に絞る。未演奏曲（最終演奏日 NULL）は自動除外。既存 venue/season フィルタと並べて配置。

## Previous Intent Reference

This intent iterates on **next-call 機能拡張**（`next-call-enhancements`、6ユニット completed・PR #4 マージ済み・本番デプロイ済み）。統計は unit-04（stats-api）・unit-05（stats-screen）で実装。

### 現状（discovery で確認）

- `getStats`（`src/server/repositories/stats.ts`）の `songRows` は performances を sessions/venues/songs と INNER JOIN し `groupBy(songId)`。**既に「登場実績のある曲のみ」を返し、未演奏(playCount=0)の登場曲も含む** → 対象曲集合の変更は不要。
- `StatsSongStat`（`src/lib/api/types.ts`）は現状 `{songId, title, callCount, playCount, lastPlayedDate}`。`appearanceCount` は未収録。
- `lastPlayedDate` = `max(case when participated=1 then session_date end)`（[stats.ts:106](src/server/repositories/stats.ts#L106)、リクエスト時にSQLで算出）。現状の消費者は久しぶりバッジ（`rareSongIds`）と最終演奏日列のみ。
- `aggregatePerSongStats`（`src/server/stats/aggregate.ts`）は推薦専用で getStats から未使用 → 触らない。
- ソート: 全件返却済み（perf smoke=500曲）なのでクライアント側ソートで十分。サーバ既定 `callCount DESC` は初期/タイブレークとして維持。

## Domain Model

DBスキーマ変更なし。変更はレスポンス型とクエリ引数のみ。

### 変更エンティティ（型・契約）

- **`StatsSongStat`**: `appearanceCount: number` を追加、`lastPlayedDate` を削除。
- **`statsQuerySchema`**: `lastPlayedBefore`（YYYY-MM-DD、既存 dateSchema 流用）を追加。クライアントがプリセット（3ヶ月/半年/1年/2年）から cutoff 日付を計算して渡す。「なし」時は未指定。
- **`songRows`（stats.ts）**: `appearanceCount`（`count(*)`）を select に追加。`lastPlayedBefore` 指定時に HAVING を追加。`lastPlayedDate` は select から削除（HAVING の式内でのみ使用）。

### Data Sources

- **SQLite（Drizzle ORM）**: 既存 performances/sessions/venues/songs。スキーマ変更なし。

## Success Criteria

- [x] 曲別セクションに「久しぶり」バッジ・凡例が無い
- [x] 曲別テーブルに最終演奏日の表示列が無く、`StatsSongStat` レスポンスにも `lastPlayedDate` が無い
- [x] コール回数・演奏回数(コール含む)・登場回数(参加有無問わず) の3列が表示され、各列で降順ソートできる（既定=コール回数降順、クライアント側ソート）
- [x] 未演奏曲（演奏回数0）に未演奏バッジが付き、登場実績のある曲が全てリスト表示される
- [x] 「最終演奏日が◯以上前」フィルタ（なし/3ヶ月/半年/1年/2年）で該当曲に絞れ、未演奏曲は除外される（サーバ側 `lastPlayedBefore` HAVING）。cutoff は JST 基準・日数ベースで計算
- [x] 閾値フィルタは曲別リストのみに適用され、分布/傾向/月別は影響を受けない（participated 日基準で判定）
- [x] 分布・傾向・月別セクションと統計以外の機能に回帰が無い（既存テストを新仕様に合わせて更新し全通過）
- [x] 統計API集計が数百曲・数千記録規模で即時応答（p95 < 1s 目安）を維持
- [x] typecheck / lint / test / build がパスし、docs/design_rule.md に準拠する

## Context

- 一次資料: `.ai-dlc/next-call-enhancements/`（unit-04・05）、`docs/design_rule.md`。探索詳細は `discovery.md`。
- ワークフロー: default。git: intent戦略・auto_merge・main起点。パス: dev単一。
- 影響テスト: `tests/api/stats.test.ts`（lastPlayedDate 期待・appearanceCount・フィルタ）、`tests/components/stats-screen.test.tsx`（久しぶり assert・mock）。
