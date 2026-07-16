---
status: completed
last_updated: "2026-07-16T05:55:04Z"
depends_on: []
branch: ai-dlc/next-call-enhancements/06-theme-and-version
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-06-theme-and-version

## Description
UI 運用基盤の2件をまとめて担う。(1) ダークモードの付け外し機構・FOUC 防止・トグルUI・localStorage 永続化（要件9）、(2) バージョン番号 SSOT の導入とマスタ設定画面への表示（要件8）。既存のダークトークン土台の上に「切替の仕組み」だけを載せる。

## Discipline
frontend - ルートレイアウト（`src/app/(main)/layout.tsx`・ルート `layout.tsx`）・ヘッダー/shell（`src/components/shell`）・設定画面（`settings-screen.tsx`）・`src/version.ts`（新設）を実装する。

## Domain Entities
なし（DB 非対象）。UI 状態（テーマ）とアプリ定数（バージョン）のみ。

## Data Sources
- localStorage（テーマ永続化）。ストレージキーは一意名（例 `next-call-dark-mode`）を1つ定義し、初期化・トグル・FOUC スクリプトで共有。
- `src/version.ts` の `APP_VERSION` 定数（唯一の正）。

## Technical Specification
### ダークモード（docs/dark_mode.md 準拠）
- 切替はクラス方式（`<html>` に `.dark`）。Tailwind v4 のクラス方式は導入済み、globals.css の `.dark` トークンも完成済み → 新規に配色は定義しない。
- **FOUC 防止**: ルート `<head>` 先頭（CSS 読込より前）にインラインスクリプトを置き、`localStorage[key]==='true'` または（未保存 && `prefers-color-scheme: dark`）で `.dark` を先付け。判定条件・キーは初期化/トグルと完全一致。
- **初期化順**: 保存値優先 → 無ければ `prefers-color-scheme`。一度切り替えたら永続化して以降 OS 追従しない。
- **トグルUI**: 全画面共通ヘッダー右上に配置。ライト/ダークでアイコン切替（太陽/月）、`aria-label` を状態連動（「ダークモードに切替」/「ライトモードに切替」）。スタイルはトークン（`--color-surface`/`--color-border` 等）参照、色直書き禁止。
- **永続化フック**: トグル→状態反転→`documentElement.classList.toggle('dark', isDark)`→localStorage 保存（try/catch）を1つのフック/ユーティリティに集約。ストレージ例外は握りつぶし機能停止しない。

### バージョン番号（docs/version_number.md 準拠）
- `src/version.ts` を新設し `export const APP_VERSION = 'vYYYYMMDD-NN'`（JST基準、初期値は導入日）。定数を1つだけ export。
- **マスタ設定画面のみ**に表示（`settings-screen.tsx`）。文字列ハードコードせず `import { APP_VERSION }` して描画。
- export.ts の `schema_version` 等、別概念の "version" と混同しない（SSOT 非共有）。

## Success Criteria
- [ ] ヘッダー右上トグルでライト/ダークが切り替わり、`<html>.dark` が付け外しされる
- [ ] テーマ選択が localStorage に永続化され、再読込・別画面でも維持される（未保存時は OS 設定にフォールバック）
- [ ] `<head>` 初期スクリプトにより初回描画でチラつき（FOUC）が発生しない。判定条件・キーが初期化/トグルと一致
- [ ] トグルの `aria-label` が状態連動し、アイコンが切り替わる。ダーク配色が WCAG AA（本文4.5:1）を満たす
- [ ] localStorage 例外時も try/catch で機能停止しない
- [ ] `src/version.ts` の SSOT 定数がマスタ設定画面に `vYYYYMMDD-NN` 形式で表示される（import 経由、ハードコードなし）
- [ ] typecheck / lint / test / build がパスし、docs/design_rule.md に準拠する

## Risks
- **FOUC の再発**: 初期スクリプトとフックの判定条件/キーがズレるとチラつく。Mitigation: キー・条件を単一定義から共有し docs/dark_mode.md のチェックリストで検証。
- **既存 `.dark` トークンの未定義参照**: Mitigation: 新規UIで参照するトークンが `:root`/`.dark` 両方に定義済みか確認。
- **バージョン概念の混同**: Mitigation: `schema_version` 等とは命名・置き場所で明確に分離。

## Boundaries
セッション画面（unit-03）・統計画面/ボトムナビ（unit-05）・API/スキーマ（unit-01/02/04）は編集しない。編集対象はヘッダー/shell・ルートレイアウト・`settings-screen.tsx`・`src/version.ts`・（必要なら globals.css への切替補助のみ、既存トークン値は変更しない）。depends_on: なし（独立・並行着手可）。

## Notes
- ダークの配色値は既存 globals.css を使う。テンプレート（docs/dark_mode.md 第5節）の例示値を流用しない。
- 他ユニットの新規UIもダークで破綻しないことは各ユニット側の責務。本ユニットは機構とトグル・バージョン表示に限定。
