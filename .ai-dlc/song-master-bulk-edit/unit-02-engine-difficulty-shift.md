---
status: pending
last_updated: ""
depends_on: [unit-01-difficulty-attribute]
branch: ai-dlc/song-master-bulk-edit/02-engine-difficulty-shift
discipline: backend
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
---

# unit-02-engine-difficulty-shift

## Description
推薦エンジンの安全性スコア（§9.4「攻め方」軸）と初心者対応（§8.2/§12.1 完全除外）を `simpleForm` から `difficulty` ベースへ移行する。一次仕様のドキュメントも同期する。

## Discipline
backend - エンジン純関数と設定・仕様。

## Domain Entities
- **EngineSong.difficulty**（unit-01 で追加）を安全性・初心者判定に使用。`simpleForm` は参照しない。

## Data Sources
- `src/engine/score.ts:50-59`（safetyScore）。
- `src/db/seed.ts:57-71`（`engine.safety_weights`）。
- `src/engine/predicates.ts:17-22`（isBeginnerFriendly）。
- `src/engine/exclude.ts`（beginner=PRESENT の除外）。
- 仕様: `docs/jazz_session_song_recommendation_spec_v2.md`（§9.4 安全性 / §8.2・§12.1 初心者対応 / §21 暫定値）。
- 既存テスト: `tests/engine/*.test.ts`（score / exclude 等）。

## Technical Specification
1. **safetyScore**（`src/engine/score.ts`）: `simpleForm(+2)` の項を削除し、difficulty 項を追加。
   - 低難易度ほど安全側（+）。案: `difficulty` が非 null のとき `(3 - difficulty) * w_diff`（difficulty 1→+2, 3→0, 5→−2 相当。従来 simpleForm の ±2 レンジと整合）。`difficulty` が null のとき寄与 0（中立）。
   - 係数・中点は `engine.safety_weights` に追加（例 `difficulty_coef`, `difficulty_midpoint: 3`）。seed 更新。
2. **seed** (`src/db/seed.ts`): `engine.safety_weights` から `simple_form` を削除し difficulty 係数を追加。コメント（#5 計算式）も更新。
3. **初心者対応**（`src/engine/predicates.ts` `isBeginnerFriendly`）: `difficulty !== null && difficulty <= 2` に変更。`is_standard/no_chart_ok/simpleForm` の AND は撤去。
4. **exclude**（`src/engine/exclude.ts`）: コメント（§8.2/§12.1）を新ルールに更新。null difficulty は「評価不能→安全側で除外」（既存の null 安全側方針を踏襲）。
5. **仕様同期**: `docs/jazz_session_song_recommendation_spec_v2.md` の §9.4（安全性判定材料から simple_form を外し difficulty を明記）、§8.2/§12.1（初心者対応 = difficulty≤2）、§21 暫定値（weights）を更新。
6. **テスト更新/追加**: safetyScore の difficulty 寄与、beginner=PRESENT で difficulty≤2 のみ通過・null 除外、を検証。既存 simpleForm 前提テストを difficulty 前提へ移行。

## Success Criteria
- [ ] safetyScore が simpleForm を参照せず、difficulty(null=中立) を安全側寄与に反映する。
- [ ] beginner=PRESENT 時、difficulty∈{1,2} の曲のみ通過し、difficulty=null や ≥3 は除外される。
- [ ] `engine.safety_weights` に simple_form が無く difficulty 係数がある（seed）。
- [ ] 仕様書 §9.4/§8.2/§12.1/§21 が difficulty ベースに更新されている。
- [ ] 関連エンジンテストが緑（difficulty 前提へ移行済み）。

## Risks
- **スコア分布の変化**: 係数設計次第で推薦結果が大きく変わる。→ 緩和: 従来 simpleForm の ±2 レンジに合わせた写像を既定とし、テストで代表ケースの符号・大小関係を固定。
- **null 曲の急増**: 移行直後は多くの曲が difficulty=null。初心者対応で大量除外される恐れ。→ 緩和: null=除外は仕様通りだが、Notes に「difficulty 未判定曲は一括編集で早期に埋める」運用を明記（unit-06 手順書へ）。

## Boundaries
- difficulty 列/型の追加は unit-01。
- インポート列変更は unit-03、編集画面は unit-04。
- 本ユニットはエンジン純関数・設定・仕様のみ。

## Notes
- 既存の null 安全側方針（`src/engine/predicates.ts` ヘッダ, types.ts:57 コメント）に一貫させる。
- 係数の最終値は planner が仕様と突き合わせて確定。midpoint=3（1-5 の中央）を推奨。
