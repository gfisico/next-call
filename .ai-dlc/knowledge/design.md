---
type: design
version: 1
created: 2026-07-12T06:53:14Z
last_updated: 2026-07-12T06:53:14Z
source: user-provided
confidence: high
project_maturity: greenfield
---

# Design Knowledge

ユーザー提供の design_rule.md（Tailwind CSS + shadcn/ui 前提のデザインルール）をこのプロジェクトのデザインシステムとして採用する。
一次情報: docs/design_rule.md（本文を以下に転載）。

# design_rule.md — StackStock UI/UX Design Rules（Tailwind + shadcn/ui 前提）

このドキュメントは **社内向け管理アプリ（StackStock）** の UI/UX を一貫させるためのデザインルールです。  
実装は **Tailwind CSS + shadcn/ui** を前提にし、**クラス名（コピペ可）**まで具体化します。

---

## 0. 基本方針

- **見やすさ最優先**：装飾より情報の読み取り速度を優先する
- **色は意味のために使う**：状態（成功/警告/危険/情報）を伝える用途に限定
- **余白で関係性を作る**：近い＝関連、遠い＝別グループ
- **操作は迷わせない**：Primaryは常に1つ、危険操作は強調
- **アクセシビリティは標準**：キーボード操作/フォーカス可視化/コントラストを必須とする

---

## 1. カラーシステム（Light/Dark 対応）

### 1.1 カラートークン（CSS変数）

> shadcn/ui の標準（`bg-background` 等）に合わせたトークン命名。  
> 実際の値（HSL）はプロジェクトの `globals.css`（または `app/globals.css`）に定義する。

**必須トークン**
- `--background` / `--foreground`
- `--card` / `--card-foreground`
- `--popover` / `--popover-foreground`
- `--muted` / `--muted-foreground`
- `--border` / `--input` / `--ring`
- `--primary` / `--primary-foreground`
- `--secondary` / `--secondary-foreground`
- `--accent` / `--accent-foreground`
- `--destructive` / `--destructive-foreground`

**状態（semantic）トークン（推奨）**
- `--success` / `--success-foreground`
- `--warning` / `--warning-foreground`
- `--info` / `--info-foreground`

> shadcn/ui のデフォルトには success/warning/info がないため、必要なら追加する。

### 1.2 色の使い分けルール

- **Primary（主ボタン/重要アクション）**：`bg-primary text-primary-foreground`
- **Danger（削除/破壊的操作）**：`bg-destructive text-destructive-foreground`
- **背景**：ページ `bg-background`、カード `bg-card`
- **境界線**：`border-border` を基本
- **本文**：`text-foreground`、補助 `text-muted-foreground`

### 1.3 具体クラス例（コピペ）

- ページ背景：`bg-background text-foreground`
- セカンダリ背景（テーブルのヘッダ等）：`bg-muted/50`
- カード：`bg-card text-card-foreground border border-border`
- 罫線：`border-border`
- 補助テキスト：`text-muted-foreground`

---

## 2. タイポグラフィ

### 2.1 フォント方針
- 基本：OS標準（Tailwind `font-sans`）
- ID/URL/CVE/ログ：等幅（Tailwind `font-mono`）

### 2.2 文字サイズ（標準スケール）

| 用途 | クラス |
|---|---|
| ページタイトル | `text-2xl font-semibold tracking-tight` |
| セクション見出し | `text-lg font-semibold` |
| サブ見出し | `text-base font-semibold` |
| 本文 | `text-sm leading-6` |
| 補助 | `text-xs text-muted-foreground` |
| 数値/コード | `text-xs font-mono text-muted-foreground` |

### 2.3 行間・折返し
- 文章は `leading-6` を基本
- URL/長い文字列は `break-all` ではなく、可能なら **省略＋ツールチップ**（UIで対応）
- テーブルは `whitespace-nowrap` を多用しすぎない（横スクロールは許容）

---

## 3. 余白・間隔（Spacing）

### 3.1 基準
- **4px刻み（Tailwindのスケール）**で統一
- 基本は `p-4` / `gap-4` / `space-y-4`

### 3.2 ルール
- ページ外側：`px-6 py-6`（狭い画面は `px-4`）
- セクション間：`space-y-6`
- カード内：`p-4`（密なリストは `p-3`）
- フォーム：ラベルと入力の間 `gap-2`、項目間 `gap-4`

---

## 4. 角丸（Radius）

統一した角丸で一貫性を出す。

- ボタン/入力：`rounded-lg`
- カード：`rounded-xl`
- モーダル/シート：`rounded-2xl`
- バッジ：`rounded-full`

---

## 5. 影（Shadow）

影は「階層」を示すためだけに使う。乱用しない。

- 通常カード：`shadow-sm`
- 強調カード/ドロップダウン：`shadow-md`
- モーダル：`shadow-lg`

> 基本は「枠線 + 薄い影」。影だけで分離しない（境界線も併用）。

---

