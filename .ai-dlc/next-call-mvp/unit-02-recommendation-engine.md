---
status: completed
last_updated: "2026-07-12T12:47:50Z"
depends_on: [unit-01-app-foundation]
branch: ai-dlc/next-call-mvp/02-recommendation-engine
discipline: backend
pass: ""
workflow: tdd
ticket: ""
design_ref: ""
views: []
hat: reviewer
---

# unit-02-recommendation-engine

## Description
推薦の中核となる**DB非依存の純関数パイプライン**を実装する。`(曲+事前集計, 編成条件, 選曲意図, 設定, 乱数seed) → (通常候補+条件別候補+理由)` の副作用なし関数。仕様書§8/§10/§11/§12/§13/§14/§15の全ルールを、discovery.md「Recommendation Logic Analysis」の9ステージ構成で実装する。**TDDワークフロー**: ルール1つにつき失敗するテストを先に書く。

## Discipline
backend - This unit will be executed by backend-focused agents.

## Domain Entities
Song（全属性+ジャンル集合）、SelectionIntent（スライダー5+チェック2）、直前Performance（key/form/composer/genres/kurobon1/season/フロント編成のvo有無）、推薦履歴（繰り返し減点の入力）、Setting（engine.*）。エンティティはDB行ではなく **エンジン専用の入力型（EngineInput）** として定義し、DBからの詰め替えは unit-04 が担う。

## Data Sources
- なし（純関数）。`src/engine/` 配下に実装し、DB・fetch・Date.now()・Math.random() を直接使わない
- 乱数は seed 注入（xorshift等の決定的PRNG）、現在日時・現在季節は引数で受け取る
- 設定値は `EngineConfig` オブジェクトで受け取る（キーと既定値は discovery.md「Provisional Values」が唯一の情報源。ただしジャンル上書きは**ユーザー決定によりフィルタではなく強い加点 +15**: `engine.genre_override_bonus`、指定ジャンルの低頻度減点は無効化）

## Technical Specification

`src/engine/` のモジュール構成（関数シグネチャは実装時に確定してよいが、ステージ分割とテスト容易性を維持すること）:

1. `types.ts` — EngineInput / EngineConfig / EngineResult（candidates, conditionalCandidates, pendingSongs, isSparse）/ Reason 型
2. `exclude.ts` — **Stage 1 完全除外**: has_played=false／当日演奏済み／直前曲とform同一／初心者AND条件（is_standard AND no_chart_ok AND simple_form）違反／kurobon1_only時の非掲載。needs_review 等で属性が未設定の曲は該当ルールを安全側にスキップ（除外条件が評価不能なら除外しない、初心者ANDは満たさない扱い）。**直前 Performance が存在しない場合（セッション1曲目）、直前曲参照ルール（同form除外・同キー減点・特殊ジャンル連続減点・同作曲者減点・§12.5 vo減点・「直前曲と変わる」理由）はすべてスキップする（減点・除外・理由なし）**
3. `score.ts` — **Stage 2–4**: 編成減点（horns=MULTIの歌もの −15）／スコア = BASE(50) + スライダー寄与（珍しい曲・久しぶり・安全性・雰囲気・バラード）+ チェック寄与（季節感+10・リスナー (listener_level−3)×4）− ルール減点（同キー−15/F・B♭−8、特殊ジャンル連続8種 −15/種、ブルース−10、同作曲者−5、累計コール上位10曲 −12、低頻度ジャンル −8）。**ジャンル上書き指定時は該当曲 +15 かつ当該ジャンルの低頻度減点なし**。**§12.5: 直前曲のフロント編成に vo が含まれる場合、歌もの属性の曲に減点（engine.after_vocal_vocal_penalty、既定15（正値。減点として適用）。直前曲のフロント編成未入力時はスキップ）**。各寄与式・係数は discovery.md の表に厳密に従う
4. `repeat.ts` — **Stage 5 繰り返し減点**: 前回提示 −12／直近5リクエスト（30日）−6／同一condition_signature 3回以上 追加−6／前回提示ジャンル −3。Stage1–3通過曲数 < 8 で全て半減
5. `select.ts` — **Stage 6–7**: 候補集団（maxScore−10 かつ ≥30、不足時 −15 へ一度だけ拡大、candidate_count未満なら isSparse=true で少ないまま返す）→ softmax重み付き非復元抽出（τ=5、抽出ごとに同特殊ジャンルの残余weight ×0.5）
6. `reasons.ts` — **Stage 8 理由生成**: 固定テンプレート最大4件/曲（discovery.md のテンプレート表に従う。「最終演奏から{n}年ぶり」「この店では登場{a}回と少なめ」等）。各候補に最低2件付くこと。**発火した理由が2件未満のときのみ、常に生成可能な事実ベースのフォールバックテンプレート（「黒本キー{key}・{form}構成」「この2年で{a}回演奏」等。discovery.md Stage 8 のフォールバック表に従う）で2件まで補完する（発火していない理由を捏造しない）**
7. `conditional.ts` — **Stage 9 条件別候補**: horns/beginner が UNKNOWN のとき各2ブランチで再実行し、通常候補と重複しない最上位曲のみ「1管なら」等のラベルで追加。**組み合わせ規則: 各軸を独立に分岐し、分岐しない側の軸は入力値（UNKNOWN のままの通常候補ロジック=除外・減点なし）を維持する。両軸が UNKNOWN でもブランチは最大4本（1管/複数管/初心者なし/初心者あり）で、組み合わせブランチ（1管×初心者あり等）は生成しない**
8. `pending.ts` — 保留曲の注釈: スコア不干渉・無条件表示。完全除外該当時の警告バッジ判定（当日演奏済み／同構成／黒本1条件外／編成に合いにくい）
9. `index.ts` — `recommend(input, config, seed)` として全ステージを合成
10. `condition-signature.ts` — 編成+黒本1+ジャンル上書き+スライダー符号から署名文字列を生成（繰り返し減点用）

