---
status: in_progress
last_updated: "2026-07-12T18:16:28Z"
depends_on: [unit-03-master-session-api, unit-08-csv-import-api]
branch: ai-dlc/next-call-mvp/07-master-settings-screen
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
wireframe: mockups/unit-07-master-settings-screen-wireframe.html
views: ["/songs", "/songs/[id]", "/settings", "/settings/import"]
deployment:
  target: docker
  artifacts: []
  environments: [production]
hat: reviewer
---

# unit-07-master-settings-screen

## Description
曲マスター管理画面（一覧・検索・属性編集・needs_review補完）、エンジン設定画面（engine.* の調整）、CSVインポートウィザード（unit-08 の4段階フローのUI）、エクスポートダウンロードを実装する。セッション外（自宅等）でのメンテナンス用画面群。

## Discipline
frontend - This unit will be executed by do-frontend-development agents.

## Domain Entities
Song(+GenreTag), Instrument, Venue, Setting, ImportJob。

## Data Sources
unit-03 のAPI（songs/genre-tags/instruments/venues/settings/export）と unit-08 のAPI（import 4段階）。

## Technical Specification

discovery.md「UI Mockup: 曲マスター / インポート / 設定（概要）」を出発点とし、docs/design_rule.md に準拠。

1. **曲マスター一覧 `/songs`**:
   - 検索（title部分一致、debounce）+ フィルタチップ: 属性未整備（needs_review）／コール可能（has_played）／黒本1／季節／ジャンル
   - リスト行: 曲名、キー・構成バッジ、ジャンルタグ、needs_review 警告バッジ
   - **「属性未整備 n曲」のショートカット**を画面上部に表示（クイック登録された曲の補完導線。仕様の運用上重要）
   - 「新規追加」ボタン → 編集画面へ
2. **曲編集 `/songs/[id]`（新規は `/songs/new`）**:
   - 全属性のフォーム: 曲名、黒本キー、構成（AABA/ABAC/12小節ブルース/その他）、作曲者、演奏経験あり、譜面なし対応可、超定番、構成が単純、黒本1曲載、季節（春/夏/秋/冬/通年）、リスナー受け度（1–5）、盛り上がり度（1–5）、ジャンルタグ（9種チップ複数選択）、メモ
   - 保存で needs_review を自動解除するか確認（「属性の入力が完了しましたか？」チェック）
   - 削除（演奏記録が参照中の場合はAPIの409を受けて「履歴があるため削除できません」表示）
3. **設定 `/settings`**:
   - エンジン設定: discovery.md「Provisional Values」の設定キーをグループ表示（除外・減点／意図の重み／繰り返し減点／抽選／候補数）。各項目は数値入力またはスライダー（unit-06 と同じ Apple(iOS)風スタイル。**unit-06 が先に完了済みなら共有コンポーネント `components/ui/ios-slider` を使用し、未完了なら標準 Slider で暫定実装して unit-06 完了後に差し替える**）+説明文+既定値に戻すボタン
   - 楽器マスター管理: 一覧+追加（コード・表示名）
   - 母店設定: 店舗一覧と is_home の修正（初回判定の訂正手段）
   - データ管理: 「全データをエクスポート」（GET /api/export をダウンロード）
   - 設定変更は PUT /api/settings で即時保存し、トースト表示
4. **インポートウィザード `/settings/import`**（unit-08 の4段階フローのUI）:
   - Step1 アップロード: type選択（曲マスター/セットリスト履歴）+ CSVファイル選択
   - Step2 プレビュー: 総行数/有効行数、エラー行テーブル（行番号・理由・元データ）。setlists の場合: 未知店舗の母店区分確定UI（店舗ごとに 母店/母店以外 を選択）、曲名不一致の解決UI（近似候補から選択／新規スタブ作成／スキップ、を行ごとに選択。一括「すべてスタブ作成」も用意）
   - Step3 ドライラン: 差分サマリ（新規曲n・更新n・新規店舗n・新規セッションn・演奏記録n・スキップn）
   - Step4 コミット: recalc_has_played チェック付き実行 → 結果サマリ表示。破棄ボタンで DISCARDED
   - ウィザードは中断しても job_id で再開可能（PREVIEW中のジョブ一覧を表示）
5. **アクセシビリティ・レスポンシブ**: モバイル最優先だが、マスター整備・インポートはPC利用も想定し、テーブルは overflow-x-auto で崩さない（design_rule §6.5/§8）

## Success Criteria
- [ ] 曲マスター一覧の検索・各フィルタ・needs_review ショートカットが機能する（APIモックテスト）
- [ ] 曲編集で全属性（ジャンル複数選択含む）が保存でき、needs_review が解除できる
- [ ] 参照中の曲の削除で 409 エラーメッセージが表示される
- [ ] 設定画面で engine.* の値を変更・保存でき、「既定値に戻す」が機能する
- [ ] インポートウィザード4段階が一連で動作する: エラー行表示 → 店舗区分確定 → 曲名解決（match/stub/skip） → ドライラン差分 → コミット結果（APIモックで全分岐をテスト）
- [ ] エクスポートがファイルダウンロードとして機能する
- [ ] 375px（モバイル）と 1024px（PC）の両方でレイアウトが崩れない
- [ ] design_rule.md 準拠（テーブル・フォーム・バッジ・トーストの実装規約）（deployable: 追加インフラなし）

## Risks
- **設定項目の過多で迷子**: engine.* は20項目超。Mitigation: グループ化+説明文+既定値表示。「詳細設定」折りたたみ
- **インポートUIの複雑さ**: 曲名解決が数百件になる可能性。Mitigation: 未解決のみ表示・一括操作・件数バッジ
- **設定の誤入力でエンジン破綻**: 範囲外値。Mitigation: zodバリデーション（API側）+ 入力UIの min/max

## Boundaries
インポートのパース・解決・コミット処理は unit-08（本ユニットはUIのみ）。エクスポートAPI・マスターCRUD APIは unit-03。セッション中の画面は unit-05/06。Excel抽出スクリプトはCLI（unit-08）でありUI不要。

## Notes
- 設定キーの表示名・説明文・グループは discovery.md「Provisional Values」の表の日本語説明を流用する
- needs_review 補完の体験を軽くする（一覧から編集へ1タップ、保存後に次の未整備曲へ進むオプション）
