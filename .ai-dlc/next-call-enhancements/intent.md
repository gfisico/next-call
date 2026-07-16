---
workflow: default
git:
  change_strategy: intent
  auto_merge: true
  auto_squash: false
announcements: [changelog]
passes: []
active_pass: ""
iterates_on: "next-call-mvp"
created: 2026-07-16
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

# next-call 機能拡張 — 運用フィードバック反映（履歴導線・編集/削除・統計・メモ移行・UI基盤）

## Problem

next-call MVP を実運用したところ、記録・振り返り・操作性・UI運用の各面で不足が明らかになった。

- 履歴（推薦履歴）への戻り導線が推薦画面にしかなく、セッション画面からたどれない。
- セットリストのフロント編成が「as→ts」の矢印表記になっており、矢印に意味が無いのに順序を含意して見える。
- セットリストの曲順を後から直せない。誤登録や並べ替えに対応できない。
- セッション自体の削除ができず、日付・店名の入力ミスも修正できない。
- 演奏の傾向を振り返る統計画面が無く、コール曲やセットリスト全体の分析ができない（店/母店・季節などでの絞り込みも不可）。
- セッションごとのパート別参加者数（リスナー数含む）・ホストのパート・自由メモを残せない。過去の記録は iPhone メモに大量の非構造テキストとして存在し、アプリへ移行できていない。
- UI 運用面のルール（バージョン番号の追跡、ダークモード対応）が未整備。

## Solution

next-call MVP（`next-call-mvp`）の既存ドメインモデル・9ステージ推薦パイプライン・画面群・API層を土台に、追加・改修で対応する。既存の記録データ・推薦ロジックは壊さない（推薦エンジン `src/engine` のコアは不変）。

discipline 別（backend/frontend）に 6 ユニットへ分解し、共有ファイル（`session-record-screen.tsx` ほか）の競合を依存関係で直列化する。DB 変更は要件7（詳細記録）のみで、additive マイグレーション（`0004_*`）に限定する。統計は既存 `build-input.ts` の集計を汎用化して流用し、ダークモードは既存 globals.css のトークン土台の上に付け外し機構だけを足す。

### スコープ（拡張要件）

1. 履歴導線: セッション画面からも推薦履歴に戻れる導線を追加。
2. フロント編成表記: 「as→ts」（矢印）→「as, ts」（カンマ区切り）。内部 position 順は保持、表示のみ変更。
3. 曲順編集: セットリスト画面で `Performance.order_index` を編集。
4. セッション削除: 確認ダイアログ経由の物理削除。紐づく Performance/推薦履歴/フロント編成も削除（`pending_songs` は横断保持のため残す）。
5. セッション基本情報の修正: `session_date`・`venue` の後編集。
6. 統計画面: コール曲統計・セットリスト全体統計。店/母店・季節で絞り込み。
7. セッション詳細記録＋メモ移行: パート別参加者数（`session_participants`）・リスナー数・ホストパート・メモを構造化記録。既存メモ形式のテキストを一括パース→プレビュー補正→取込。
8. バージョン番号ルール導入: `src/version.ts` の SSOT 定数（`vYYYYMMDD-NN`, JST）をマスタ設定画面のみに表示。`docs/version_number.md` 準拠。
9. ダークモード導入: クラス方式（`.dark` on `<html>`）。トグルは全画面共通ヘッダー右上。配色は本アプリのベースカラーから設計。`docs/dark_mode.md` 準拠。

## Previous Intent Reference

This intent iterates on **next-call — ジャズセッション向け選曲提案アプリ MVP** (`next-call-mvp`)。MVP は 9 ユニット全て completed（app基盤/推薦エンジン(tdd)/マスタ・セッションAPI/推薦API/セッション画面/推薦画面/マスタ設定画面/CSVインポート/インフラデプロイ）。既存エンティティ・一次仕様は `.ai-dlc/next-call-mvp/` と `docs/jazz_session_song_recommendation_spec_v2.md` を参照。

## Domain Model

MVP のドメインモデル（Song / GenreTag / Instrument / Venue / Session / Performance / PerformanceFrontInstrument / SelectionIntent / RecommendationRequest / RecommendationCandidate / PendingSong / Setting / User）を土台に、以下を追加・変更する（additive 限定・次マイグレーション `0004_*`）。

### 新規/変更エンティティ（要件7のみ DB 変更）

- **`session_participants`（新規テーブル）**: `session_id`(FK→sessions), `instrument_code`(FK→instruments.code), `count`(int)。PK=(session_id, instrument_code)。楽器マスタ連動のパート別人数。
- **`sessions` 列追加**: `host_instrument_code`(nullable FK→instruments.code), `listener_count`(nullable int、既存 `has_listeners` と併存)。
- **メモ一括移行**: 正規化テーブルは新設せず、既存 `import_jobs` 経路を additive 拡張（or 専用短命ジョブ）。

