# 実行計画 — unit-06-theme-and-version（frontend / Bolt 1）

要件9（ダークモード切替機構・FOUC防止・トグル・localStorage永続化）＋ 要件8（バージョン番号 SSOT）を1ボルトで実装する。既存の `.dark` 配色トークンは完成済みのため「切替の仕組み」と「バージョン表示」だけを載せる。

## 前提確認（実コードで確認済み）

- **globals.css**: `@custom-variant dark (&:is(.dark *));`（Tailwind v4 クラス方式）と `:root`／`.dark` 両方のトークンが定義済み。**新規に配色は追加しない**。
- **ダークトークンの WCAG**: `.dark` は `--foreground: oklch(0.985 0 0)` / `--background: oklch(0.145 0 0)` で本文コントラスト十分（AA 4.5:1 超）。トグルは `text-foreground` / `border-border` / `hover:bg-accent` 等 **既存トークンのみ**参照（`--color-surface` は存在しないので使わない）。
- **root layout**: `src/app/layout.tsx` は Server Component。現状 `<html lang="ja">` 直下に `<body>` のみで、明示的な `<head>` は無い（metadata API 管理）。
- **app全体ヘッダー**: `src/app/(main)/layout.tsx` の `<header>` 内 `<div className="mx-auto flex h-12 max-w-lg items-center px-4">` に `next-call` の `<span>` のみ。右側は空 → ここにトグルを置く。
- **アイコン/依存**: `lucide-react`（`Sun`/`Moon` 利用可）と `next-themes` は導入済み。**`next-themes` は `src/components/ui/sonner.tsx` の `useTheme()` でのみ使用**、`ThemeProvider` は未マウント（`theme="system"` 既定で動作）。→ 本ユニットは next-themes を採用しない（後述「不採用理由」）。
- **設定画面**: `src/components/master/settings-screen.tsx`（`/settings` で描画）。末尾「データ管理」セクションの下にバージョンを表示する。
- **export.ts の version**: `src/server/repositories/export.ts` の `schema_version` はエクスポート JSON のスキーマ版で **別概念**。SSOT を共有しない・触らない。
- **テスト基盤**: vitest projects 構成。`node`=`tests/**/*.test.ts`（environment=node）、`dom`=`tests/components/**/*.test.tsx`（environment=jsdom, setup=`tests/setup/dom.ts`）。`dom.ts` は `matchMedia` を `matches:false` で polyfill 済み、`afterEach` で `cleanup()`＋`vi.unstubAllGlobals()`。localStorage は jsdom で利用可。

## 設計判断

### 単一の判定ロジック／キー（FOUC・初期化・トグルで共有）
- **ストレージキー**: `next-call-dark-mode`（唯一の定義 = `THEME_STORAGE_KEY` 定数）。
- **保存値形式**: 真偽値文字列 `'true'` / `'false'`（docs/dark_mode.md §3-2）。
- **判定条件（初期テーマ）**: `saved === 'true' || (saved === null && matchMedia('(prefers-color-scheme: dark)').matches)`。保存値優先→無ければ OS。一度切り替えたら永続化して以降 OS 追従しない。
- FOUC インラインスクリプトは import 不可のため条件式を文字列で持つが、**キーは `THEME_STORAGE_KEY` をテンプレートリテラルで埋め込み**、条件式は同一ファイル `src/lib/theme.ts` 内にフック用ロジックと隣接配置して「一致」を担保する（docs/dark_mode.md §3-4 の重複ロジックは意図的）。

### FOUC スクリプトの注入方法（Next App Router）
- `src/app/layout.tsx`（Server Component）に**明示的な `<head>` を追加**し、その中に生インライン `<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />` を置く。`THEME_INIT_SCRIPT` は `src/lib/theme.ts` からの静的文字列。
  - 生インラインスクリプト（src 無し）は React に hoist されず、head 内で同期実行 → 初回ペイント前に `<html>` へ `.dark` を先付け → FOUC なし。
  - CSS `<link>` との前後順は FOUC に無関係（両方 head 内・スクリプトは同期・ペイントは両者処理後）。criterion の「head 初期スクリプト」を満たす。
