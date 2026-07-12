---
status: success
error_message: ""
provider_used: html
---

# Wireframe Generation Results

## Provider

Used: html (no design provider available / design_provider_type empty, design_blueprint_path empty → Mode B gray-box, design_rule.md のトーンに準拠)

## HTML Wireframes

- `mockups/unit-05-session-screen-wireframe.html` — セッション記録画面 (9 screens: ホーム(セッションなし) / 開始シート(既存店舗) / 開始シート(新規店舗+母店判定) / セッション記録(ACTIVE) / 曲追加シート(既存曲・フロント編成展開) / 曲追加シート(ヒットなし→クイック登録+送信失敗リトライ) / 終了確認ダイアログ / 履歴一覧 / 履歴詳細)
- `mockups/unit-06-recommend-screen-wireframe.html` — 選曲支援・推薦結果画面 (6 screens: 条件入力(初期表示・前回値引き継ぎ) / 条件調整(ジャンル上書き展開・1曲目の季節感推奨ON) / 結果待ちスケルトン / 推薦結果(通常3候補・保留中バッジ) / 候補少数isSparse+条件別候補 / 保留曲枠(警告バッジ・コール・解除))
- `mockups/unit-07-master-settings-screen-wireframe.html` — 曲マスター・設定・インポート画面 (9 screens: 曲マスター一覧(検索/フィルタチップ/needs_reviewショートカット) / 曲編集(全属性+ジャンル9チップ+409エラー) / 設定(エンジン設定グループ) / 設定(楽器・母店・データ管理) / インポートStep1アップロード / Step2プレビュー(エラー行/店舗区分/曲名解決) / Step3ドライラン差分 / Step4コミット・結果 / PC 1024pxテーブルレイアウト)

## Units Updated

- `unit-05-session-screen.md` — added wireframe field
- `unit-06-recommend-screen.md` — added wireframe field
- `unit-07-master-settings-screen.md` — added wireframe field

## Notes

- 全ワイヤーフレームは自己完結HTML（インラインCSSのみ・外部リソースなし・JSなし）、モバイル375px枠を主体。unit-07 のみタスク指示に従い 1024px の PC レイアウトセクションを追加（テーブルは overflow-x-auto 方針を注記）
- design_rule.md 準拠のトーン: 角丸（ボタン rounded-lg / カード rounded-xl / シート rounded-2xl / バッジ rounded-full）、h-10 相当のタップ領域、Primary ボタンは1画面1つ、状態は「色+テキスト」のバッジ（info=sky / warning=amber / success=emerald / danger=red の薄背景）。ベースはローファイのグレー
- discovery.md「UI Mockup」4画面（ASCII）を出発点に日本語UIコピーへ具体化。アプリシェル（ヘッダー+下部ナビ: セッション/推薦/マスター/設定）を反映
- ジャンルタグ9種は discovery.md の固定リスト（バラード/ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環/キメが多い曲）、ジャンル上書きチップは7種（バラード除外・仕様§10.2）を使用
- 季節感チェックのラベルは currentDate（7月）に合わせ「夏の曲を重視」の例で表示。実装ではセッション日付+engine.season_months から自動決定
- 解釈判断: (1) unit-06 の推薦結果カード内アクションは仕様どおり Secondary で統一し、下部固定は「条件を変えて再抽選」とした（結果表示後の画面に Primary を複数置かないため） (2) スライダー名の「攻め方」「場の温度」は仕様が左右ラベルのみ規定のため補った仮名 — copy-note で要レビューを明記 (3) セッション終了は仕様どおり非Destructiveの通常ボタン、削除・インポート破棄のみ Destructive
- 文言レビューが必要な箇所（母店の言い回し、クイック登録ヒント、isSparse注記、needs_review解除確認、スライダー名）は orange の copy-note でマーク済み
