---
status: pending
last_updated: ""
depends_on: [unit-04-recommendation-api, unit-05-session-screen]
branch: ai-dlc/next-call-mvp/06-recommend-screen
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
wireframe: mockups/unit-06-recommend-screen-wireframe.html
views: ["/sessions/[id]/recommend"]
deployment:
  target: docker
  artifacts: []
  environments: [production]
---

# unit-06-recommend-screen

## Description
選曲支援画面（編成条件・選曲意図の入力）と推薦結果表示を実装する。仕様§17.2の画面構造に対応。「次の曲を考える」→ 条件調整 → 候補3曲+理由 → コール登録 or 保留、の体験を30秒以内・タップ3回以内で成立させる。

## Discipline
frontend - This unit will be executed by do-frontend-development agents.

## Domain Entities
SelectionIntent（スライダー5+チェック2、前回値引き継ぎ）、編成条件（horns/beginner）、制約（kurobon1_only/genre_override）、RecommendationCandidate（理由付き候補）、PendingSong。

## Data Sources
unit-04 のAPIのみ: POST /api/sessions/:id/recommendations、GET .../recommendations/defaults、/api/pending-songs*。コール登録は unit-03 の POST performances を再利用（called_by_me=true 既定）。

## Technical Specification

discovery.md「UI Mockup: 選曲支援画面」「UI Mockup: 推薦結果表示」を出発点とし、docs/design_rule.md に準拠。1画面（`/sessions/[id]/recommend`）で条件と結果を上下に配置し、モーダル遷移を避ける。

1. **初期表示**: GET defaults で前回意図値をロード。1曲目のときのみ季節感チェックを推奨ONで初期化（ユーザーはOFFにできる。仕様§9.7）。編成は「わからない」既定
2. **編成条件セクション**:
   - 管楽器: 1人／複数／わからない（セグメント）
   - 初心者: いない／いる／わからない（セグメント）
3. **制約セクション**:
   - 黒本1: 制限なし／黒本1曲載のみ（セグメント。次の曲を選ぶ都度変更可。仕様§11.2）
   - ジャンル上書き（任意・折りたたみ）: ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環 のチップ複数選択（バラードは独立スライダーのため対象外。仕様§10.2）。「指定すると該当ジャンルを強く優先します」の説明文
4. **今回の意図セクション**（5段階スライダー×5 + チェック×2）:
   - 珍しい曲（強い減点⇔強い加点）／久しぶりの曲／安全に行く⇔攻める／落ち着かせる⇔盛り上げる／バラード（避けたい⇔やりたい）— 各スライダーに左右のラベルを直接表示（仕様§9.1）
   - **スライダーの外観はApple(iOS)風**（ユーザー指定・ワイヤーフレームレビュー確定）: 細いレール+中央からの青系ティント+白い円形ノブ（影付き）+5段階スナップのドット。shadcn/ui Slider をベースにカスタムスタイルで実現。**Apple(iOS)風スライダーは共有UIコンポーネント（`components/ui/ios-slider`）として実装する（実装責務は本ユニット。unit-07 の設定画面スライダーも同コンポーネントで同スタイルに統一）**
   - 季節感チェック（現在の季節を「春の曲を重視」の形でラベル表示）／リスナー受けチェック（セッションのリスナー客=なしのとき無効化はせず、単に既定OFF）
5. **「候補を出す」ボタン**（Primary・画面下部固定）→ POST recommendations → 結果セクションへスクロール
6. **推薦結果表示**:
   - 通常候補カード（約3曲）: 曲名（大）、キー・構成・作曲者のメタ行、推奨理由（2〜4件の箇条書き）、保留中バッジ（該当時）。アクション: 「この曲をコール」（Primary相当は候補カード外に1つなので Secondary で統一）／「保留に追加」
   - isSparse のとき: 「条件が強く、候補が{n}曲に絞られました」の注記（無理に増やさない。仕様§14.5）
   - 条件別候補: 「1管なら」「複数管なら」「初心者が参加するなら」のラベル付きカード（存在時のみ）
   - **保留曲枠**: 通常候補の下に無条件で全保留曲を表示。警告バッジ（当日演奏済み／直前と同構成／黒本1条件外／編成に合いにくい）。アクション: 「コール」／「保留解除」
   - 「条件を変えて再抽選」ボタン（意図セクションへ戻る）
7. **コール登録フロー**: 候補の「この曲をコール」→ unit-05 の曲追加シートを called_by_me=true・曲確定済みの状態で開く（参加楽器等を確認して保存）→ 保存後セッション記録画面へ戻る。保留中の曲なら自動解除される（unit-04）
8. **タップ数の担保**: セッション記録画面「次の曲を考える」(1) → 「候補を出す」(2) → 候補確認、で最短2タップ。条件調整は任意

## Success Criteria
- [ ] defaults ロード→スライダー・チェック・編成・制約の変更→「候補を出す」→ 候補+理由表示、の一連が375pxで動作する（APIモックのテスト）
- [ ] 前回意図値が引き継がれて表示され、変更した項目だけが変わる（仕様§9冒頭）
- [ ] 1曲目のとき季節感が推奨ONで表示され、OFFに変更できる
- [ ] 候補カードに推奨理由が2件以上表示される。isSparse 時に注記が出る
- [ ] 条件別候補がラベル付きで区別して表示される（horns=UNKNOWN のモックデータ）
- [ ] 保留曲枠が通常候補と独立して常時表示され、警告バッジ・コール・解除が機能する
- [ ] 「この曲をコール」→ 曲追加シート（called_by_me=true・曲確定）→ 保存 → セッション画面へ戻る、が動作する
- [ ] 「次の曲を考える」から候補表示まで最短2タップ（テストシナリオで確認。成功基準のタップ3回以内を満たす）
- [ ] design_rule.md 準拠（スライダー・チップ・カード・バッジの実装は shadcn/ui ベース）（deployable: 追加インフラなし）

## Risks
- **スライダーのモバイル操作性**: 誤タッチ。Mitigation: スライダーは5段階スナップ、タッチ領域を大きく
- **結果待ちの体感**: 推薦APIが重い場合の不安。Mitigation: スケルトン表示+ボタン無効化（二重実行防止）
- **画面の縦長化**: 全セクション展開で長くなる。Mitigation: 制約・ジャンル上書きは折りたたみ既定、結果へ自動スクロール

## Boundaries
推薦ロジック・理由文の生成はエンジン（unit-02）とAPI（unit-04）。曲追加シートは unit-05 の部品を再利用（重複実装しない）。設定画面は unit-07。

## Notes
- 理由はAPIが返す文字列をそのまま表示する（フロントで加工しない）
- ジャンル上書きは「強い加点」であることをUI文言でも誤解なく（「絞り込み」とは書かない）