### 変更なしで対応（既存カラム＋ロジックのみ）

- 要件3 曲順 → 既存 `Performance.order_index`
- 要件5 セッション編集 → 既存 `session_date` / `venue_id`
- 要件4 削除 → cascade 手動削除（candidates→requests→front_instruments→performances→**session_participants**→session）。foreign_keys=ON のため参照テーブルを漏れなく削除する
- 要件8/9 → DB 非対象

### 既存資産の再利用

- 曲別集計（登場回数・最終演奏日・コール回数・ジャンル比率）は `src/server/recommendation/build-input.ts` に実装済み → 統計画面はこれを汎用化して流用。
- ダークモードの semantic トークン・`@custom-variant dark` は globals.css に完成済み（Tailwind v4 クラス方式）→ 付け外し機構・FOUC・トグルUI・localStorage のみ追加。
- バージョン SSOT は `src/version.ts` を新設（export.ts の `schema_version` とは別概念、SSOT 非共有）。

### Data Sources

- **SQLite（VPS、Drizzle ORM）**: 全エンティティ。要件7の additive マイグレーションを追加。
- **貼付メモテキスト**: 要件7の一括パース取込の入力。表記揺れ・記号（🎷🎹👆🔰）・別名・※注記の解決はプレビューUIで対応。

## Success Criteria

- [ ] セッション画面から推薦履歴へ戻る導線が動作する（推薦画面と同等）
- [ ] セットリストのフロント編成が「as, ts」カンマ区切りで表示される（内部 position 順は保持）
- [ ] セットリストの曲順（order_index）を編集して保存でき、表示・「直前の曲」判定に反映される
- [ ] セッションを確認ダイアログ経由で物理削除でき、紐づく Performance・推薦履歴・フロント編成・session_participants が全て削除される（pending_songs は残る）
- [ ] セッションの日付・店舗を後から修正して保存できる
- [ ] 統計画面で「曲別コール/演奏回数・最終演奏日」「ジャンル/キー/構成の分布」「季節別/店別/母店別の傾向」「月別推移」が表示され、店/母店・季節で絞り込める
- [ ] セッションにパート別参加者数（`session_participants`）・リスナー数・ホストパートを記録でき、既存メモ形式のテキストを一括パース→プレビュー補正→取込できる
- [ ] バージョン番号が `src/version.ts` の SSOT 定数からマスタ設定画面に `vYYYYMMDD-NN` 形式で表示される
- [ ] ダークモードがクラス方式で動作し、ヘッダー右上トグルで切替・localStorage 永続化され、FOUC が発生しない
- [ ] トグルの `aria-label` が状態連動し、ダーク配色が WCAG AA（本文4.5:1）を満たす
- [ ] 推薦エンジン（`src/engine`）のコアロジックは不変で、既存テストが全てパスする
- [ ] 統計画面の集計が曲数百・演奏記録数千件規模で体感的に即時応答する（p95 < 1s 目安）
- [ ] typecheck / lint / test / build が全てパスし、追加/改修画面が docs/design_rule.md に準拠する

## Context

- 一次資料: `docs/version_number.md`（バージョン番号ルール）、`docs/dark_mode.md`（ダークモードルール）、`docs/jazz_session_song_recommendation_spec_v2.md`（元仕様）、`docs/design_rule.md`（デザインルール）。
- ワークフロー: intent 全体 default。git: intent 戦略・auto_merge・main 起点。パス: dev 単一（プロジェクト既定 product→dev を本 intent では上書き）。
- ファイル競合回避: `session-record-screen.tsx`→unit-03 のみ、`bottom-nav.tsx`→unit-05、`(main)/layout.tsx`ヘッダー・`settings-screen.tsx`・`globals.css`→unit-06。
- 探索の詳細は `.ai-dlc/next-call-enhancements/discovery.md` を参照。

### 移行対象メモのサンプル形式

```
2026/5/9 池袋
tp1, as1, g4, pf2, b3, ds3
・メインパートで記載
・ホストはpf
・🎷🎹:演奏、👆:曲指定、🔰:初
・()内: フロント編成

1. Stella By Starlight (tp, g, g) ※pfなし
2. I'll Be Seeing You (g)
...
14. Giant Steps (as, g) 🎷🔰 ※Key=C
...

🖋️Giant Stepsを初めてやった
```

- ヘッダ: 日付・店名、パート別人数（`tp1, as1, ...` = パート+人数、リスナー含む想定）、ホストのパート、凡例、全体メモ。
- 各行: 曲順・曲名・(フロント編成)・記号（🎷/🎹=演奏、👆=曲指定/コール、🔰=初）・補足（※pfなし、※Key=C 等）。
