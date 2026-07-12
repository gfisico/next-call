# 実装計画 — unit-06-recommend-screen（選曲支援・推薦結果画面）

- **Unit:** unit-06-recommend-screen / **Intent:** next-call-mvp
- **Discipline:** frontend
- **Branch:** ai-dlc/next-call-mvp/06-recommend-screen（worktree: next-call-mvp-06-recommend-screen）
- **View:** `/sessions/[id]/recommend`（1画面・条件を上、結果を下に配置。モーダル遷移を避ける）
- **Bolt:** 1（全タスクを1ボルトで実装）

## 依存・前提（調査済みの確定事項）

### API 契約（unit-04・そのまま利用。追加API不要）
- `GET /api/sessions/:id/recommendations/defaults` → `{ defaults: { intent, conditions, suggestSeasonalOn } }`
  - `intent`: `{ rare, fresh, safety, mood, ballad }`（各 -2..+2 の整数）+ `{ seasonal, listener }`（bool）。前回値（intent.last_values）が無ければ全 0・チェック OFF。
  - `conditions`: `{ horns:"UNKNOWN", beginner:"UNKNOWN", kurobon1Only:false, genreOverride:[] }`（既定）。
  - `suggestSeasonalOn`: boolean。**API はフラグを返すだけ。1曲目のときの季節感 ON 初期化は本ユニット UI が行う**（defaults route コメント・仕様§9.7）。
- `POST /api/sessions/:id/recommendations`（201）body:
  - `{ conditions:{ horns:"ONE|MULTI|UNKNOWN", beginner:"NONE|PRESENT|UNKNOWN" }, constraints:{ kurobon1Only:boolean, genreOverride?:Genre[] }, intent:{ rare,fresh,safety,mood,ballad,seasonal,listener } }`
  - レスポンス `{ recommendation: RecommendationView }`。`RecommendationView`（src/server/recommendation/service.ts）:
    - `requestId, seed, isSparse:boolean, poolSize:number`
    - `candidates: [{ song: SongWithTags, score, reasons:[{code,text}], isPending }]`（理由は 2〜4 件・APIそのまま表示）
    - `conditionalCandidates: [{ song, score, reasons, branch:"HORNS_ONE|HORNS_MULTI|BEGINNER_NONE|BEGINNER_PRESENT", conditionLabel:string }]`（存在時のみ・ラベルは API 提供の `conditionLabel` をそのまま表示）
    - `pendingSongs: [{ song, warnings:["PLAYED_TODAY"|"SAME_FORM"|"KUROBON1_MISMATCH"|"FORMATION_MISMATCH"] }]`（**現在条件で再評価された警告**。保留曲枠はここを情報源にする）
  - `SongWithTags` = songs 行（title, songKey, form, composer, inKurobon1 等）+ `genreTags:string[]`。メタ行は `key: {songKey} ・ {form} ・ {composer}` で表示。
  - セッションが ACTIVE でないと 409、無ければ 404。
- `POST /api/pending-songs` body `{ songId }`（201・冪等）= 保留に追加 / `DELETE /api/pending-songs/:songId`（204）= 保留解除。
- コール登録は unit-05 の `SongPerformanceSheet` 経由（`addPerformance`）。calledByMe=true 保存時にサーバ側で保留が自動解除される（unit-04）。

### 再利用コンポーネント / 基盤
- **`src/components/session/song-performance-sheet.tsx`（再利用・重複実装禁止）**: 「この曲をコール」は `mode="create"` + `initialSong={id,title}` + `initialCalledByMe={true}` で開く（検索UI非表示・選択済み表示になることは sheet-reuse-contract テストで担保済み）。`onSaved` で保存完了を受け、`/sessions/[id]` へ遷移。
- **`src/components/ui/slider.tsx`**: shadcn/ui（radix-ui Slider）ベース。本ユニットで作る ios-slider の土台。
- **`src/components/session/segment.tsx`**: `Segment<T>`（radiogroup・aria-checked・h-10・focus ring）を編成/制約セグメントに再利用。
- **`src/lib/api/client.ts` / `hooks.ts` / `types.ts`**: fetch 集約点。ここに推薦系のヘルパ・型・SWR フックを追加する（唯一の fetch 経路 = テストが installFetch でモックしやすい）。
- **Toaster**: `(main)/layout.tsx` にマウント済み（sonner）。保存/通信失敗の通知に利用可。
- **テスト基盤**: vitest projects（node/dom 分離）。dom テストは `tests/components/**/*.test.tsx`、`tests/setup/dom.ts`（Radix polyfill・scrollIntoView は vi.fn 済み）、ヘルパ `installFetch`/`bodyOf`（helpers/mock-fetch.ts）と `renderWithSWR`（helpers/render.tsx）を使用。

