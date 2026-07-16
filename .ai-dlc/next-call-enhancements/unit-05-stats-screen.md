---
status: completed
last_updated: "2026-07-16T05:34:51Z"
depends_on: [unit-04-stats-api]
branch: ai-dlc/next-call-enhancements/05-stats-screen
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: ["/stats"]
---

# unit-05-stats-screen

## Description
統計画面を新設する。unit-04 の統計 API を用いて、コール曲統計・セットリスト全体統計を表示し、店/母店・季節で絞り込む。ボトムナビに統計への導線を追加する。要件6のフロント。

## Discipline
frontend - 新規ページ（`src/app/(main)/stats` 等）・統計コンポーネント（`src/components`）・ナビ（`src/components/shell/bottom-nav.tsx`）を実装する。

## Domain Entities
統計表示用の集計データ（曲別コール/演奏回数・最終演奏日、ジャンル/キー/構成の分布、季節/店/母店別傾向、月別推移）。絞り込み軸: Venue（店/母店/母店以外/全体）・season。

## Data Sources
- unit-04 API: `GET /api/stats`（絞り込みクエリ付き）。レスポンス型を unit-04 と共有。

## Technical Specification
1. **統計ページ**（新ルート、モバイル対応）: セクション構成
   - 曲別: コール回数/演奏回数/最終演奏日のランキング表（ソート・「久しぶりの曲」抽出）。
   - 分布: ジャンル別・キー別・構成別の割合（バー/リスト）。
   - 傾向: 季節別・店別・母店/母店以外別の比較。
   - 期間推移: 月別の演奏曲数・新曲率の推移。
2. **絞り込みUI**: 店（全体/母店/母店以外/個別店）・季節（ALL/春夏秋冬）のフィルタ。変更で API 再取得。
3. **ナビ導線**: `bottom-nav.tsx` に統計タブ/項目を追加（既存ナビ構造・アイコン規約に合わせる）。
4. 可視化はシンプルで可読性優先（数百件の表・簡易バー）。空データ/読込中/失敗の状態を用意。
5. docs/design_rule.md 準拠、デザイントークンのみ使用（raw hex 禁止）、ダークモードで破綻しないこと。チャート色はトークン/コントラスト基準に従う。

## Success Criteria
- [ ] 統計ページで 曲別（コール/演奏回数・最終演奏日）・分布（ジャンル/キー/構成）・傾向（季節/店/母店）・月別推移 が表示される
- [ ] 店（全体/母店/母店以外）・季節での絞り込みが表示に反映される
- [ ] ボトムナビから統計画面へ遷移できる
- [ ] 空状態・読込中・エラーが適切に表示される
- [ ] docs/design_rule.md 準拠・モバイル可読。ダーク/ライト両方で崩れない。typecheck / lint / test / build がパスする

## Risks
- **ナビの過密**: モバイルのボトムナビ項目増。Mitigation: 既存ナビの収まりを確認し、必要なら「その他」へ寄せる等 design_rule に沿う。
- **チャートの色とコントラスト**: Mitigation: トークン由来色・WCAG コントラストで選ぶ。
- **大量データの表描画**: Mitigation: 集計は API 側で完結（unit-04）、UI は表示に専念。

## Boundaries
集計ロジック・API は実装しない（unit-04）。セッション画面（`session-record-screen.tsx`）・ヘッダー・設定画面は編集しない。ダークモード機構は unit-06。depends_on: unit-04。

## Notes
- `bottom-nav.tsx` はこのユニットが編集する（unit-06 はヘッダーのみ、競合しない）。
- レスポンス型は unit-04 の定義を import する。