- **不採用**: `next/script strategy="beforeInteractive"`（framework スクリプトとの順序クセ・インライン用途で過剰）。フォールバック案として `<body>` 先頭配置も可（ペイント前実行は成立）だが head 配置を第一候補とする。

### モジュール構成（server/client 分離）
- `src/lib/theme.ts`（**"use client" 無し** = server から import 可）: `THEME_STORAGE_KEY`、`THEME_INIT_SCRIPT`（文字列）、`getInitialDark(): boolean`、`applyDark(isDark: boolean): void`（`documentElement.classList.toggle('dark', isDark)` ＋ localStorage 保存を try/catch）。localStorage/matchMedia 参照は try/catch と `typeof window` ガードで保護。
- `src/lib/use-dark-mode.ts`（**"use client"**）: `useDarkMode()` フック。`useState(getInitialDark)` + `useEffect` で同期、`toggle()` で状態反転→`applyDark()`。永続化と DOM 反映を1フック/ユーティリティに集約（docs §3-3）。
- server layout は `theme.ts` の文字列/キーのみ import（フック client モジュールは import しない）。

### バージョン SSOT
- `src/version.ts`（新設）: `export const APP_VERSION = 'v20260716-01'`（JST 2026-07-16、本インテント初回リリース）。定数1つだけ export。
- 表示は settings-screen で `import { APP_VERSION } from "@/version"` → 文字列ハードコード禁止。`schema_version` とは命名・置き場所で明確分離。

### next-themes 不採用理由（不採用案の記録）
docs/dark_mode.md はキー名・値形式 `'true'/'false'`・判定条件の「初期化/トグル/FOUC 完全一致」を明示要求。next-themes は既定キー `theme`・値がテーマ名（`dark`/`light`/`system`）で形式が異なり、独自スクリプトを注入するため、`ThemeProvider` を追加すると **FOUC スクリプト二重化＋テーマの真実源の二重化**を招く。手書き実装が governing doc に忠実で検証可能。→ `ThemeProvider` は追加しない。sonner の `useTheme()`（`theme="system"` 既定）は既存挙動として据え置き（リスク欄参照）。

## タスクチェックリスト（成功基準への対応）

- [ ] **T1** `src/lib/theme.ts` 新設（キー定数・FOUC 文字列・`getInitialDark`・`applyDark`、全 try/catch＋window ガード） → 基準3,5 の土台
- [ ] **T2** `src/lib/use-dark-mode.ts` 新設（`useDarkMode` フック、状態反転→`applyDark`→永続化を集約） → 基準1,2,5
- [ ] **T3** `src/app/layout.tsx` に `<head>`＋インライン `THEME_INIT_SCRIPT` 注入 → 基準3（FOUC・条件/キー一致）
- [ ] **T4** `src/components/shell/theme-toggle.tsx` 新設（"use client"、`useDarkMode`、`Sun`/`Moon` 切替、`aria-label` 状態連動「ダークモードに切替」/「ライトモードに切替」、既存トークンのみ、`h-10` 以上タップ域・focus-visible ring） → 基準1,4
- [ ] **T5** `src/app/(main)/layout.tsx` ヘッダー右上に `<ThemeToggle />` 配置（`div` に `justify-between` 追加） → 基準1
- [ ] **T6** `src/version.ts` 新設（`APP_VERSION='v20260716-01'`） → 基準6
- [ ] **T7** `settings-screen.tsx` 末尾にバージョン表示（`import { APP_VERSION }`、`text-xs text-muted-foreground`） → 基準6
- [ ] **T8** テスト追加（下記） → 基準1,2,4,5,6
- [ ] **T9** `npm run test`／typecheck／lint／build パス、docs/design_rule.md 準拠確認 → 基準7

### 成功基準トレース
1. トグルで `<html>.dark` 付け外し → T2,T4,T5 / test1
2. localStorage 永続化・再読込/別画面維持・未保存時 OS フォールバック → T1,T2 / test2,test3
3. FOUC 防止・条件/キー一致 → T1,T3（単一定義共有）
4. `aria-label` 状態連動・アイコン切替・WCAG AA → T4（既存 `.dark` トークンで AA 充足）/ test4
5. localStorage 例外時も try/catch で停止しない → T1,T2 / test5
6. `src/version.ts` SSOT を設定画面に `vYYYYMMDD-NN` で import 表示 → T6,T7 / test6
7. typecheck/lint/test/build パス・design_rule 準拠 → T9

