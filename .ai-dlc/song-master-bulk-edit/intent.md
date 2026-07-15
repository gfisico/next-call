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
created: 2026-07-15
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

# 演奏難易度のマスタ導入・simple_form 廃止・全曲一括編集（Google Sheets）

## Problem

曲マスタの属性（特に「攻め方」＝安全性軸や初心者対応に効く項目）が初回移行時の既定値のままで未整備。曲マスタ編集画面（unit-07）で1件ずつ設定するのは全曲規模で高負荷。CSV を人が直接編集するのは非現実的で、コード値（`AABA`/`BLUES12`/`SPRING`/真偽 `1`・`0`/ジャンル名）を覚えたくない。編集は Google Sheets で行いたい。

さらに、選曲の「攻め方」を判断する客観的な拠り所が無い。既存の `simple_form`（構成が単純）は主観的で運用しづらく、代わりに **演奏難易度** を一級のマスタ属性として持ち、安全性軸・初心者対応をこれに移行したい。黒本1掲載曲は演奏難易度の判定に外部参照（thetrumpetschool.com）を叩き台として使いたい。

## Solution

`songs` に `difficulty`（整数 1–5, nullable=未判定）を追加し、`simple_form` を廃止（DB列は残しロジック撤去）。推薦エンジンの安全性スコア（§9.4）と初心者対応（§8.2/§12.1）を difficulty ベースへ移行する。曲マスタ編集画面に difficulty 入力を追加する。

一括編集は「Google Sheets 互換の編集用 xlsx を生成 → Sheets で編集 → 変換スクリプトで songs.csv 生成 → 既存インポート（unit-08）で全曲更新」というワークフローを追加する。人の編集面（ラベル＋ドロップダウン、コード暗記不要）と、システム取り込み面（CSV）を分離する。黒本1曲には演奏難易度の叩き台（外部参照由来）を編集・インポート対象外の参考列として付与する。

DB スキーマは追加的マイグレーションのみ（列削除・改名なし）。AI による自動判定は行わず、固定ロジック・利用者判断という MVP の設計思想を踏襲する。

## Domain Model

前作 next-call-mvp のドメインを継承。詳細は本 intent の `discovery.md` および一次仕様 `docs/jazz_session_song_recommendation_spec_v2.md`。

### Entities
- **Song（曲マスター, `src/db/schema.ts:27-83`）** — 編集対象の全項目 = songs.csv インポート互換列。本 intent で **`difficulty`(1-5, nullable) を追加**、**`simpleForm` を廃止**（列は残すが型・Zod・エンジン・UI・インポートから撤去）。
  主な編集項目: title(照合キー/保護), song_key, form, composer, has_played, no_chart_ok, is_standard, in_kurobon1, season, listener_level, energy_level, **difficulty**, genres(9種), note。
- **EngineSong（`src/engine/types.ts`）** — 推薦入力用の投影。`difficulty: number | null` を追加、`simpleForm` を削除。

### Relationships
- Song N—M GenreTag（不変）。

### Data Sources
- **docs/やれる曲.xlsx [list]シート** — A列=曲名(正), O列「#1」="■"=黒本1(227曲)。編集用 xlsx 生成の現在値ソース（主経路）。
- **現行DB**（SQLite, `src/db/client.ts` getDb()/DATABASE_PATH, 既定 ./data/next-call.db）— 副経路。
- **既存インポート(unit-08, `src/server/import/`)** — songs.csv を title 一致で更新。
- **外部参照** thetrumpetschool.com「ジャズスタンダードバイブル トランペットで全部」全45記事 — 黒本1約225曲の演奏難易度（初級-〜上級+の9段階）＋一言コメント。

### Data Gaps
- ローカルDB不在 → 生成スクリプトは [list] フォールバックを主経路にしつつ getDb() 対応も実装。
- 非黒本1曲・未判定曲の difficulty は null（未判定）。エンジンは null を安全側/中立で扱う。
- 難易度 9段階→1-5 の写像表が必要（unit-05 で定義。例: 初級-/初級=1, 初級+/中級-=2, 中級=3, 中級+/上級-=4, 上級/上級+=5。最終確定は unit-05）。

## Success Criteria
- [ ] `songs` に `difficulty`（整数1-5, nullable）を追加的マイグレーションで追加。Zod・api types・engine types・build-input に反映。
- [ ] `simple_form` を廃止（DB列は残しロジック撤去）: エンジン・編集画面・インポート・Zod から撤去。
- [ ] 安全性スコア(§9.4): `simple_form(+2)` を除去し difficulty を低難易度=安全側に組み込む（null=中立）。seed `engine.safety_weights` と仕様を更新。
- [ ] 初心者対応(§8.2/§12.1): 初心者PRESENT時は difficulty≤2 の曲のみ通過（null=評価不能→除外）。predicates/exclude/仕様を更新。
- [ ] 曲マスタ編集画面(unit-07)に difficulty(1-5)入力を追加、「構成が単純」を削除。
- [ ] 難易度叩き台データ: thetrumpetschool.com 全45記事から黒本1各曲の演奏難易度(9段階)＋コメントを収集し、1-5へ写像した参照データを生成。
- [ ] 編集用 xlsx 生成: 全曲・全編集項目（difficulty含む/simple_form除外）を現在値で事前入力。コード暗記不要（ドロップダウン・9列✓）、title保護。黒本1に難易度叩き台＋コメント＋攻め方目安を参考列付与。
- [ ] 変換スクリプト: 編集後xlsx→songs.csv（difficulty含む/simple_form除外）。ラベル→コード解決、不正値は行番号付き検出で中断。既存インポートがtitle一致で全曲更新。
- [ ] データ整合性: 未編集項目は往復で不変。変換ロジックにユニットテスト。
- [ ] quality gates（typecheck/lint/test/build）通過。手順書整備。

## Context
- 「攻め方」スライダー = 仕様§9.4 安全性軸（安全に行く↔攻める, `src/components/session/recommend-screen.tsx:391-393`）。safety_score は `src/engine/score.ts:50-59`、seed weights は `src/db/seed.ts:57-71`。
- 初心者対応の現ルール: `is_standard AND no_chart_ok AND simple_form`（`src/engine/predicates.ts:21`, `exclude.ts`）→ 本 intent で `difficulty <= 2` へ移行。
- 曲名は本アプリのデータ（[list]・DB）を正とし、参照サイト曲名は `src/lib/normalize-title.ts` の normalizeTitle で正規化突合。
- 対象は全曲（難易度参考列は黒本1のみ付与）。人が直接編集するのは Google Sheets（xlsx 経由）のみ。CSV は変換スクリプトが生成する中間フォーマット。
- git: 1PR（intent戦略, auto_merge）。hybrid 個別PR は使わない（ユーザー明示）。