### ルーティングの現状と是正
- 記録画面（session-record-screen.tsx L256）の「次の曲を考える」は現状 `router.push("/suggest")`（プレースホルダ）。**本ユニットで `/sessions/${session.id}/recommend` へ変更**（2タップ担保・仕様§17.2）。
- `/suggest`（bottom-nav「推薦」タブ）はプレースホルダのまま残さず、**進行中セッションがあればその recommend 画面へ誘導、無ければ「進行中セッションがありません」空状態**に差し替える（`useActiveSession` 利用・迷子導線の解消）。

## タスク一覧（Bolt 1）

### Task 1 — 共有 iOS 風スライダー `src/components/ui/ios-slider.tsx`
- shadcn/ui `Slider`（radix）をベースにした**共有コンポーネント**（unit-07 設定画面のスライダーも本コンポーネントで統一）。
- props: `{ name:string, leftLabel:string, rightLabel:string, value:number(-2..+2), onChange:(v)=>void, ariaLabel? }`。
- 仕様: `min=-2, max=2, step=1` の**5段階スナップ**。外観は Apple(iOS)風 = 細レール（`h-1` 相当）+ **中央（0）起点の青系ティント fill** + 白い円形ノブ（`shadow` 付き・`ring`）+ 5段階のドット。ノブ上に名前、レール上に左右ラベル（`ends`）を直接表示（仕様§9.1）。
- **中央起点 fill の実装注意**: radix `Range` は min 起点でしか塗れないため、Range は使わず（または非表示にし）、value から `left/width` を算出した独立の fill 要素を絶対配置で重ねて中央起点ティントを描画する。ドットは 0/25/50/75/100% に配置。
- アクセシビリティ/操作性: タッチ領域を `after:-inset-*` で拡大（誤タッチ低減）、`focus-visible:ring`、キーボード操作（矢印キー = step 移動）は radix 標準を維持。ダークモード対応クラス。
- targets: criterion 9（design_rule 準拠・shadcn ベース）、Risk「スライダーのモバイル操作性」。

### Task 2 — 推薦系の API クライアント・型・フック
- `src/lib/api/types.ts` に DTO 追加: `RecommendationIntent`（rare/fresh/safety/mood/ballad/seasonal/listener）、`RecommendationConditions`、`RecommendationDefaults`、`ReasonView`（code,text）、`RecommendationCandidateView`、`ConditionalCandidateView`（branch, conditionLabel）、`PendingSongView`（warnings）、`RecommendationResult`、`Genre` 型（chip 用サブセット）、`RecommendationRequestPayload`。
- `src/lib/api/client.ts` に追加: `fetchRecommendationDefaults(sessionId)`, `postRecommendation(sessionId, payload)`, `fetchPendingSongs()`, `addPendingSong(songId)`, `removePendingSong(songId)`（既存のエンベロープ剥がし・ApiClientError 規約に準拠）。
- `src/lib/api/hooks.ts` に `useRecommendationDefaults(sessionId)`（SWR・GET defaults）を追加。POST/pending 変更は client 直呼び（既存運用）。
- targets: criterion 1（一連フローの土台）、テスト容易性。

### Task 3 — 条件入力セクション（画面上部）
- 実装場所: `recommend-screen.tsx` 内のサブセクション（必要なら小コンポーネントに分割）。
- **編成条件**: 管楽器 `Segment`（1人=ONE/複数=MULTI/わからない=UNKNOWN・既定 UNKNOWN）、初心者 `Segment`（いない=NONE/いる=PRESENT/わからない=UNKNOWN・既定 UNKNOWN）。
- **制約**: 黒本1 `Segment`（制限なし=false / 黒本1曲載のみ=true・毎回変更可・仕様§11.2）+ 補助文。
- **ジャンル上書き（任意・折りたたみ既定 OFF）**: チップ複数選択 = ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環（バラードは独立スライダーのため除外・「キメが多い曲」も UI 非対象）。説明文「指定すると該当ジャンルを**強く優先**します（絞り込みではありません）」（仕様§10・「絞り込み」表記禁止）。
- **今回の意図**: `IosSlider` ×5 = 珍しい曲（強い減点⇔強い加点=rare）/久しぶりの曲（強い減点⇔強い加点=fresh）/攻め方（安全に行く⇔攻める=safety）/場の温度（落ち着かせる⇔盛り上げる=mood）/バラード（避けたい⇔やりたい=ballad）。
- **チェック×2**: 季節感（セッション日付から季節ラベルを導出し「{季節}の曲を重視」表示。利用者は季節を選ばない・仕様§9.7）/ リスナー受け（リスナー客なしでも無効化せず既定 OFF）。季節ラベルは `session.sessionDate` から既定の月境界（春3-5/夏6-8/秋9-11/冬12-2）でクライアント導出（season_months はサーバ設定でフロント非公開のため既定境界を使用）。
- targets: criterion 2（前回値引き継ぎ表示・変更した項目だけ変わる）, criterion 3（1曲目季節感）, criterion 9。

