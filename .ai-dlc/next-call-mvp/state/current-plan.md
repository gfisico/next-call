# Plan — unit-05-session-screen (frontend)

**Branch:** ai-dlc/next-call-mvp/05-session-screen
**Worktree:** /Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-mvp-05-session-screen
**Bolt:** 1（単一ボルト。frontend 画面 + テスト基盤導入）
**Depends on:** unit-01（Next.js基盤/認証/shadcn）, unit-03（全API）— マージ済み

## 前提調査サマリ（確定した契約）

- **API 規約**: JSON/クエリ camelCase、POST=201・DELETE=204・PATCH/GET=200、リソース名エンベロープ（{ session } / { sessions } / { venues } / { instruments } / { songs } / { song } / { venue } / { performance }）、エラーは { error: { code, message, details? } }（code: VALIDATION_ERROR/NOT_FOUND/CONFLICT/INTERNAL_ERROR）。
- **使用エンドポイント**:
  - GET /api/sessions/active → { session }（無い時 404 = ACTIVE 無し）
  - POST /api/sessions { venueId, hasListeners?, sessionDate? } → 201 { session: SessionDetail }（ACTIVE 二重は 409, details.activeSessionId）
  - GET /api/sessions → { sessions }（venueName 付き・新しい順）
  - GET /api/sessions/:id → { session: SessionDetail }
  - PATCH /api/sessions/:id { hasListeners? | note? | status:"ENDED" } → { session }
  - POST /api/sessions/:id/performances { songId | quickTitle, participated?, instrument?, calledByMe?, noChart?, note?, frontInstruments?[] } → 201 { performance }（ENDED は 409）
  - PATCH /api/performances/:id（部分更新・曲の付け替え不可）→ { performance }
  - DELETE /api/performances/:id → 204
  - GET /api/venues → { venues } / POST /api/venues { name, isHome } → 201 { venue }（name 重複 409）
  - GET /api/instruments → { instruments }（sortOrder 順・初期12種 vo ss as ts bs tp fl fh harm tb cl g）
  - GET /api/songs?q= → { songs }（title 部分一致・genreTags 含む）
  - POST /api/songs/quick { title } → 201 { song }（正規化同名は 409 + details.song = 既存曲）
- **SessionDetail 形**: SessionRow + venueName + performances: PerformanceWithFront[]。PerformanceWithFront = PerformanceRow + songTitle + frontInstruments:[{code,position}]（position 昇順）。
- **frontInstruments 契約**: 入力は [{code, position}]。サーバは position 昇順にソートし 0.. に振り直す。→ フロントは「タップ追加順に position=0,1,2,... を採番」して送ればよい（同一楽器の重複可）。
- **既存 app shell**: src/app/(main)/layout.tsx（max-w-lg・下部 BottomNav h-14・main は pb-20）、BottomNav（/=セッション, /suggest=推薦, /songs=マスター, /settings=設定）。ホーム src/app/(main)/page.tsx は現在 PlaceholderCard。/sessions ルートは未作成。
- **既存 UI**: shadcn の Button/Badge/Card/Checkbox/Dialog/Input/Select/Sheet/Slider/Sonner/Table あり。
  - Button の size 既定は h-8（design_rule §6.1/§8.3 の h-10 タップ領域に満たない）→ 主要操作ボタンは className="h-10 ..." で明示上書き。
  - Badge の variant は default/secondary/destructive/outline/ghost/link のみ。→ info/warning/success/neutral の semantic variant を design_rule §6.3 の class（dark: 文字色込み）で追加する。
  - Sonner Toaster は未マウント（handoff-notes）→ 本ユニットでマウント。
  - next-themes ThemeProvider 未マウントだが Sonner の useTheme は既定 system で動作（クラッシュしない）。
- **テスト**: testing-library 未導入・jsdom 未導入・@vitejs/plugin-react 未導入。vitest 現状 environment=node・include=tests/**/*.test.ts（.tsx 含まず）。既存 node テスト 30+ 本を壊さず jsdom を追加する必要あり。

## データフェッチ選定

