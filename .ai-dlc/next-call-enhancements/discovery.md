---
intent: next-call-enhancements
created: 2026-07-16
status: active
iterates_on: next-call-mvp
---

# Discovery Log: next-call 機能拡張

Elaboration findings persisted during Phase 2.5 domain discovery.
Builders: read section headers for an overview, then dive into specific sections as needed.

一次資料: docs/jazz_session_song_recommendation_spec_v2.md, docs/design_rule.md,
docs/version_number.md（新規）, docs/dark_mode.md（新規）
前 intent: .ai-dlc/next-call-mvp/（intent.md / discovery.md / unit-01〜09）

---

# Phase 2.5 追記: 9件の拡張要件（影響ファイル / 現状 / 変更方針）

> 精読対象: src/db/schema.ts, src/app 配下, src/components, src/server, src/lib,
> src/app/layout.tsx, next.config.ts, src/app/globals.css, package.json, docs/*。
> すべて実ファイルの行位置に基づく。マイグレーションは additive 限定（schema.ts 冒頭規約 L5）。

## 要件1: 履歴導線（セッション画面 → 履歴一覧）

- **影響ファイル**
  - `src/components/session/session-record-screen.tsx`（L108-166 ヘッダ部）
  - `src/app/(main)/page.tsx`（ACTIVE 時に SessionRecordScreen を直接描画 L33-41）
  - 参考（既存の導線パターン）: `src/app/(main)/sessions/[id]/page.tsx` L51-55「‹ 履歴に戻る」、
    `src/components/session/recommend-screen.tsx` L270-275「‹ 次の曲を考える」
- **現状**
  - `/sessions/[id]`（履歴詳細）ではページラッパが `<Link href="/sessions">‹ 履歴に戻る</Link>` を持つ。
  - しかしホーム `/`（ACTIVE セッション）では SessionRecordScreen をそのまま描画するだけで、
    履歴一覧 `/sessions` への導線が無い。BottomNav の「セッション」は `/`（＝ACTIVE 記録画面）に戻るだけ
    （`src/components/shell/bottom-nav.tsx` L9）。「すべての履歴を見る →」リンクは ACTIVE が無いときの
    ホームにしか出ない（`page.tsx` L89-93）。
  - recommend 画面は戻り先がセッション詳細で、履歴一覧への直行導線は持たない。
- **変更方針**
  - SessionRecordScreen のヘッダ（L110-166）に履歴一覧 `/sessions` への Link を追加（recommend の
    戻りリンクと同じ字面・スタイル）。ACTIVE/ENDED 双方で表示するか、ACTIVE 時（ホーム）に限定するかは
    実装時に確認。データ・API 変更なし（純フロント）。

## 要件2: フロント編成表記（as→ts を as, ts へ）

- **影響ファイル**: `src/components/session/session-record-screen.tsx` **L210**
  - `フロント: {p.frontInstruments.map((f) => f.code).join(" → ")}`
- **現状**
  - 表示は 1 箇所のみ（grep 全走査で「 → 」区切りの編成生成はここだけ）。
  - データ順序は `performance_front_instruments.position`（schema.ts L219）で保持され、
    リポジトリが position 昇順で配列化する（`src/server/repositories/sessions.ts`
    `listPerformancesForSession` L56-77 / `frontInstruments` は `{code, position}`）。
  - recommend 画面・song-performance-sheet には編成の「→」表示は無い（編集は code チップ）。
- **変更方針**
  - L210 の `.join(" → ")` を `.join(", ")` に変更するだけ。内部データ順序（position）は不変、表示のみ。
  - スキーマ・API・リポジトリ変更なし。

## 要件3: 曲順編集（Performance.order_index の後編集）

- **影響ファイル**
  - `src/components/session/session-record-screen.tsx`（セットリスト `<ul>` L189-235。行に order を表示 L196-198）
  - `src/server/repositories/performances.ts`（`deletePerformance` L234-259 が既に 1..N 再採番ロジックを持つ＝再利用可）
  - `src/server/validation/performances.ts`（`performanceUpdateSchema` L43-46。**orderIndex を含まない**）
  - `src/app/api/performances/[id]/route.ts`（PATCH は fields のみ）/ 新設エンドポイント候補
    `src/app/api/sessions/[id]/performances/route.ts`（現状 POST のみ）
  - `src/lib/api/client.ts` / `src/lib/api/hooks.ts`（クライアント関数追加）
- **現状**
  - `performances.orderIndex` は max+1 採番（`addPerformance` L145-157）、削除時のみ 1..N 詰め直し。
    ユーザーによる並べ替え API・UI は存在しない。PATCH スキーマにも order は無い。
- **変更方針**
  - 並べ替え専用の一括更新を推奨（1件ずつ PATCH は order 一意制約と衝突しやすい）:
    新設 `reorderPerformances(sessionId, orderedIds[])` を performances.ts に追加し、トランザクション内で
    受領順に 1..N を再採番（deletePerformance L242-257 と同型のロジック）。
    エンドポイントは `PATCH /api/sessions/[id]/performances`（reorder body）か
    `POST .../performances/reorder`。UI はセットリスト各行に上/下ボタン（design_rule のタップ領域規約）。
  - スキーマ列変更なし（既存 orderIndex を使うのみ）。

## 要件4: セッション削除（物理削除＋確認ダイアログ、関連完全削除）

- **影響ファイル**
  - `src/app/api/sessions/[id]/route.ts`（現状 GET / PATCH のみ。**DELETE 無し**）
  - `src/server/repositories/sessions.ts`（**deleteSession 無し**）
  - `src/components/session/session-record-screen.tsx`（操作メニュー L141-163 は「セッションを終了」のみ）
  - `src/components/session/confirm-dialog.tsx`（`ConfirmDialog` は既存・削除確認に流用可。既に演奏行削除で使用 L303-314）
  - `src/lib/api/client.ts`（`deleteSession` 追加）
- **現状**
  - セッションを消す手段が無い。演奏行削除（`deletePerformance`）はあるがセッション本体は不可。
  - 関連: `performances`（FK session_id）→ `performance_front_instruments`（FK performance_id）、
    `recommendation_requests`（FK session_id）→ `recommendation_candidates`（FK request_id）。
    SQLite の FK は明示 cascade 定義が無い（schema.ts の references はデフォルト NO ACTION）ため、
    子から順に手動削除が必要。
- **変更方針**
  - `deleteSession(id)` をトランザクションで実装。削除順: candidates → requests →
    front_instruments → performances → **session_participants**（unit-02 で追加、`session_id` FK・notNull）→ session
    （`performanceFrontInstruments` は performance_id in (…) で一括）。`pending_songs` はセッション横断保持なので**削除しない**（決定事項）。
    **注意**: `src/db/client.ts` で `foreign_keys = ON`。unit-02 が追加する `session_participants` を削除しないと、参加者のあるセッション削除が FK 違反になる。unit-01 で構造を用意し、unit-02 が cascade に組み込む。
  - `DELETE /api/sessions/[id]` 追加（204）。UI は操作メニューに「セッションを削除」を追加し
    ConfirmDialog（confirmVariant="destructive"）。削除後は `/sessions` か `/` へ遷移＋SWR 再検証。

## 要件5: セッション基本情報の修正（session_date / venue）

- **影響ファイル**
  - `src/server/validation/sessions.ts`（`sessionUpdateSchema` L18-25。現状 hasListeners / note / status(ENDED) のみ）
  - `src/server/repositories/sessions.ts`（`updateSession` L168-183 は `.set(patch)` 汎用なので列追加で流用可。
    ただし venueId 変更時は venue 存在検証が必要＝`startSession` L102-109 の検証を流用）
  - `src/app/api/sessions/[id]/route.ts`（PATCH ハンドラは schema 差し替えのみ）
  - UI: `src/components/session/session-record-screen.tsx`（編集導線）＋
    `src/components/session/start-session-sheet.tsx`（日付・店舗選択 UI 再利用元）
- **現状**
  - PATCH は session_date / venue_id を受け付けない（スキーマに無い）。開始後の日付・店舗訂正が不可能。
- **変更方針**
  - `sessionUpdateSchema` に `sessionDate`（`^\d{4}-\d{2}-\d{2}$`。start と同正規表現）と
    `venueId`（int positive）を追加。updateSession に venue 存在チェックを足す（無ければ validationError）。
  - UI は編集シート（start-session-sheet を編集モードで再利用 or 専用シート）。列追加なし。

## 要件6: 統計画面（曲別 / 分布 / 傾向 / 期間推移、絞り込み: 店・母店・季節）

- **影響ファイル**
  - 参考（既存集計の置き場）: `src/server/recommendation/build-input.ts` L117-189
    （曲別 GROUP BY: `appearanceCount` / `lastPlayedDate` / `myPlayCount` / `myCallCount`、
    ジャンル別コール比率 L167-189）。ただしこれは推薦入力用で「現在セッション基準・店舗区分別」。
  - `src/engine/score.ts` L32-53（珍しさ=登場回数、久しぶり=daysSinceLastPlayed の消費側。集計自体は build-input）。
  - 新設が必要: `src/server/repositories/stats.ts`（集計クエリ群）、`src/app/api/stats/route.ts`、
    `src/app/(main)/stats/page.tsx`＋コンポーネント、`src/components/shell/bottom-nav.tsx`（ナビ項目追加）。
- **現状**
  - 統計専用の画面・API・リポジトリは存在しない。集計は推薦エンジンの入力生成に閉じている。
- **変更方針**
  - `stats.ts` に指標別クエリを新設（推薦用の「店舗区分別・as-of」ではなく、フィルタ可能な素の集計）:
    (1) 曲別コール/演奏回数・最終演奏日（performances GROUP BY song_id、build-input L119-131 を汎用化）、
    (2) ジャンル/キー/構成の分布（songs / song_genre_tags GROUP BY）、
    (3) 季節別/店別/母店別の傾向（sessions.venue_id・venues.is_home・season で GROUP BY。
        season はセッション日付→月境界 or songs.season。決定事項に沿い月境界＝JST）、
    (4) 期間推移（月別。`substr(session_date,1,7)` で GROUP BY）。
  - 絞り込み: 店(venue_id)/母店(is_home)・季節。クエリパラメータで受ける。
  - 可視化を行う場合は dataviz スキルの規約に従う（分布・推移はチャート候補）。列変更なし（読み取り専用）。

## 要件7: セッション詳細記録（パート別参加者・ホストパート・リスナー数）＋既存メモ一括パース移行

- **影響ファイル**
  - `src/db/schema.ts`（`sessions` L140-157 / `instruments` L119-124。**参加者・ホスト・リスナー数の構造なし**）
  - `src/server/repositories/sessions.ts`（`SessionDetail` 型 L32-35・`toDetail` L80-91 に新項目を載せる）
  - `src/server/validation/sessions.ts`（start/update スキーマに新フィールド）
  - UI: `src/components/session/session-record-screen.tsx` / `start-session-sheet.tsx`
  - メモ移行（CSV import とは別経路）— 参考実装:
    `src/server/import/preview.ts`（`rankTitleCandidates` L55-107・`normalizeTitle` 突合）、
    `src/server/import/commit.ts`、`src/server/repositories/import-jobs.ts`（PREVIEW→COMMIT ジョブ雛形）、
    `src/lib/normalize-title.ts`（曲名正規化の唯一の規則）。
- **現状**
  - 参加者は `performances.participated`（自分の参加のみ）＋`performance_front_instruments`（曲ごとの編成）で、
    **セッション単位のパート別人数・ホスト・リスナー数**を保持する場所が無い。
    リスナーは `sessions.has_listeners`（boolean）のみで人数を持てない。ホストパートの概念も無い。
  - メモは `sessions.note`（自由テキスト）のみ。複数セッション分の生テキストを構造化取込する仕組みは無い。
    既存 CSV import は songs/setlists の 2 種のみ（`import_jobs.type` L352）。
- **変更方針（決定事項準拠: 構造化・楽器マスタ連動・リスナー別カウント・ホストは楽器参照）**
  - 新テーブル `session_participants`（session_id FK, instrument_code FK→instruments.code, count int）、
    PK=(session_id, instrument_code)。
  - `sessions` に additive で `host_instrument_code`（text nullable, FK→instruments.code）と
    `listener_count`（integer nullable。既存 has_listeners とは併存させる）を追加。
  - メモ移行は import-jobs パターンを踏襲した**別経路**（type 拡張 or 専用一時ジョブ）:
    複数セッション分テキスト一括貼付 → パース → プレビュー補正 → 取込。
    パーサ検討点（brief 明記）: 部分表記→楽器マスタ照合（instruments.code/label、部分一致は
    rankTitleCandidates 同型のスコアリング）、曲名照合（normalizeTitle + rankTitleCandidates 再利用）、
    記号 🎷=サックス系 / 🎹=ピアノ / 👆=（コール/自分）/ 🔰=初心者 の解釈、`※`注記の扱い（note へ退避）。
    店舗・日付の抽出、date+venue 重複防止は commit.ts L329-340 の既存ロジックを踏襲。

## 要件8: バージョン番号ルール導入（SSOT 定数・マスタ設定画面のみ表示）

- **影響ファイル**
  - **新設** `src/version.ts`（`export const APP_VERSION = "vYYYYMMDD-NN"`。docs/version_number.md §1 準拠）
  - 表示: `src/components/master/settings-screen.tsx`（設定画面。フッター等に `{APP_VERSION}` を描画）
  - 混同注意: `src/server/repositories/export.ts` L32-45 に既存 `schemaVersion()` / `schema_version`
    （package.json version 由来）があるが、これは別概念（docs/version_number.md §5）。SSOT を共有しない。
- **現状**
  - アプリ表示用のバージョン定数は無い。層別の `schema_version`（export 用）のみ存在。
- **変更方針**
  - `src/version.ts` に定数 1 つだけ export。設定画面のみに表示（決定事項）。文字列ハードコード禁止・import 描画。
  - 形式 vYYYYMMDD-NN（JST）。UI 変更を含むコミットで値更新（運用ルール）。

## 要件9: ダークモード導入（クラス方式・共通ヘッダー右上トグル・ベースカラーから配色）

- **影響ファイル**
  - `src/app/globals.css`（**既に** `.dark` トークン定義済み L105-145、`@custom-variant dark (&:is(.dark *))` L5、
    `:root` ライト L62-103）
  - `src/app/layout.tsx`（`<html lang="ja">` L20。**FOUC 防止スクリプト・ThemeProvider 無し**）
  - `src/app/(main)/layout.tsx`（共通ヘッダー L15-19。**トグル UI を置く場所**。右上に配置）
  - 新設候補: `src/lib/theme.ts` or `src/components/shell/theme-toggle.tsx`（トグル＋localStorage）
  - Tailwind: v4 の CSS ベース設定（tailwind.config.js 無し。darkMode は `@custom-variant` で既にクラス方式）
- **現状**
  - **配色トークンの土台は完成**（globals.css の `.dark` に全 semantic トークンのダーク値あり、
    design_rule §1.1 準拠）。不足は「`.dark` クラスを付け外す機構」一式:
    (1) `<html>` への `.dark` トグル、(2) localStorage 永続化（キー未定義）、
    (3) FOUC 防止の `<head>` 先行スクリプト（未実装）、(4) ヘッダー右上のトグル UI（未実装）。
  - 現在ヘッダーは `(main)/layout.tsx` のみ。`(auth)/login` は別レイアウト（トグル対象外可）。
- **変更方針（docs/dark_mode.md 準拠）**
  - `src/app/layout.tsx` の `<head>`（`children` 前）に FOUC 先行スクリプトを inline 挿入。
    ストレージキーは一意名 `next-call-dark-mode`。判定順: 保存値 → 無ければ `prefers-color-scheme`。
  - `(main)/layout.tsx` ヘッダー右上にトグル（太陽/月アイコン・aria-label 状態連動）。
    状態反転→`document.documentElement.classList.toggle('dark')`→localStorage 保存を 1 フックに集約。
  - 配色はベースカラー（globals.css の既存トークン）から設計済みのため、原則追加不要
    （不足トークンがあれば `:root`/`.dark` 両方に定義。純黒背景禁止＝現状 oklch(0.145) で準拠）。

---

## Domain Model Delta

追加は additive のみ（schema.ts 冒頭規約: 列の削除・改名禁止）。次マイグレーションは `0004_*`
（`drizzle-kit generate`。既存 0000〜0003）。

### 新規テーブル

**`session_participants`**（要件7。パート別参加人数・楽器マスタ連動）
```ts
export const sessionParticipants = sqliteTable(
  "session_participants",
  {
    sessionId: integer("session_id").notNull().references(() => sessions.id),
    instrumentCode: text("instrument_code").notNull().references(() => instruments.code),
    /** そのパートの人数（1..N） */
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.instrumentCode] })],
);
```

### 変更（列追加・additive）

**`sessions`**（要件7）
```ts
/** ホストのパート（楽器マスタ参照。nullable = 未記録） */
hostInstrumentCode: text("host_instrument_code").references(() => instruments.code),
/** リスナー客の人数（別カウント。既存 has_listeners とは併存） */
listenerCount: integer("listener_count"),
```

- 要件5（session_date / venue_id 後編集）は**列追加不要**（既存列を更新可能にするのは
  検証スキーマ側の変更のみ）。
- 要件3（order_index 編集）も**列追加不要**（既存 `performances.order_index` を再採番）。
- メモ移行（要件7）は一時ジョブ。`import_jobs.type` の enum に memo 系を足す（additive な enum 拡張）か、
  専用の短命ジョブテーブルを別途新設。正規化テーブルは持たない方針（既存 import_jobs 同様）。

### 影響のみ（新規なし）

- 要件4 削除は既存テーブルへの cascade 手動削除（`recommendation_candidates` →
  `recommendation_requests` → `performance_front_instruments` → `performances` → `sessions`）。
- 要件8 は DB 非対象（`src/version.ts` 定数）。要件9 は DB 非対象（CSS/クライアント）。

---

## Quality Gate Candidates

package.json `scripts` から検出（すべて実在）:

| gate | command | source |
|---|---|---|
| typecheck | `tsc --noEmit`（`npm run typecheck`） | package.json scripts.typecheck |
| lint | `eslint .`（`npm run lint`） | package.json scripts.lint |
| test | `vitest run`（`npm run test`） | package.json scripts.test（vitest.config.ts の projects 構成） |
| build | `next build`（`npm run build`） | package.json scripts.build（next.config.ts: output "standalone"） |

補助（ゲート外だが関連）: `db:generate`（drizzle-kit generate）— 要件7 のスキーマ変更後に必要。
`tsconfig.json` は `strict: true`。

---

## Unit Decomposition 示唆

独立性・スキーマ影響・ファイル結合（同一ファイルを編集する要件は競合するため順序化 or 同一ユニット化）で分類。

- **unit-A: 表示微修正**（要件1 履歴導線 + 要件2 カンマ表記）
  - フロントのみ・スキーマ/API 変更なし。最小・最速。
- **unit-B: セッション編集・削除**（要件4 削除 + 要件5 基本情報修正）
  - sessions の API/repo/validation ＋ 操作メニュー UI。ConfirmDialog 再利用。cascade 削除ロジック。
- **unit-C: 曲順編集**（要件3）
  - performances の reorder API/repo ＋ セットリスト UI。列変更なし。
- **unit-D: テーマ＆バージョン**（要件9 ダークモード + 要件8 バージョン番号）
  - chrome/設定系。layout.tsx（FOUC）＋(main)/layout.tsx ヘッダー＋settings-screen 表示。DB 非対象。
- **unit-E: 統計画面**（要件6）
  - 新設 stats repo/api/page/nav。読み取り専用。build-input.ts の集計を汎用化して再利用。
- **unit-F: セッション詳細記録＋メモ移行**（要件7）
  - 唯一のスキーマ変更ユニット（session_participants 新設・sessions 列追加・0004 migration）＋
    詳細記録 UI ＋ メモ一括パース取込（import 基盤を踏襲した別経路）。最大規模。

### 依存関係（edges）

- **データ依存はほぼ無し**（各ユニットは独立に着手可能）。unit-F のスキーマは additive で他を壊さない。
- **ファイル結合（競合注意・順序化推奨）**:
  - `session-record-screen.tsx` を **unit-A / unit-B / unit-C / unit-F** が編集 → 直列化 or マージ調整必須。
    推奨順: A → C → B → F（軽い表示変更から、記録構造変更を最後に）。
  - `bottom-nav.tsx` に **unit-E（統計）** がナビ項目追加。unit-F が別ナビを足す場合も同ファイル → 調整。
  - `(main)/layout.tsx` ヘッダーは **unit-D** のみが編集（トグル追加）。unit-A の履歴導線を
    ヘッダーに置くなら unit-D と競合するため、unit-A は SessionRecordScreen 内に置く前提。
  - `settings-screen.tsx` は **unit-D（バージョン表示）** が編集。
- **推奨並行実行**: unit-E（統計）と unit-D（テーマ＆バージョン）は他と非競合で並行可。
  unit-F はスキーマ確定を先行させると unit-E の統計に将来の参加者指標を足しやすい（現決定の指標では不要）。
