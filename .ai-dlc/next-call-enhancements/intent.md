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

next-call MVP を実運用したところ、記録・振り返り・操作性の各面で不足が明らかになった。

- 履歴（推薦履歴）への戻り導線が推薦画面にしかなく、セッション画面からたどれない。
- セットリストのフロント編成が「as→ts」の矢印表記になっており、矢印に意味が無いのに順序を含意して見える。
- セットリストの曲順を後から直せない。誤登録や並べ替えに対応できない。
- セッション自体の削除ができず、日付・店名の入力ミスも修正できない。
- 演奏の傾向を振り返る統計画面が無く、コール曲やセットリスト全体の分析ができない（店/母店・季節などでの絞り込みも不可）。
- セッションごとのパート別参加者数（リスナー数含む）・ホストのパート・自由メモを残せない。過去の記録は iPhone メモに大量の非構造テキストとして存在し、アプリへ移行できていない。
- UI 運用面のルール（バージョン番号の追跡、ダークモード対応）が未整備。

## Solution

next-call MVP（`next-call-mvp`）の既存ドメインモデル・9ステージ推薦パイプライン・画面群を土台に、以下の機能拡張と UI 基盤整備を積み増す。既存の記録データ・推薦ロジックは壊さず、追加・改修で対応する。ユニット分解は elaborate 段階で行う。

### スコープ（拡張要件）

1. **履歴導線の追加**: セッション画面からも推薦履歴に戻れる導線を追加する（推薦画面と同等）。
2. **フロント編成の表記変更**: セットリスト画面のフロント編成表記を「as→ts」（矢印）から「as, ts」（カンマ区切り）に変更する。矢印に順序の意味は無い旨を表記に反映。※内部データ（PerformanceFrontInstrument）は順序付き重複可のまま、表示のみカンマ区切りに。
3. **曲順編集**: セットリスト画面で曲順（order_index）を編集できるようにする。
4. **セッション削除**: セッションを削除できるようにする（関連 Performance / 推薦履歴の扱いを含め elaborate で確定）。
5. **セッション基本情報の修正**: セッションの店名（venue）・日付（session_date）を後から修正できるようにする。
6. **統計画面**: コール曲の統計・セットリスト全体の統計を分析する画面を追加。店/母店・季節などで絞り込みできる。
7. **セッション詳細記録＋メモ移行**: セッションごとに「パート別参加者数（リスナー数含む）」「ホストのパート」「自由メモ」を記録できるようにする。加えて、既存の iPhone メモ（下記フォーマット）を取り込む移行経路を用意する。
8. **バージョン番号ルール導入**: `docs/version_number.md` に従い SSOT 定数と画面表示を導入。表示箇所は elaborate でユーザー確認。
9. **ダークモード導入**: `docs/dark_mode.md` に従いクラス方式のダークモードを導入。トグルUIの配置・配色は elaborate でユーザー確認。

## Previous Intent Reference

This intent iterates on **next-call — ジャズセッション向け選曲提案アプリ MVP** (`next-call-mvp`).

### What was built previously

MVP は 9 ユニット全て completed:

- unit-01 app-foundation（Next.js App Router + TS + Tailwind + shadcn/ui、Auth.js、SQLite + Drizzle 基盤）
- unit-02 recommendation-engine（9ステージ純関数パイプライン、tdd）
- unit-03 master-session-api（曲/楽器/店舗マスタ・セッション・演奏記録API）
- unit-04 recommendation-api（推薦API・条件別ブランチ・繰り返し減点）
- unit-05 session-screen（セッション記録のモバイルUI）
- unit-06 recommend-screen（「次の曲を考える」画面・意図スライダー・候補表示）
- unit-07 master-settings-screen（マスタ・設定編集画面）
- unit-08 csv-import-api（songs.csv / setlists.csv 一括取込）
- unit-09 infra-deploy（Docker + GitHub Actions 自動デプロイ、週次バックアップ）

主要エンティティ: Song / GenreTag / Instrument / Venue / Session / Performance / PerformanceFrontInstrument / SelectionIntent / RecommendationRequest / RecommendationCandidate / PendingSong / Setting。詳細は `.ai-dlc/next-call-mvp/intent.md` と `discovery.md`、一次仕様 `docs/jazz_session_song_recommendation_spec_v2.md`。

### What this iteration changes

上記スコープ 1〜9。既存エンティティの拡張（Session への参加者数・ホストパート・メモ、Performance の order_index 編集、Venue 修正）と新規の統計参照・メモ移行経路が中心。推薦エンジン（unit-02）のコアロジックは原則変更しない。

## Success Criteria

- [ ] セッション画面から推薦履歴へ戻る導線が動作する
- [ ] セットリストのフロント編成がカンマ区切りで表示される（内部データ順序は保持）
- [ ] セットリストの曲順を編集して保存でき、表示順に反映される
- [ ] セッションを削除でき、関連データの扱いが定義どおりになる
- [ ] セッションの店名・日付を修正して保存できる
- [ ] 統計画面でコール曲統計・セットリスト全体統計が表示され、店/母店・季節で絞り込みできる
- [ ] セッションのパート別参加者数（リスナー数含む）・ホストのパート・メモを記録できる
- [ ] 既存 iPhone メモ形式のセッション記録を移行（取込）できる
- [ ] バージョン番号が SSOT 定数から画面に表示され、UI変更時の更新ルールが整備される
- [ ] ダークモードがクラス方式で動作し、FOUC が発生しない。トグルで切替・永続化される
- [ ] typecheck / lint / test / build が CI で全てパスし、追加/改修画面が docs/design_rule.md に準拠する

## Context

- 一次資料: `docs/version_number.md`（バージョン番号ルール）、`docs/dark_mode.md`（ダークモードルール）、`docs/jazz_session_song_recommendation_spec_v2.md`（元仕様）、`docs/design_rule.md`（デザインルール）。
- 添付テンプレートは Iconizer 由来の汎用ルール。表示箇所・配色などアプリ固有の決定は elaborate 段階でユーザー確認する。
- ダークモードの具体配色は本アプリのベースカラーから設計する（`docs/dark_mode.md` 第5節）。

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
3. It Could Happen To You (tp, g)
...
14. Giant Steps (as, g) 🎷🔰 ※Key=C
...

🖋️Giant Stepsを初めてやった
```

- ヘッダ: 日付・店名、パート別人数（`tp1, as1, g4, pf2, b3, ds3` = パート+人数、リスナー含む想定）、ホストのパート、凡例、全体メモ。
- 各行: 曲順・曲名・(フロント編成)・記号（🎷/🎹=演奏、👆=曲指定/コール、🔰=初）・補足（※pfなし、※Key=C 等）。
- 表記揺れ・記号・別名の吸収は移行経路のプレビュー/警告で対応（詳細は elaborate）。