- **SWR** を採用（軽量・依存小・fetch モックしやすい＝criterion 5 のテスト容易）。GET キャッシュ（active/一覧/venues/instruments/曲検索）に使用。
- ミューテーション（POST/PATCH/DELETE）は apiClient 直呼び + 成功後 mutate() で再検証。SWRConfig は必須ではない。フェッチャは共通 apiClient に集約。

---

## タスク一覧

### Task 1 — テスト基盤（testing-library + vitest jsdom）導入 [criterion 1,5,7 の前提]
- devDeps 追加: @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, @testing-library/dom, jsdom, @vitejs/plugin-react。
- vitest.config.ts を projects（workspace）構成へ変更し既存 node テストを保護:
  - project "node": environment=node, include=tests/**/*.test.ts（現状維持）。
  - project "dom": environment=jsdom, include=tests/components/**/*.test.tsx, plugins=[react()], setupFiles=tests/setup/dom.ts。
  - resolve tsconfigPaths 維持（@/*）。
- tests/setup/dom.ts: import "@testing-library/jest-dom/vitest" + afterEach(cleanup)。
- npm run test が既存全テスト + 新規 component テストを実行できることを確認。

### Task 2 — API クライアント + 型 + SWR フック [criterion 全般の土台]
- src/lib/api/types.ts: サーバ返却の camelCase DTO 型（SessionSummary, SessionDetail, PerformanceWithFront, FrontInstrument, Venue, Instrument, Song, GenreTag, ParticipationInstrument="SAX"|"PIANO"|"NONE"）。DB schema/リポジトリ戻り値に一致。
- src/lib/api/client.ts: apiFetch<T>(path, init?) — エンベロープを剥がす/204 は void/エラー時 ApiClientError（status, code, message, details）を throw。SWR 用 fetcher。
- src/lib/api/hooks.ts: useActiveSession()（404→null 正常扱い）, useSessions(), useSession(id), useVenues(), useInstruments(), useSongSearch(term)（debounce 250ms + 直近結果キャッシュ、空文字は fetch しない）。
- swr を dependencies に追加。

### Task 3 — ホーム / （分岐コンテナ + 空状態） [criterion 1,8]
- src/app/(main)/page.tsx を client エントリ化: useActiveSession() で分岐。
  - ローディング: 簡易表示。
  - ACTIVE あり → <SessionRecordScreen session=... />（Task 6）。
  - ACTIVE なし → 空ホーム: Primary「セッションを開始」（画面内唯一の Primary, h-10）+ 直近セッション上位数件（venueName・日付・曲数・母店バッジ）+「すべての履歴を見る →」（/sessions への link/ghost）。
- 直近件数は useSessions() の先頭 N 件。モバイル 375px 基準・max-w-lg 内。

### Task 4 — セッション開始シート StartSessionSheet [criterion 2,8]
- src/components/session/start-session-sheet.tsx（Sheet, side="bottom", rounded-2xl）。
- 既存店舗: useVenues() 一覧を 1 タップ選択（母店は info バッジ）。
- 新規店舗: 「または」区切り + 名前 Input。名前を入力した時のみ「この店舗は母店ですか？」セグメント（はい/いいえ, 既定=いいえ）を表示（criterion 2: 既存選択時は非表示）。help「あとで設定>母店設定で変更可」。
- リスナー客トグル（あり/なし, 既定=なし）。
- 開始（Primary h-10）: 新規なら先に POST /api/venues {name,isHome}（name 重複 409 → 既存 venue にフォールバック）→ その venueId で POST /api/sessions。既存なら直接 POST /api/sessions {venueId, hasListeners}。409（ACTIVE 二重）→ toast + active 誘導。成功 → mutate(active)。

### Task 5 — 共有コンポーネント SongPerformanceSheet（曲追加/編集シート） [criterion 3,4,5,6,7]
- src/components/session/song-performance-sheet.tsx。unit-06 再利用契約の中核。
- Props（契約）:
  - sessionId: number
  - mode: "create" | "edit", performanceId?: number（edit 時）
  - initialSong?: { id; title }（固定曲。渡された場合は検索UIを出さず選択済み表示。unit-06 の「この曲をコール」）
  - initialCalledByMe?: boolean（既定 false）
  - initialInstrument?: "SAX"|"PIANO"|"NONE"（既定 SAX）
  - initialFrontInstruments?, initialNoChart?, initialNote?（edit 時の値流し込み）
  - open, onOpenChange, onSaved?(performance), onQuickCreated?（任意）
- UI/挙動:
  - 曲名検索（initialSong 未指定時）: useSongSearch（debounce 250ms）→ 候補カードタップで選択。選択中は success バッジ。
  - ヒットなし時: 「『{入力}』を新規登録」→ POST /api/songs/quick → 返った song を選択状態に（needs_review ヒント）。409（正規化同名既存）は details.song を選択状態に流用（そのまま追加可）。
  - 自分の参加: セグメント（不参加/サックス/ピアノ, 既定=サックス）。none 選択時も instrument=NONE を送る。
  - チェック: 自分がコールした（initialCalledByMe 反映）/ 譜面なしだった。
  - フロント編成（任意・折りたたみ既定・展開可）: 楽器チップ列（useInstruments()）タップで追加順に末尾追加＝position 採番、選択済みチップは「n. code ✕」でタップ削除、同一楽器の複数追加可。送信時 frontInstruments=[{code,position:index}]。
  - メモ（任意）。
  - フッタ: 「保存して次へ」（secondary, シートを閉じずリセットして連続追加）+「保存」（Primary h-10）。シートは overlay で独立コンテキスト（記録画面本体の Primary と両立可）。
  - 保存 = create: POST /api/sessions/:id/performances（songId or quickTitle）/ edit: PATCH /api/performances/:id。
  - 二重送信防止: 送信中はボタン disabled。
  - POST 失敗時: フォーム state を保持したまま error-block 表示 +「リトライ」（同一内容再送）+「キャンセル」。入力を消さない。
  - 必須入力は曲名（＝song 選択）のみ。他は既定値で保存可（criterion 6）。

### Task 6 — セッション記録画面 SessionRecordScreen + セットリスト [criterion 1,8]
- src/components/session/session-record-screen.tsx。
- ヘッダ: venueName + 母店バッジ（info）+ 日付 + ⋯ メニュー（「セッションを終了」）。
- リスナー客トグル → 変更で即 PATCH /api/sessions/:id {hasListeners}（楽観更新 or mutate）。
- セットリスト: session.performances（order_index 順）をカード表示。各行: 番号・songTitle・フロント編成（vo → as → as → ts）・バッジ（participation SAX/PIANO/不参加=neutral, CALL=success, 譜面なし=warning）。行タップ → 編集用 SongPerformanceSheet（mode=edit, 値流し込み）。⋯ → 削除（確認ダイアログ → DELETE /api/performances/:id → mutate）。
- 「＋ 曲を追加」（secondary — Primary ではない）→ SongPerformanceSheet（mode=create）。
- 下部固定バー: 「次の曲を考える」（Primary h-10, 画面内唯一の Primary）→ /suggest（unit-06 未完成時プレースホルダーへ遷移）。BottomNav と重ならない配置。
- 終了: 確認ダイアログ（Destructive スタイルを使わない通常ボタン）→ PATCH {status:"ENDED"} → 履歴詳細 /sessions/:id へ。

### Task 7 — 履歴 /sessions と詳細 /sessions/[id] [criterion 1,8]
- src/app/(main)/sessions/page.tsx: useSessions() を新しい順一覧（日付・venueName・リスナー・母店バッジ）。行タップ → 詳細。
- src/app/(main)/sessions/[id]/page.tsx: useSession(id) 詳細。読み取り中心のセットリスト。
  - status==="ENDED" のときは「曲を追加」「次の曲を考える」を非表示。ただし各行 ⋯ から演奏記録の修正は可（SongPerformanceSheet edit を再利用）。削除も可（確認あり）。
  - status==="ACTIVE" の id を直接開いた場合はホームの記録画面へ誘導 or 記録画面コンポーネント再利用。

### Task 8 — 共有 UI プリミティブ拡張 [criterion 8]
- src/components/ui/badge.tsx に info/warning/success/neutral variant 追加（design_rule §6.3 の class + dark: 文字色）。
- 小物: セグメント選択（Segment）・トグル（Toggle）・確認ダイアログ（既存 Dialog ラップ）を src/components/session/ に共通化（アクセシブル: role/aria、focus-visible ring、h-10 タップ領域）。
- Sonner <Toaster /> を (main)/layout.tsx にマウント（handoff-notes 指示）。

### Task 9 — テスト（component / E2E 相当） [criterion 1-7]
tests/components/*.test.tsx（jsdom, fetch を vi.fn でモック, user-event 操作）:
- session-flow.test.tsx: 開始→曲追加（既存曲＋クイック登録）→編集→削除→リスナートグル→終了の一連。→ criterion 1
- start-session.test.tsx: 新規店舗名入力時のみ母店セグメント表示 / 既存選択時は非表示。→ criterion 2
- front-instruments.test.tsx: vo→as→as→ts 順で追加し、送信 payload の position 順序 & 表示順を検証。→ criterion 3
- quick-register.test.tsx: 検索ヒットなし→クイック登録→そのまま performance 追加まで。→ criterion 4
- post-failure-retry.test.tsx: POST を一度失敗させ、入力保持を確認しリトライで成功。→ criterion 5
- minimal-add.test.tsx: 曲名のみ（既定値）で保存完了。→ criterion 6
- sheet-reuse-contract.test.tsx: SongPerformanceSheet を initialSong 固定 + initialCalledByMe=true で開き、検索UIが出ず・コール ON 初期状態を検証。→ criterion 7
- 二重送信防止（送信中 disabled）は flow/failure テストで検証。

### Task 10 — 検証
- npm run typecheck, npm run lint, npm run test（node+dom 両 project）を通す。
- deployable: 既存 Docker 構成のまま。追加インフラなし（依存追加は swr + テスト devDeps のみ）。

---

## 成功基準カバレッジ（8/8）

1. 一連フロー @375px（component/E2E 相当） → Task 3,4,5,6,7 + Task9 session-flow
2. 新規店舗時のみ母店判定 → Task 4 + Task9 start-session
3. フロント編成 vo,as,as,ts 順・表示反映 → Task 5 + Task9 front-instruments
4. ヒットなし→クイック登録→追加 → Task 5 + Task9 quick-register
5. POST 失敗で入力保持+リトライ成功（fetch モック） → Task 5 + Task9 post-failure-retry
6. 曲名のみ既定値で完了 → Task 5 + Task9 minimal-add
7. 曲確定済み+calledByMe=true 初期状態で開けるテスト → Task 5 + Task9 sheet-reuse-contract
8. design_rule 準拠（Primary 1/画面・バッジ+テキスト・focus-visible・コントラスト） → 全 Task + Task 8

## リスク

- **既存 node テスト破壊**: jsdom 導入で 30+ 本の API/engine テストが壊れる恐れ。→ vitest projects で node/dom を環境分離し include を厳密化。
- **Primary ボタンの複数化**: 記録画面（次の曲を考える）と曲追加シート（保存）が同時に Primary。→ シートは overlay の独立コンテキスト扱い。記録画面本体の Primary は1つ・「曲を追加」は secondary に固定。空ホームは「セッションを開始」のみ Primary。
- **タップ領域 h-10 不足**: shadcn Button 既定 h-8。→ 主要操作は className で h-10 明示、design_rule §8.3 準拠。
- **クイック登録の 409（正規化同名既存）**: → details.song を選択状態に流用し、そのまま追加可（criterion 4 の一連性を担保）。
- **セッション開始の 409（ACTIVE 二重）/店舗名重複 409**: → toast + 既存へ誘導、venue 重複は既存 venue 利用にフォールバック。
- **swr 依存追加**: 軽量だが依存増。→ フェッチャは apiClient に集約し置換可能に保つ。
- **frontInstruments position の解釈差異**: サーバが 0.. に振り直す。→ フロントは追加順 index を position として送る（重複可）ことでサーバ挙動と一致。
- **unit-06 未完成**: 「次の曲を考える」→ /suggest は現状 PlaceholderCard。→ 遷移先はプレースホルダーのままで導線は成立（unit-06 完成時に置換）。