## Success Criteria
- [x] 完全除外5条件それぞれに「除外される/されない」の境界テストがあり、除外曲が候補・条件別候補に**一切**現れない
- [x] スコアリングの各寄与（スライダー5・チェック2・減点8種・ジャンル上書き+15）に個別の単体テストがあり、寄与式が discovery.md の表と一致する。§12.5（直前曲vo→歌もの減点）は「voあり/なし/フロント編成未入力」の3ケースをテストする
- [x] 繰り返し減点: 同一条件で連続実行すると前回提示曲のスコアが下がることをテストで検証。通過曲数<8での半減もテストする
- [x] 抽選: 固定seedで結果が再現する。高スコア曲ほど選出頻度が高いことを統計的テスト（1000回試行）で確認。同一特殊ジャンル2曲同時選出が weight 減衰により抑制される
- [x] 理由生成: 各候補に2件以上の理由が付き、発火していないルールの理由が出ない
- [x] 条件別候補: horns=UNKNOWN で1管/複数管ブランチが実行され、通常候補と重複する場合は追加されないことをテスト。**horns=UNKNOWN かつ beginner=UNKNOWN のケースで、ブランチが最大4本（1管/複数管/初心者なし/初心者あり）のみ実行され、組み合わせブランチが生成されず、分岐しない側の軸が UNKNOWN のまま（除外・減点なし）維持されることもテスト**
- [x] 属性未整備曲（needs_review、属性NULL）を入力してもクラッシュせず安全側で処理される
- [x] 演奏記録0件（直前曲なし）の入力でクラッシュせず、直前曲系ルール（同form除外・同キー・特殊ジャンル連続・同作曲者・§12.5）が一切発火しない境界テストがある
- [x] 曲500・履歴5000規模の合成データで recommend() が100ms未満（性能基準の余裕分。API全体2秒は unit-04 で検証）
- [x] エンジン全体で vitest カバレッジ（statements）90%以上

## Risks
- **仕様の解釈違い**: §12.3 特殊ジャンル連続回避の対象は**8種で「循環」は対象外**（誤実装しやすい）。Mitigation: テスト名に仕様条番号を付け、レビュー時に仕様書と突合
- **暫定値の妥当性**: 実際に使うと重みが不自然な可能性。Mitigation: 全係数を EngineConfig 経由にし、ハードコード禁止。設定変更だけで挙動調整可能にする
- **統計的テストのflake**: 抽選の統計検証が稀に失敗するリスク。Mitigation: 固定seedで実行し、閾値に十分なマージンを取る

## Boundaries
DBアクセス・API・UI・推薦履歴の永続化は扱わない（unit-04）。EngineInput の組み立て（SQL集計）も unit-04。設定画面は unit-07。エンジンは `src/engine/` の外に依存しない。

## Notes
- ワークフローは tdd（test-writer → implementer → refactorer → reviewer）。**テストを先に書く**
- discovery.md「Recommendation Logic Analysis」と「Provisional Values」が実装の唯一の情報源。乖離が必要な場合は discovery.md を更新してから実装する
- ジャンル上書き=強い加点はユーザー決定（Alignment/ドメインレビュー確定事項）。discovery.md の Stage 3 記述（フィルタ）より優先する