### Task 4 — 推薦結果セクション（画面下部）
- **通常候補カード**: 曲名（大）+ メタ行（key/form/composer）+ 推奨理由の箇条書き（`reasons` を **API 文字列そのまま** 2〜4 件・フロント加工しない）+ `isPending` 時「保留中」warning バッジ。アクション（Secondary 統一・画面内 Primary は下部固定の再抽選のみ）: 「この曲をコール」/「保留に追加」（保留中の曲は「保留に追加」を disabled）。
- **isSparse 注記**: `isSparse===true` のとき「条件が強く、候補が {candidates.length} 曲に絞られました。条件を緩めるとさらに提案できます。」の info コールアウト（無理に候補を増やさない・仕様§14.5）。
- **条件別候補**: `conditionalCandidates` が存在するときのみ、`conditionLabel`（「1管なら」等・API 提供）を info バッジで冠したラベル付きカードで通常候補と区別して表示。
- **保留曲枠（結果最下部・常時表示）**: `recommendation.pendingSongs` を情報源に全保留曲を表示（条件に関係なく全件）。`warnings` を warning バッジで表示（本日演奏済み/直前と同構成/黒本1条件外/編成に合いにくい）。警告があってもコール可。アクション: 「コール」（→ シート）/「保留解除」（DELETE → 行削除・結果を再取得 or ローカル更新）。状態は色+テキスト（design_rule §8.2）。
- design_rule 準拠: Card=`rounded-xl border bg-card shadow-sm`、Badge は variant（warning/info/success）、Button variant=secondary、h-10 タップ領域。
- targets: criterion 4（理由2件以上・isSparse注記）, criterion 5（条件別ラベル区別）, criterion 6（保留枠・警告・コール・解除）, criterion 9。

### Task 5 — 画面統合・ルーティング・コール登録フロー
- `src/components/session/recommend-screen.tsx`（"use client"・props `{ sessionId:number }`）を新設し、Task 3/4 を統合（page から params を分離してテスト可能にする）。
- `src/app/(main)/sessions/[id]/recommend/page.tsx`: `useParams` で id 解決 → `RecommendScreen`。無効 id / セッション取得不可時のフォールバック（sessions/[id] と同様）。
- **状態管理**: `useRecommendationDefaults` で初期 state（intent/conditions/genreOverride/checks）をロード。**1曲目（suggestSeasonalOn=true）のとき seasonal を推奨 ON で初期化**（ユーザーは OFF に変更可）。ロード後の編集はローカル state。
- **「候補を出す」**（下部固定 Primary）: `submitting` state で**二重実行防止**（実行中はボタン無効化 + 結果領域スケルトン表示）。POST 成功後 `result` を state 保持し、結果セクションへ `ref.scrollIntoView({behavior:"smooth"})` で**自動スクロール**。失敗時は toast/インラインエラー。
- **「条件を変えて再抽選」**（結果表示後の下部固定・Secondary）: 意図セクション先頭へスクロール（再実行は新規 POST として保存＝繰り返し減点が効く）。
- **「この曲をコール」/「コール」**: `SongPerformanceSheet` を `mode="create" + initialSong + initialCalledByMe=true` で開く。`onSaved` で `/sessions/${sessionId}` へ `router.push`（保存時に保留は自動解除される）。
- **「保留に追加」/「保留解除」**: client 直呼び後、保留状態を反映（結果の再取得 or 楽観更新）。
- **ナビ是正**: session-record-screen.tsx の「次の曲を考える」を `/sessions/${session.id}/recommend` に変更。`/suggest/page.tsx` を `useActiveSession` で active があれば recommend へ誘導・無ければ空状態に差し替え。
- 画面縦長化対策: ジャンル上書き折りたたみ既定 + 結果自動スクロール（Risk 対応）。
- targets: criterion 1（一連フロー）, criterion 7（コール→シート→保存→セッション画面）, criterion 8（最短2タップ）, Risk「結果待ちの体感」「画面縦長化」。