## テスト計画（`tests/components/*.test.tsx` = jsdom project）

logic テストも window/localStorage を要するため **必ず `.test.tsx` を `tests/components/` 配下**に置く（`.test.ts` は node project で拾われ window 未定義で落ちる）。

- **`tests/components/theme-toggle.test.tsx`**
  - test1: レンダ→ボタン click で `document.documentElement.classList.contains('dark')` が反転し、`localStorage.getItem('next-call-dark-mode')` が `'true'`/`'false'` に更新。
  - test4: `aria-label` が状態で「ダークモードに切替」⇔「ライトモードに切替」に切替、`Sun`/`Moon` の描画切替（アイコンは `data-testid` かアクセシブル名で判定）。
  - test5: `vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error() })` で click してもスローせずクラスは反映（機能停止しない）。
- **`tests/components/theme-init.test.tsx`**（`getInitialDark`）
  - test2/test3: `localStorage.setItem(key,'true')`→true、`'false'`→false、未保存＋`matchMedia` matches=true→true。**matchMedia 上書き**は `vi.stubGlobal('matchMedia', () => ({ matches: true, ... }))`（`dom.ts` の既定 `matches:false` を上書き。`afterEach` の `unstubAllGlobals` で復元）。各 test 冒頭で `localStorage.clear()`／`documentElement.classList.remove('dark')`。
- **バージョン表示**: `tests/components/settings.test.tsx` に1ケース追記（既存の mock/`renderWithSWR` を流用）either → `screen.getByText('v20260716-01')` が存在、かつ import 由来であることを担保。あるいは軽量に `tests/components/app-version.test.tsx` を新設し `expect(APP_VERSION).toMatch(/^v\d{8}-\d{2}$/)` ＋描画確認。既存テスト流用を優先。

## リスク / 前提

- **FOUC 再発**: 条件式/キーが初期化/トグル/スクリプトでズレるとチラつく。→ キーは `THEME_STORAGE_KEY` 単一定義、条件式は `theme.ts` 内に隣接配置し docs/dark_mode.md §6 チェックリストで検証。
- **jsdom の matchMedia/localStorage**: `dom.ts` は `matches:false` 固定。prefers-dark 経路は `vi.stubGlobal` で明示上書きが必要（`afterEach` 復元前提）。localStorage は利用可だが test 間の状態リークに注意→各 test で `clear()`／class リセット。
- **sonner の theme 不整合（既存・スコープ外）**: `sonner.tsx` は `next-themes` の `useTheme()`（Provider 無しで `"system"`）を使うため、ユーザーが手動でダークにしても OS がライトだとトースト配色は system 追従のまま。本ユニットは機構＋トグル＋バージョンに限定（Boundaries）ため据え置き。必要なら別途 sonner を `document.documentElement.classList` 参照に寄せる案があることを注記（今回は変更しない）。
- **未定義トークン参照**: トグルで使う `border`/`foreground`/`accent`/`muted`/`ring` は `:root`/`.dark` 両方に定義済み（確認済み）。`--color-surface` 等は存在しないので使わない。
- **Server/Client 境界**: root layout（server）が client フックモジュールを import しないよう `theme.ts`（非 client）と `use-dark-mode.ts`（client）を分離。
- **バージョン更新義務**: 本ユニットで UI を変更するため `APP_VERSION` を導入日値 `v20260716-01` に設定（docs/version_number.md §3）。
- **Boundaries 厳守**: セッション画面(03)・統計/ボトムナビ(05)・API/スキーマ(01/02/04) は編集しない。globals.css は既存トークン値を変更しない（切替補助が必要な場合のみ、今回は不要見込み）。

## 検証コマンド（T9）
```
npm run test        # vitest run（node + dom）
npx tsc --noEmit    # typecheck（または既存 lint/typecheck スクリプト）
npm run lint
npm run build
```