## 6. コンポーネント設計（実装クラス付き）

### 6.1 Button（ボタン）

#### Primary
- `inline-flex items-center justify-center gap-2`
- `h-10 px-4 rounded-lg`
- `bg-primary text-primary-foreground hover:bg-primary/90`
- `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- `disabled:opacity-50 disabled:pointer-events-none`

例：
```html
<button class="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none">
  Save
</button>
```

#### Secondary
- `bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border`

#### Ghost（軽い操作）
- `bg-transparent hover:bg-accent hover:text-accent-foreground`

#### Destructive
- `bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive`

### 6.2 Card（カード）

構造：
- Wrapper：`rounded-xl border border-border bg-card text-card-foreground shadow-sm`
- Header：`p-4 border-b border-border`
- Body：`p-4 space-y-3`
- Footer：`p-4 border-t border-border`

例：
```html
<section class="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
  <header class="p-4 border-b border-border">
    <h2 class="text-base font-semibold">Project</h2>
  </header>
  <div class="p-4 space-y-3">
    ...
  </div>
</section>
```

### 6.3 Badge（状態バッジ）

共通：
- `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border`

Info：
- `bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300`

Warning：
- `bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300`

Danger：
- `bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300`

Success：
- `bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300`

> ここは暫定で Tailwind の色名を使用。後で semantic token 化してもよい。

### 6.4 Input（入力）

- Wrapper：`grid gap-2`
- Label：`text-sm font-medium`
- Input：`h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm`
- Focus：`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- Help：`text-xs text-muted-foreground`

例：
```html
<div class="grid gap-2">
  <label class="text-sm font-medium">URL</label>
  <input class="h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
  <p class="text-xs text-muted-foreground">公式URLを入力</p>
</div>
```

### 6.5 Table（テーブル）

- Wrapper：`overflow-x-auto rounded-xl border border-border`
- Table：`min-w-full text-sm`
- Thead：`bg-muted/50`
- Th：`px-4 py-3 text-left font-medium text-muted-foreground`
- Td：`px-4 py-3 align-top`
- Row hover：`hover:bg-accent/50`

例：
```html
<div class="overflow-x-auto rounded-xl border border-border">
  <table class="min-w-full text-sm">
    <thead class="bg-muted/50">
      <tr>
        <th class="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
        ...
      </tr>
    </thead>
    <tbody>
      <tr class="hover:bg-accent/50">
        <td class="px-4 py-3">...</td>
      </tr>
    </tbody>
  </table>
</div>
```

### 6.6 Modal / Dialog（モーダル）
- Overlay：`bg-black/50`
- Panel：`rounded-2xl bg-card border border-border shadow-lg p-6`
- Title：`text-lg font-semibold`
- Actions：`flex justify-end gap-2 mt-6`

※ shadcn/ui の Dialog を利用するのが基本。

---

## 7. レイアウト指針（このアプリ特化）

### 7.1 主要画面の情報密度
- **一覧**（提案一覧/プロジェクト一覧）：テーブル＋フィルタが主
- **詳細**（StackItem/Project）：カードでセクション分割
- **タイムライン**：重要度（Info/Warning/Danger）をバッジで即判別

### 7.2 ダッシュボード（推奨ウィジェット）
- 未処理提案数（PENDING）
- 直近のリンク異常（404/5xx）
- 直近の承認/却下
- フォロー中プロジェクトの新着イベント

---

## 8. アクセシビリティ

### 8.1 キーボード操作
- 全操作はキーボードで到達可能にする（Tab順序を崩さない）
- フォーカス表示は必須：`focus-visible:ring-2 ...` を標準化

### 8.2 色だけに依存しない
- 状態は **色 + テキスト +（可能なら）アイコン**で表現する  
  例：`Danger` は「Critical」「要対応」等のラベル併用

### 8.3 タップ領域
- ボタン高さ `h-10` を基本（小さくしない）
- クリック可能領域は余白込みで確保

### 8.4 コントラスト
- 文字色は `text-foreground` / `text-muted-foreground` を基本とし、背景とのコントラストが不足する組み合わせは禁止
- バッジの薄い背景はダークモードで見えにくくなりがちなので `dark:` の文字色を必ず用意

### 8.5 文字拡大耐性
- `leading-6` と余白の確保で、文字サイズが上がっても崩れにくくする
- テーブルは `overflow-x-auto` を許容し、折返しで壊さない

---

## 9. ルール運用（開発時のチェック項目）
- Primaryボタンは画面内に原則1つ
- 破壊的操作（削除/無効化）は必ず Destructive スタイル
- 新しいUI部品を作るときは、まずこのドキュメントの標準クラスを再利用する
- 例外的にクラスを追加する場合は「なぜ標準で足りないか」をコメントで残す（任意）

---

## 10. 将来拡張（メモ）
- status/success/warning/info を shadcn/ui の theme token として統合
- カラーパレットを社内ブランド色に調整（primaryのみ差し替えで済む設計にしてある）
