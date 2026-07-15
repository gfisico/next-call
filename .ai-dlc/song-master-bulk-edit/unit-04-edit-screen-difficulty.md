---
status: in_progress
last_updated: ""
depends_on: [unit-01-difficulty-attribute]
branch: ai-dlc/song-master-bulk-edit/04-edit-screen-difficulty
discipline: frontend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-04-edit-screen-difficulty

## Description
曲マスタ編集画面に演奏難易度 `difficulty`（1–5）の入力を追加し、「構成が単純」（simpleForm）チェックボックスを削除する。

## Discipline
frontend - do-frontend-development 系エージェントが実行。

## Domain Entities
- **Song.difficulty**（unit-01）を編集フォームに追加。`simpleForm` をフォームから削除。

## Data Sources
- `src/components/master/song-edit-screen.tsx`（:53 型, :70 初期値, :88 song→formState, :104 チェックボックス定義「構成が単純」, :171 保存ペイロード, :385-403 レベル UI）。
- API: PATCH/POST `/api/songs`（unit-01 の Zod に difficulty 追加済み前提）。
- 既存テスト: `tests/components/song-*.test.tsx`。

## Technical Specification
1. **フォーム状態**: `difficulty: number | null` を formState に追加（初期値 = song.difficulty、新規は null）。`simpleForm` を状態・型・チェックボックス定義（:104）・保存ペイロード（:171）から削除。
2. **UI**: 既存の「リスナー受け度 / 盛り上がり度」（Segment, :385-403）に倣い、**「演奏難易度」Segment（1–5）** を追加。null（未判定）を表現できるようにする（例: 「未設定」ボタン or 空状態）。ラベルは「演奏難易度」。
3. **保存**: PATCH ペイロードに difficulty を含める（null 可）。simpleForm は送らない。
4. **テスト**: difficulty の表示・変更・保存、simpleForm UI が存在しないこと。

## Success Criteria
- [ ] 編集画面に「演奏難易度」(1–5, 未設定可) が表示・編集・保存できる。
- [ ] 「構成が単純」チェックボックスが存在しない。
- [ ] difficulty が PATCH /api/songs に反映される。
- [ ] コンポーネントテストが緑。

## Risks
- **null(未判定) の UI 表現**: Segment は 1-5 の選択のみ。未判定をどう出すか。→ 緩和: 「未設定」チップ or クリアボタンを併設。listener/energy は default 3 だが difficulty は null 許容な点に注意。
- **アクセシビリティ**: 追加 Segment に aria-label を付与（既存パターン踏襲）。

## Boundaries
- difficulty の型/Zod/API は unit-01。
- 一括編集（xlsx）は unit-06。
- 本ユニットは編集画面 UI のみ。

## Notes
- 既存 Segment/LEVELS の実装をそのまま流用し、UI 一貫性を保つ。
