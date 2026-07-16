---
intent_slug: next-call-enhancements
worktree_path: /Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-enhancements
project_maturity: established
iterates_on: next-call-mvp
---

# 目的

next-call MVP のフォローアップ intent。既存コードベース（この worktree）を精読し、以下9件の拡張要件それぞれについて
「影響する既存ファイル / 現在の実装 / 必要な変更（スキーマ・API・UI）」を特定して discovery.md に追記せよ。
新規発明ではなく、既存の構造（Drizzle schema, repositories, server層, app router 画面, components）に沿った差分を洗い出すこと。

# 決定済み事項（elaborate Q&A で確定）

- セッション削除: 物理削除＋確認ダイアログ。紐づく Performance / 推薦履歴も完全削除。
- メモ移行: 複数セッション分のテキストを一括貼付 → パース → プレビュー補正 → 取込。既存 CSV import とは別経路。
- 参加者記録: 構造化（パート×人数）。楽器マスタ連動でパート別人数を数値保持。リスナー数は別カウント。ホストパートは楽器参照。
- 統計指標: (1) 曲別コール/演奏回数・最終演奏日, (2) ジャンル/キー/構成の分布, (3) 季節別/店別/母店別の傾向, (4) 期間推移(月別)。絞り込み: 店/母店・季節。
- バージョン番号: SSOT 定数を導入し、マスタ設定画面のみに表示（vYYYYMMDD-NN, JST, docs/version_number.md 準拠）。
- ダークモード: クラス方式（.dark on html）, トグルは全画面共通ヘッダー右上, 配色は本アプリのベースカラーから設計（docs/dark_mode.md 準拠）。
- 進め方: dev 単一パス。

# 9件の拡張要件

1. 履歴導線: セッション画面からも推薦履歴に戻れる導線を追加（推薦画面と同等）。
2. フロント編成表記: セットリストのフロント編成を「as→ts」矢印から「as, ts」カンマ区切りへ（内部データ順序は保持、表示のみ変更）。
3. 曲順編集: セットリスト画面で Performance.order_index を編集できるように。
4. セッション削除（上記決定どおり）。
5. セッション基本情報の修正: session_date / venue の後編集。
6. 統計画面（上記指標・絞り込み）。
7. セッション詳細記録: パート別参加者数（リスナー含む）・ホストパート・メモ（上記決定どおり構造化）＋既存メモ一括パース移行。
8. バージョン番号ルール導入（上記決定どおり）。
9. ダークモード導入（上記決定どおり）。

# 調べて discovery.md に書くこと

- `src/db/schema.ts` の現行 Session / Performance / PerformanceFrontInstrument / Venue / Instrument 定義。要件7で必要な新テーブル/カラム（SessionParticipant(part, count) 的なもの・host_instrument・listener 数の持ち方）と、Drizzle migration の追加方針。
- セッション画面・セットリスト表示の該当コンポーネント（src/components/session, src/app/(main)）と、履歴導線・カンマ表記・曲順編集・セッション編集/削除の変更点。
- 既存 API / repositories（src/server, src/lib/api）でセッション CRUD・Performance 並べ替え・削除に不足しているエンドポイント。
- 統計に必要な集計クエリの置き場所（repositories か新 server/stats か）と、既存の集計（登場回数・久しぶり度）の実装場所。
- フロント編成表示のフォーマット箇所（どこで as→ts を生成しているか）。
- ルートレイアウト（src/app/layout.tsx 等）・Tailwind 設定（darkMode 設定の有無）・globals.css のトークン定義状況（ダークモード導入の前提）。design_rule.md のトークン。
- バージョン SSOT を置く場所（src/version.ts 等）と、マスタ設定画面のファイル。
- 既存メモの一括パース取込の実装場所（server/import 配下の既存 CSV import を参照）とパーサの検討点（部分表記→楽器マスタ照合、曲名照合、記号 🎷🎹👆🔰 の解釈、※注記）。
- quality_gates 検出: package.json の scripts（typecheck/lint/test/build）。

# 参考（前 intent のドメインモデル要約）

Song / GenreTag / Instrument / Venue / Session / Performance / PerformanceFrontInstrument /
SelectionIntent / RecommendationRequest / RecommendationCandidate / PendingSong / Setting / User(Auth.js)。
詳細は .ai-dlc/next-call-mvp/intent.md と discovery.md、docs/jazz_session_song_recommendation_spec_v2.md 参照。

# 出力

discovery.md（この worktree の .ai-dlc/next-call-enhancements/discovery.md）に、要件ごとの「影響ファイル・現状・変更方針」セクションと、
`## Domain Model Delta`（新規/変更エンティティ）、`## Quality Gate Candidates`（検出したコマンド）を追記せよ。
最後に、要件→ユニット分解の示唆（どれが独立ユニットになるか、依存関係）も簡潔に述べよ。
