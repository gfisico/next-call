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
status: active
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
- コール回数・演奏回数・登場回数の3指標を並べて比較し、それぞれで降順ソートしたい。現状は演奏実績のある曲しか出ず、まだ演奏していない曲を把握できない。
- 「しばらく演奏していない曲」を洗い出したいが、最終演奏日が1年以上前の曲を絞り込む手段がない。

## Solution

統計ページのバックエンド集計（`src/server/repositories/stats.ts` / `src/server/stats/aggregate.ts`）とフロント（`src/components/stats/stats-screen.tsx`）を改修する。既存の集計値（`appearanceCount`＝登場回数 / `myPlayCount`＝演奏回数 / `myCallCount`＝コール回数 / `lastPlayedDate`）を土台に、曲別セクションの指標・ソート・対象曲集合・絞り込みを再設計する。他の統計セクション（分布・傾向・月別推移）や統計以外の機能は変更しない。DB スキーマ変更は想定しない（既存カラムの集計のみ）。

### スコープ（改修要件）

1. **「久しぶり」バッジ廃止**: 曲別セクションの久しぶり強調表示を削除。
2. **最終演奏日「列」廃止**: 曲別テーブルから最終演奏日の表示列を削除（フィルタ用途では内部的に保持）。
3. **3指標＋降順ソート＋未演奏曲表示**:
   - コール回数（`myCallCount`）
   - 演奏回数（`myPlayCount`。コール回数を含む＝コールした曲も演奏回数にカウント）
   - 登場回数（`appearanceCount`。自分の参加有無を問わずその曲がセットリストに登場した回数）
   - 各指標で降順ソートできる。
   - **未演奏曲もリストに表示**し、**未演奏バッジ**を付ける。
4. **久しぶりフィルタ**: 全体の絞り込みに「最終演奏日が1年以上前」でも絞り込める条件を追加。**未演奏曲はこのフィルタから除外**する（最終演奏日を持たないため）。

## Previous Intent Reference

This intent iterates on **next-call 機能拡張 — 運用フィードバック反映**（`next-call-enhancements`、6ユニット completed・PR #4 マージ済み・本番デプロイ済み）。

### What was built previously（統計関連）

- **unit-04 stats-api**: `src/server/stats/aggregate.ts` の `aggregatePerSongStats`（`appearanceCount` / `lastPlayedDate` / `myPlayCount` / `myCallCount`）＋ `src/server/repositories/stats.ts` の `getStats`（曲別・分布・傾向・月別、venue/season 絞り込み）＋ `GET /api/stats` ＋ `StatsResponse` DTO（`src/lib/api/types.ts`）。
- **unit-05 stats-screen**: `/stats` ページ・`stats-screen.tsx`・`stat-bar-list.tsx`・`fetchStats`/`useStats`。曲別ランキング表＋久しぶりバッジ（現状 lastPlayedDate 昇順 top5）・分布・傾向・月別・venue/season フィルタ。

一次資料: `.ai-dlc/next-call-enhancements/`（intent.md / discovery.md / unit-04・05）、`docs/design_rule.md`。

### What this iteration changes

上記スコープ 1〜4。曲別セクションの指標・ソート・対象曲集合・絞り込みの再設計が中心。分布/傾向/月別セクション、統計以外の機能、推薦エンジンは不変。

## Success Criteria

- [ ] 曲別セクションから「久しぶり」バッジが無くなっている
- [ ] 曲別テーブルに最終演奏日の表示列が無い
- [ ] コール回数・演奏回数（コール含む）・登場回数（参加有無問わず）が表示され、各指標で降順ソートできる
- [ ] 未演奏曲もリストに表示され、未演奏バッジが付く
- [ ] 「最終演奏日が1年以上前」の絞り込みができ、未演奏曲は除外される
- [ ] 他の統計セクション（分布・傾向・月別）と統計以外の機能に回帰が無い（既存テスト通過）
- [ ] typecheck / lint / test / build がパスし、docs/design_rule.md に準拠する

## Context

### 未確定事項（elaborate で確定する）

- **「未演奏」の定義**: 登場回数0（一度も演奏記録に登場していない）か、自分の演奏回数0（登場はしたが自分は不参加）か。
- **リスト対象の曲集合**: 曲マスタ全体か、`has_played=true`（コール可能曲）か、登場実績のある曲＋未演奏曲の別扱いか。数百曲規模の描画・ソート性能への影響も考慮。
- **久しぶりフィルタの形**: 固定「1年以上前」か、可変閾値（Nヶ月/年を選択）か。配置（既存の venue/season 絞り込みと同じ領域か）。
- **「最終演奏日」の基準**: 自分が参加した演奏日（participated）か、その曲がセットリストに登場した日（any performance）か。
- **3指標のデフォルトソート**（例: コール回数 降順）。

### 参考

- 既存集計は `aggregatePerSongStats`（推薦入力と共有・純関数）を統計側が流用。曲別対象を曲マスタ全体へ広げる場合、この集計は「登場した曲」前提の可能性があるため、未演奏曲の 0 埋め・対象拡張の実装方針を elaborate で確認する。
- 性能 NFR: 曲数百・演奏記録数千件規模で SQL 集計・即時応答（p95 < 1s 目安）を維持。
