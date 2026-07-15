---
status: completed
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
- `src/engine/reasons.ts:113-116`（isBeginnerFriendly を使う初心者向き理由文の生成）。
- `src/engine/types.ts:264`（ReasonCode の該当コメント「…構成が単純で初心者向き」）。
- 仕様: `docs/jazz_session_song_recommendation_spec_v2.md`（§9.4 安全性 / §8.2・§12.1 初心者対応 / §21 暫定値）。
- 既存テスト: `tests/engine/*.test.ts`（score / exclude / reasons 等）。

## Technical Specification
1. **safetyScore**（`src/engine/score.ts:50-59`）: `simpleForm(+2)` の項を削除し、difficulty 項を追加。
   - 低難易度ほど安全側（+）。案: `difficulty` が非 null のとき `(3 - difficulty) * w_diff`（difficulty 1→+2, 3→0, 5→−2 相当。従来 simpleForm の ±2 レンジと整合）。`difficulty` が null のとき寄与 0（中立）。
   - **重要（配線の現状）**: `safetyScore` は係数を**ハードコード**しており、`config.ts` は `engine.safety_weights` を読み込んでいない（`EngineConfig` に safety フィールドなし＝seed 値は現状デッド）。したがって difficulty の係数・midpoint(=3) も **`score.ts` にハードコード**する（既存 simple_form 係数と同じ扱い）。`w_diff` は config 由来ではない。
2. **seed** (`src/db/seed.ts:57-71`): `engine.safety_weights` から `simple_form` を削除し difficulty 係数を追記、コメント（#5 計算式）も更新する。**ただしこれはドキュメント目的のみで実行時挙動には影響しない**（上記の通り config へ未配線）。seed を真の設定源にする config 配線は**今回スコープ外**（別 intent）。
3. **初心者対応**（`src/engine/predicates.ts:17-22` `isBeginnerFriendly`）: `difficulty !== null && difficulty <= 2` に変更。`is_standard/no_chart_ok/simpleForm` の AND は撤去。
4. **exclude**（`src/engine/exclude.ts`）: コメント（§8.2/§12.1）を新ルールに更新。null difficulty は「評価不能→安全側で除外」（既存の null 安全側方針を踏襲）。
5. **理由文の同期**（`src/engine/reasons.ts:113-116` + `src/engine/types.ts:264`）: `isBeginnerFriendly` 由来の初心者向き理由文「超定番・譜面なし対応可・**構成が単純**で初心者向き」を difficulty ベースへ更新（例「難易度が低く初心者向き」。実態＝difficulty≤2 に合わせる）。types.ts の ReasonCode コメントも同様に更新。※関数は共有なので判定は自動追随するが、**表示テキストは手動更新が必須**。
6. **仕様同期**: `docs/jazz_session_song_recommendation_spec_v2.md` の §9.4（安全性判定材料から simple_form を外し difficulty を明記）、§8.2/§12.1（初心者対応 = difficulty≤2）、§21 暫定値を更新。
7. **テスト更新/追加**: safetyScore の difficulty 寄与、beginner=PRESENT で difficulty≤2 のみ通過・null 除外、初心者向き理由文が difficulty ベース（「構成が単純」を含まない）、を検証。既存 simpleForm 前提テストを difficulty 前提へ移行。

## Success Criteria
- [ ] safetyScore が simpleForm を参照せず、difficulty(null=中立) を安全側寄与に反映する。
- [ ] beginner=PRESENT 時、difficulty∈{1,2} の曲のみ通過し、difficulty=null や ≥3 は除外される。
- [ ] 初心者向き理由文（reasons.ts / types.ts:264 コメント）が difficulty ベースに更新され、「構成が単純」を含まない。
- [ ] difficulty 係数・midpoint は `score.ts` にハードコードされ挙動に反映される（seed の `engine.safety_weights` 更新はドキュメント目的で挙動不変）。simple_form 係数は削除。
- [ ] 仕様書 §9.4/§8.2/§12.1/§21 が difficulty ベースに更新されている。
- [ ] 関連エンジンテスト（score/exclude/reasons）が緑（difficulty 前提へ移行済み）。

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
