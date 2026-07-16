---
status: pending
last_updated: ""
depends_on: [unit-02-session-detail-schema-import-api]
branch: ai-dlc/next-call-enhancements/03-session-screen-overhaul
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: ["/session"]
---

# unit-03-session-screen-overhaul

## Description
セッション記録画面まわりの UI 拡張をまとめて担う。`session-record-screen.tsx` の単独所有者として、履歴導線・フロント編成カンマ表記・曲順編集・セッション編集/削除・詳細記録（参加者/ホスト/メモ）・メモ一括移行UI を実装する。要件1・2・3・4・5・7 のフロント。

## Discipline
frontend - `src/components/session`・`src/app/(main)` の画面/コンポーネントを実装し、unit-01/unit-02 のAPIを呼ぶ。

## Domain Entities
Session（編集/削除/詳細）, Performance（曲順・フロント編成表示）, PerformanceFrontInstrument（カンマ表記）, SessionParticipant（参加者入力）, Instrument（ホスト/参加者選択）, RecommendationRequest（履歴導線の遷移先）。

## Data Sources
- unit-01 API: `PATCH /api/sessions/:id`（編集）, `DELETE /api/sessions/:id`（削除）, `PATCH .../performances/order`（並べ替え）。
- unit-02 API: 参加者 `PUT /api/sessions/:id/participants`、メモ移行 `POST /api/sessions/import-memo/{preview,commit}`。
- 既存の推薦履歴ルート（推薦画面が持つ履歴導線と同じ遷移先）。

## Technical Specification
1. **履歴導線（要件1）**: セッション画面に推薦履歴への導線（ボタン/リンク）を追加。推薦画面と同じ遷移先・同じ見た目の踏襲。
2. **フロント編成カンマ表記（要件2）**: `session-record-screen.tsx` L210 付近の「as→ts」生成を「as, ts」に変更。position 順は保持（内部データは不変、表示ロジックのみ）。矢印記号を除去。
3. **曲順編集（要件3）**: セットリストの並べ替えUI（ドラッグ並べ替え、または上下移動ボタンのいずれか docs/design_rule.md に沿う方式）＋明示保存。保存で unit-01 の reorder API を呼ぶ。編集中/保存中/失敗の状態を表示。
4. **セッション編集（要件5）**: 日付・店舗を編集するフォーム/ダイアログ。venue は既存 Venue から選択。保存で PATCH。
5. **セッション削除（要件4）**: 操作メニューから削除→確認ダイアログ（削除対象と不可逆である旨を明示）→ DELETE。成功後は一覧/履歴へ遷移。
6. **詳細記録（要件7）**: パート別参加者数入力（楽器マスタから行追加＋人数）、リスナー数入力、ホストパート選択、セッションメモ欄。保存で participants API。
7. **メモ一括移行UI（要件7）**: テキスト貼付→preview 呼び出し→解析結果（セッション単位、要確認/警告をハイライト）をプレビュー表示→ユーザー補正→commit。取込結果を通知。

すべて docs/design_rule.md 準拠（Primary は1つ・h-10・focus-visible・コントラスト・モバイル操作性）。既存のデザイントークン（globals.css）のみ使用し raw hex 禁止。ダークモードのトグル機構自体は unit-06 が入れるが、本ユニットの新規UIも `.dark` トークンで破綻しないこと。

## Success Criteria
- [ ] セッション画面から推薦履歴へ遷移でき、推薦画面の導線と挙動が一致する
- [ ] フロント編成が「as, ts」カンマ区切りで表示され、position 順が保たれる（矢印は出ない）
- [ ] セットリストの曲順を UI で編集・保存でき、再読込後も反映される
- [ ] セッションの日付・店舗を編集・保存できる
- [ ] 削除は確認ダイアログを経て実行され、成功後に適切な画面へ遷移する
- [ ] パート別参加者数・リスナー数・ホストパート・メモを入力・保存でき、再表示される
- [ ] メモ貼付→プレビュー（要確認/警告表示）→補正→取込 の一連が動作する
- [ ] 追加/改修UIが docs/design_rule.md に準拠し、モバイルで操作可能。typecheck / lint / test / build がパスする

## Risks
- **単一ファイルの肥大**: `session-record-screen.tsx` に機能が集中。Mitigation: 機能ごとにサブコンポーネント分割（並べ替え・編集ダイアログ・詳細記録・メモ移行）。
- **並べ替えの体感**: モバイルでのドラッグ操作。Mitigation: 上下移動ボタンのフォールバックを用意。
- **メモ移行の取り違え**: Mitigation: 確定前に必ずプレビューで差分/要確認を提示し、ユーザー確定を必須にする。

## Boundaries
API・スキーマ・パーサは実装しない（unit-01/unit-02）。ダークモードのトグル/FOUC/localStorage 機構とバージョン表示は unit-06。統計画面は unit-05。`bottom-nav.tsx`・`(main)/layout.tsx`ヘッダー・`settings-screen.tsx` は編集しない。depends_on: unit-02（→unit-01 も推移的に完了）。

## Notes
- `session-record-screen.tsx` はこのユニットのみが編集する（競合回避のため）。
- 曲順編集の方式（ドラッグ vs 上下ボタン）は builder が design_rule に沿って決定してよい。
