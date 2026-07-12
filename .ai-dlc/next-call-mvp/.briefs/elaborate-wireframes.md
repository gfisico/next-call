---
intent_slug: next-call-mvp
worktree_path: /Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-mvp
intent_title: next-call — ジャズセッション向け選曲提案アプリ MVP
design_provider_type: ""
design_provider_capabilities: ""
design_provider_mcp_hint: ""
design_blueprint_path: ""
---

# Frontend & Design Units

## unit-05-session-screen

**File:** unit-05-session-screen.md
**Description:** 主画面。セッション開始（店舗選択/新規+母店判定）、曲追加シート（検索/クイック登録/参加/コール/譜面なし/フロント編成チップ/メモ）、セットリスト表示・編集、リスナー客トグル、「次の曲を考える」固定ボタン、セッション終了、履歴閲覧。
**Domain Entities:** Session, Venue, Performance(+FrontInstrument), Song, Instrument
**Technical Spec:** 仕様全文は unit-05-session-screen.md を読むこと。views: "/", "/sessions", "/sessions/[id]"。モバイル375px最優先。

## unit-06-recommend-screen

**File:** unit-06-recommend-screen.md
**Description:** 選曲支援+推薦結果。編成条件（管楽器/初心者セグメント）、制約（黒本1、ジャンル上書きチップ折りたたみ）、意図スライダー5本（左右ラベル直接表示）+チェック2、「候補を出す」固定ボタン、候補カード（曲名/メタ/理由2-4件/コール/保留）、候補少数時の注記、条件別候補、保留曲枠（警告バッジ/コール/解除）、再抽選。
**Domain Entities:** SelectionIntent, RecommendationCandidate, PendingSong
**Technical Spec:** 仕様全文は unit-06-recommend-screen.md を読むこと。views: "/sessions/[id]/recommend"。1画面で条件→結果を上下配置。

## unit-07-master-settings-screen

**File:** unit-07-master-settings-screen.md
**Description:** 曲マスター一覧（検索/フィルタチップ/needs_reviewショートカット）、曲編集フォーム（全属性+ジャンル9チップ）、設定画面（engine.*グループ表示/楽器マスター/母店設定/エクスポート）、インポートウィザード4段階（アップロード→プレビュー(エラー行/店舗区分確定/曲名解決)→ドライラン差分→コミット）。
**Domain Entities:** Song(+GenreTag), Instrument, Venue, Setting, ImportJob
**Technical Spec:** 仕様全文は unit-07-master-settings-screen.md を読むこと。views: "/songs", "/songs/[id]", "/settings", "/settings/import"。モバイル+PC両対応。

# Design Context

- デザインシステム: docs/design_rule.md（Tailwind + shadcn/ui、カラートークン、Primary1画面1つ、h-10タップ領域、focus-visible、rounded-lg/xl/2xl、バッジ規約）。ワイヤーフレームHTMLもこのトークン/トーンに沿わせること（ローファイでよいが構造・導線・文言は本物に近く）
- discovery.md の「UI Mockup」4画面（ASCII）が構造の出発点。これをHTML化・具体化する
- アプリシェル: ヘッダー+下部ナビ（セッション/推薦/マスター/設定）

# Domain Model Reference

- Song: title, 黒本キー, 構成(AABA/ABAC/BLUES12/OTHER), 作曲者, has_played, 譜面なし対応可, 超定番, 構成が単純, 黒本1, 季節, リスナー受け度1-5, 盛り上がり度1-5, needs_review, ジャンルタグ9種（複数）
- Performance: 参加(不参加/SAX/PIANO), called_by_me, no_chart, フロント編成（vo ss as ts bs tp fl fh harm tb cl g 順序付き重複可）
- 意図スライダー: 珍しい曲/久しぶり/安全⇔攻める/落ち着かせる⇔盛り上げる/バラード（5段階）+ 季節感/リスナー受けチェック
