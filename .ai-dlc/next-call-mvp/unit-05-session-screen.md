---
status: pending
last_updated: ""
depends_on: [unit-03-master-session-api]
branch: ai-dlc/next-call-mvp/05-session-screen
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: ["/", "/sessions", "/sessions/[id]"]
deployment:
  target: docker
  artifacts: []
  environments: [production]
---

# unit-05-session-screen

## Description
アプリの主画面であるセッション記録画面を実装する。セッション開始（店舗選択/新規登録+母店判定）、演奏された曲の追加（クイック登録・フロント編成含む）、セットリスト表示・編集、リスナー客トグル、セッション終了、過去セッション閲覧まで。スマートフォン片手操作を最優先する。

## Discipline
frontend - This unit will be executed by do-frontend-development agents.

## Domain Entities
Session, Venue, Performance(+FrontInstrument), Song（検索・クイック登録）, Instrument。

## Data Sources
unit-03 のAPIのみ使用: /api/sessions*, /api/venues, /api/songs（検索）, /api/songs/quick, /api/instruments, /api/sessions/:id/performances。UI状態は React state + SWR/React Query 系のフェッチ（実装時に選定、依存は軽く）。

## Technical Specification

discovery.md「UI Mockup: セッション記録画面」を出発点とし、docs/design_rule.md に準拠する。

1. **ホーム `/`**:
   - ACTIVEセッションがある場合: セッション記録画面を表示
   - ない場合: 「セッションを開始」ボタン（Primary）+ 直近セッションのリスト（venue名・日付・曲数）
2. **セッション開始フロー**: ボタン → シート（Sheet）で店舗選択。既存店舗はリストから1タップ、新規は名前入力+「母店ですか？」の一度だけの選択（仕様§4.2: 以後表示しない）。リスナー客の有無トグル。開始で `POST /api/sessions`
3. **セッション記録画面（ACTIVE時の `/`）**:
   - ヘッダー: 日付・店舗名・母店バッジ・リスナー客トグル（即時 PATCH）
   - セットリスト: 演奏順のリスト（曲名、参加バッジ（SAX/PIANO/不参加）、コールバッジ、譜面なしアイコン、フロント編成表示）。タップで編集シート、スワイプまたはメニューで削除
   - **曲追加シート**（画面下部の Primary ボタン「曲を追加」）:
     - 曲名検索（インクリメンタル、title部分一致）→ 候補タップで選択
     - **ヒットなし時「『{入力}』を新規登録」ボタン → クイック登録**（needs_review。「あとでマスターを整備」のヒント表示）
     - 自分の参加: 不参加/サックス/ピアノ（セグメント選択、既定=サックス）
     - 自分がコールした（チェック）、譜面なしだった（チェック）
     - フロント編成（任意・折りたたみ）: 楽器コードのチップ（vo ss as ts bs tp fl fh harm tb cl g +追加分）をタップで順に追加。同一楽器の複数追加可。追加順が position。選択済みはチップ列で表示し、タップで削除
     - メモ（任意）
     - 保存で `POST performances` → シートを閉じずに連続追加できる「保存して次へ」も用意
   - **「次の曲を考える」ボタン**: 画面下部固定。unit-06 の選曲支援画面へ遷移（unit-06 未完成時はプレースホルダーへ）
   - セッション終了: メニューから（確認ダイアログ、Destructive ではなく通常ボタン。終了後は履歴へ）
4. **履歴 `/sessions` / `/sessions/[id]`**: 過去セッション一覧と詳細（読み取り中心。終了済みセッションの演奏記録の修正も可能）
5. **オフライン耐性（成功基準の範囲）**: 曲追加の POST 失敗時、入力内容を保持したままエラー表示+リトライボタン。二重送信防止
6. **アクセシビリティ**: design_rule §8 に従う（フォーカス可視化、タップ領域 h-10 以上、色のみに依存しない状態表示）

## Success Criteria
- [ ] セッション開始→曲追加（既存曲・クイック登録の両方）→ 編集・削除 → リスナートグル → 終了、の一連のフローがモバイルビューポート（375px）で操作できる（コンポーネント/E2E相当のテスト）
- [ ] 新規店舗登録時のみ母店判定が表示され、既存店舗選択時は表示されない
- [ ] 曲追加シートでフロント編成を vo, as, as, ts の順で登録でき、表示にも順序が反映される
- [ ] 検索ヒットなし→クイック登録→そのまま演奏記録として追加、が一連で行える
- [ ] POST 失敗時に入力値が消えず、リトライで成功する（fetch をモックしたテスト）
- [ ] 「曲を追加」タップから保存まで、必須入力は曲名のみ（他は既定値）で完了できる（＝短時間登録）
- [ ] 全画面が design_rule.md 準拠: Primary ボタンは画面内1つ、状態はバッジ+テキスト、focus-visible リング、コントラスト（deployable: 既存コンテナ構成のまま追加インフラなし）

## Risks
- **セッション中の誤操作**: 削除・終了の誤タップ。Mitigation: 削除は確認、終了は確認ダイアログ
- **検索のもたつき**: 入力毎のAPI呼び出し。Mitigation: debounce 250ms + 直近結果のキャッシュ
- **フロント編成UIの複雑化**: 任意入力なので折りたたみ既定で邪魔にしない

## Boundaries
選曲支援・推薦結果の画面は unit-06。曲マスターの属性編集画面は unit-07（needs_review 曲の属性補完も unit-07）。APIの実装は unit-03。

## Notes
- ワイヤーフレーム（mockups/）が生成されたら見た目の基準として従う
- 「次の曲を考える」導線は最重要（仕様§22-1: 記録が主機能、途中から選曲支援モードへ移る）