### Task 6 — dom テスト（tests/components/*.test.tsx・375px・testing-library・installFetch）
- `next/navigation`（useParams/useRouter）を vi.mock し、`RecommendScreen`（sessionId prop）を `renderWithSWR` で描画。fetch は `installFetch` の route ハンドラでモック。
- ケース:
  1. **一連フロー（criterion 1）**: defaults GET → スライダー/チェック/編成/制約変更 → 「候補を出す」→ POST が期待 payload（`bodyOf`）で呼ばれ、候補+理由が表示。
  2. **前回値引き継ぎ（criterion 2）**: defaults の intent 非中央値が初期表示に反映、1項目だけ変更 → 変更項目のみ payload に反映。
  3. **1曲目季節感（criterion 3）**: `suggestSeasonalOn=true` で季節感チェック ON 初期化、OFF に変更でき payload seasonal=false。
  4. **理由/isSparse（criterion 4）**: 候補カードに reasons 2 件以上、`isSparse=true` で注記表示。
  5. **条件別候補（criterion 5）**: horns=UNKNOWN のモックで conditionalCandidates を `conditionLabel` 付きで通常候補と区別表示。
  6. **保留曲枠（criterion 6）**: pendingSongs（warnings 付き）を常時表示、警告バッジ表示、「保留解除」で DELETE 呼び出し・行削除、「コール」でシートが開く。
  7. **コール登録（criterion 7）**: 「この曲をコール」→ シートが `initialSong` 固定 + calledByMe=true で開く → 保存 → `router.push("/sessions/1")`。
  8. **2タップシナリオ（criterion 8）**: defaults ロード後すぐ「候補を出す」→ POST 実行（条件調整なしで候補到達）を検証。
- targets: criterion 1〜8 の検証。

## 成功基準カバレッジ（9/9）
1. defaults→変更→候補を出す→候補+理由（375px モック）: Task 5 + Task 6-1
2. 前回意図値引き継ぎ・変更項目のみ反映: Task 3 + Task 5 + Task 6-2
3. 1曲目季節感 推奨 ON→OFF 可: Task 3 + Task 5 + Task 6-3
4. 理由2件以上・isSparse 注記: Task 4 + Task 6-4
5. 条件別候補ラベル区別: Task 4 + Task 6-5
6. 保留曲枠 独立常時表示・警告・コール・解除: Task 4 + Task 5 + Task 6-6
7. この曲をコール→シート（calledByMe=true・曲確定）→保存→セッション画面: Task 5 + Task 6-7
8. 最短2タップ: Task 5（ナビ是正）+ Task 6-8
9. design_rule 準拠（shadcn ベース・スライダー/チップ/カード/バッジ）: Task 1・3・4 全体

## リスクと緩和
- **スライダーのモバイル操作性 / 中央起点 fill**: radix Range は中央起点で塗れない → ios-slider は value 算出の独立 fill を描画。5段階スナップ（step=1）+ タッチ領域拡大 + focus ring で誤タッチ低減。
- **結果待ちの体感**: `submitting` state でボタン無効化（二重実行防止）+ 結果領域スケルトン。
- **画面縦長化**: ジャンル上書きは折りたたみ既定、実行後は結果セクションへ自動スクロール。
- **ルーティング二経路**: 記録画面ナビを `/sessions/[id]/recommend` に是正、`/suggest` タブは active session へ誘導/空状態化。
- **季節ラベルのサーバ設定非公開**: season_months はサーバ設定でフロント非公開 → 既定の月境界でクライアント導出。境界変更が必要になれば followup（API に季節ラベルを含める）。
- **保留枠の情報源**: 警告は条件依存のため `recommendation.pendingSongs`（再評価済み）を使用。GET /api/pending-songs は warnings を返さないため保留枠は推薦実行後の結果セクションで表示（候補0でも表示＝「常時」の意）。

## 境界（本ユニットで作らないもの）
- 推薦ロジック・理由文生成（unit-02/04）。曲追加シートは unit-05 の再利用（重複実装禁止）。設定画面は unit-07（ios-slider は共有として本ユニットで実装するが設定画面自体は対象外）。