# Plan: unit-04-recommendation-api (Bolt 1)

**Intent:** next-call-mvp / **Branch:** ai-dlc/next-call-mvp/04-recommendation-api
**Worktree:** /Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-mvp-04-recommendation-api
**Hat:** planner → builder へ引き継ぎ

## 調査結果（前提の確定）

- `recommend(input: EngineInput, config: EngineConfig, seed: number): EngineResult`（src/engine/index.ts）。公開APIは `recommend` + `types` + `condition-signature`。
- **EngineResult に poolSize が無い**（recommendation_requests.pool_size 列は存在）。index.ts 内部の `passed.length` が Stage1 通過数。→ エンジンへの additive 拡張が必要（下記 Task 1）。
- schema.ts の recommendation_requests に **seed 列が無い**（成功基準「seedが保存され再現できる」）→ 追加マイグレーション必須。
- 既存インデックス: performances(session_id), reco_requests(session_id), reco_requests(condition_signature), reco_candidates(request_id)。**不足**: performances(song_id), performances(session_id, order_index), reco_requests(requested_at) 系。
- SETTING_SEEDS（src/db/seed.ts）は engine.* をほぼ網羅するが、**engine.genre_draw_decay が無い**、`engine.repeat_penalties` に **genreRepeat(3) 相当のサブキーが無い**、形状が EngineConfig と異なる（`recent: {count, penalty}` / `same_condition: {min_times, penalty}` / slider_weights が snake_case）。→ 設定→EngineConfig マッパーで吸収 + 欠損は既定値。
- API規約（unit-03）: withErrorHandling / parseJsonBody / ApiError(errors.ts) / zod は src/server/validation/ / camelCase / POST=201・DELETE=204 / リソース名エンベロープ / 409=CONFLICT。
- テスト方式: tests/api/helpers.ts（一時DB + vi.resetModules + Route Handler 直接呼び出し + expectApiError）。
- 意図フィールドのAPI契約名は `rare, fresh, safety, mood, ballad`（fresh ↔ engine の longUnplayed。unit spec Notes）。
- handoff-notes: **genreCallRatios は全ジャンル分を渡す**（無いジャンルは減点スキップ＝安全側）/ EngineConfig.longUnplayedDays は実装未使用（値は渡すだけでよい）。
- 季節判定: sessions.session_date（JST, YYYY-MM-DD）+ 設定 `engine.season_months` から算出。
- 保留曲自動解除の設定キー: `pending.auto_release_on_call`（seed 済み、既定 true）。
- CI ワークフローは未導入（unit-09）。「CIで実行」= `npm test`（vitest run）に含める。

## Tasks

### Task 1: エンジンへの additive 拡張 — EngineResult.poolSize
- src/engine/types.ts の `EngineResult` に `poolSize: number`（Stage 1 通過曲数）を追加し、index.ts で `passed.length` を返す。スコアロジックには一切触れない（Boundaries 順守。requests.pool_size の記録にのみ使用）。
- 既存 engine テストへの影響を確認し、必要なら期待値に poolSize を追記。
- targets: 基準2（履歴保存の完全性）

### Task 2: 追加マイグレーション 0001（additive のみ）
- schema.ts に追記:
  - `recommendationRequests.seed`: `integer("seed").notNull().default(0)`（再現用乱数シード）
  - index: `idx_performances_song` on performances(song_id) / `idx_performances_session_order` on performances(session_id, order_index) / `idx_reco_requests_requested_at` on recommendation_requests(requested_at) / `idx_reco_requests_signature_requested` on (condition_signature, requested_at)
- `npm run db:generate` で 0001 生成。生成SQLが ALTER TABLE ADD COLUMN + CREATE INDEX のみ（削除・改名なし）であることを目視+テストで確認（tests/db/migrate.test.ts に 0001 適用検証を追加）。
- targets: 基準7（性能の担保）、基準6（seed保存）

### Task 3: 設定→EngineConfig マッパー + 季節判定（src/server/recommendation/config.ts, season.ts）
- `buildEngineConfig(settings: Record<string, unknown>): EngineConfig`
  - キー対応は tests/engine/helpers.ts の makeConfig と同値になるようマッピング（slider_weights.long_unplayed→longUnplayed、repeat_penalties.last_request→lastRequest / recent.penalty→recentRequests / same_condition.penalty→sameSignature）。
  - **欠損キー・欠損サブキーは Provisional Values の既定値へフォールバック**（genreDrawDecay=0.5、repeatPenalties.genreRepeat=3 は設定キーが無いので常に既定値。既存DBの旧形状にも耐える）。
  - `engine.repeat_penalties.recent.count`（=5）と `engine.repeat_window_days`（=30）は履歴読み取り側（Task 5）でも使用するため合わせて取り出すヘルパを提供。
- `seasonForDate(sessionDate: string, seasonMonths): Season` — YYYY-MM-DD の月から判定。season_months が不正/欠損時は既定の区切り（3-5/6-8/9-11/12-2）。
- 単体テスト: SETTING_SEEDS をマップすると makeConfig() と deepEqual になること / 欠損時フォールバック / 季節境界（3月・2月・12月）。
- targets: 基準1・8 の基盤

### Task 4: EngineInput 組み立て（src/server/recommendation/build-input.ts）
集計は「曲単位に GROUP BY した単一クエリ」+ 少数の補助クエリで N+1 を作らない（計7〜8クエリ、全て一回走査）:
1. **曲+ジャンル**: songs 全件 1クエリ + song_genre_tags JOIN genre_tags 1クエリ → Map で EngineSong[] に詰め替え（songKey/composer は null 許容、他は スキーマ値を透過）。
2. **曲別統計（単一 GROUP BY クエリ）**: performances p JOIN sessions s JOIN venues v で
   - `appearanceCount` = SUM(v.is_home = :当該セッション店舗のis_home AND s.session_date >= :windowStart)（windowStart = session_date − engine.appearance_window_days 日）
   - `lastPlayedDate` = MAX(CASE WHEN p.participated THEN s.session_date END) → `daysSinceLastPlayed` = sessionDate との日数差（履歴なしは null）
   - `myPlayCount` = SUM(participated) / `myCallCount` = SUM(called_by_me)
   Drizzle の sql テンプレートで実装。stats 未出現曲は {0, null, 0, 0}。
3. **topCalledSongIds**: called_by_me=true を song_id で GROUP BY、count DESC・song_id ASC（決定的タイブレーク）、LIMIT engine.top_called_n。
4. **genreCallRatios**: called_by_me=true の演奏×song_genre_tags で ジャンル別コール数 / 総コール数。**genre_tags 全件を 0 で初期化してから埋める**（handoff-notes 対応: 全ジャンルの比率を必ず渡す）。**総コール数=0 のときは空 Record を渡す**（全ジャンル一律減点を避ける安全側の決定。テストで固定）。
5. **playedTodaySongIds**: 当該セッションの performances の song_id 集合。
6. **previousPerformance**: 当該セッション内 order_index 最大の行 + その曲属性（songKey/form/composer/genres/inKurobon1/season）+ performance_front_instruments（**0件なら frontInstruments: null**＝未入力で§12.5スキップ。行が無ければ null = 1曲目）。
7. **pendingSongIds**: pending_songs 全件。
8. **history**: Task 5 の読み取り関数から注入。
- 再現性のため `buildEngineInput(sessionId, conditions, intent, opts?: { beforeRequestId?: number })` とし、beforeRequestId は history 読み取りに透過（基準6用）。
- テスト（tests/api/recommendation-input.test.ts、一時DB）: 既知データを投入し、**集計値それぞれ**（登場回数の期間内/期間外・店舗区分切替、最終演奏日=participatedのみ、コール回数、上位10（タイブレーク含む）、ジャンル比率（全ジャンル存在・0件時空）、当日演奏済み、直前曲+フロント編成 null/配列、1曲目 null）に期待値アサーション。→ **基準1**
- **インポート履歴反映（基準9の前倒し分）**: unit-08 のインポートは最終的に sessions/performances 行になるため、過去日付の sessions+performances を直接 INSERT した「インポート相当データ」で appearanceCount / daysSinceLastPlayed に反映されるテストを本ユニットで実装。unit-08 の実APIを通す結合テストは Task 10 の skip 付き scaffold。
- targets: 基準1、基準9（設計+前倒し）

### Task 5: 推薦履歴リポジトリ（src/server/repositories/recommendations.ts）
- 保存: `saveRecommendation(tx, {...})` — recommendation_requests 1行（conditions/intent スナップショット・condition_signature・pool_size・seed）+ recommendation_candidates（NORMAL は display_order=提示順。条件別は branch → ONE_HORN/MULTI_HORN/BEGINNER、is_conditional=true、condition_label。reasons は Reason[] を JSON 文字列で）。intent は fresh→long_unplayed、listener→listener_focus に詰め替え。
- 読み取り（すべて `beforeRequestId?` と 30日 window 引数を取る。§期間の起点は requested_at（UTC ISO、同形式なので辞書順比較で可））:
  - `getLastRequestPresentation()`: 最新1リクエスト（id 降順）の候補 song_id 全件（NORMAL+条件別）+ その候補曲が持つ SPECIAL_CONSECUTIVE_GENRES 集合 → `lastRequestSongIds` / `lastRequestGenres`
  - `getRecentSongIds()`: 直近 recent.count(5) リクエスト（repeat_window_days 以内、セッション横断）の候補 song_id
  - `getSameSignatureCounts(signature)`: 30日以内の同一 condition_signature リクエストの候補を song_id で GROUP BY した提示回数
- テストは Task 9 の統合テストでカバー（保存→読み取り→減点発火）。
- targets: 基準2・4（前段）・6

### Task 6: 推薦サービス + POST /api/sessions/:id/recommendations
- validation（src/server/validation/recommendations.ts、camelCase・fresh が契約名）:
  - conditions: { horns: ONE|MULTI|UNKNOWN, beginner: NONE|PRESENT|UNKNOWN }
  - constraints: { kurobon1Only: boolean, genreOverride?: string[]（ALL_GENRES のみ・重複除去） }
  - intent: { rare/fresh/safety/mood/ballad: int -2..2, seasonal: boolean, listener: boolean }
- サービス（src/server/recommendation/service.ts）`executeRecommendation(sessionId, input, opts?: { seed?, beforeRequestId?, persist? })`:
  1. セッション取得（無ければ 404）。**status !== "ACTIVE" → conflict(409)**（基準8）
  2. 設定一括ロード（getAllSettings）→ EngineConfig / 現在季節（session_date + engine.season_months）/ repeat window 抽出
  3. intent（fresh→longUnplayed）・conditions を EngineConditions へ詰め替え → `conditionSignature()`（unit-02 の condition-signature.ts。重複実装しない）
  4. `buildEngineInput(...)`（signature を渡し sameSignatureCounts を取得）
  5. seed = opts.seed ?? crypto.randomInt(0, 2**31) → `recommend(input, config, seed)`
  6. persist（既定 true）なら単一トランザクションで requests+candidates 保存 → 設定 `intent.last_values` に API 形（rare/fresh/safety/mood/ballad/seasonal/listener）で upsert
  7. レスポンス整形（曲情報を songs Map から結合）
- Route: POST → 201、エンベロープ:
  `{ recommendation: { requestId, seed, isSparse, candidates: [{ song, score, reasons, isPending }], conditionalCandidates: [{ song, score, reasons, branch, conditionLabel }], pendingSongs: [{ song, warnings }] } }`
- targets: 基準2・6・8

### Task 7: GET /api/sessions/:id/recommendations/defaults
- セッション 404 チェックのみ（ACTIVE 要求は POST 側の基準）。
- `intent.last_values` があればそれ、無ければ全スライダー 0・seasonal=false・listener=false（中央値）。
- `suggestSeasonalOn` = 当該セッションの performances が 0 件（=1曲目）かつ 設定 `engine.first_song_seasonal_default`（既定 true）。**フラグを返すだけ**（適用は unit-06 のUI）。
- レスポンス: `{ defaults: { intent, conditions: { horns: "UNKNOWN", beginner: "UNKNOWN", kurobon1Only: false, genreOverride: [] }, suggestSeasonalOn } }`
- テスト: 初回（中央値+suggestSeasonalOn=true）/ 推薦実行後に前回値 / 演奏1件登録後 suggestSeasonalOn=false。
- targets: 基準3

### Task 8: 保留曲 API + コール時自動解除フック
- リポジトリ src/server/repositories/pending-songs.ts:
  - `listPendingSongs()` — pending_songs JOIN songs（曲情報込み、created_at 昇順）
  - `addPendingSong(songId)` — 曲存在チェック（無ければ 400 validationError）→ onConflictDoNothing（**重複は冪等に 201 成功**、既存行を返す）
  - `removePendingSong(songId)` — 行が無ければ 404、削除で 204
  - `releasePendingSongOnCall(tx, songId)` — 設定 `pending.auto_release_on_call`（既定 true。tx 内で読む）が true のとき DELETE
- Routes: `src/app/api/pending-songs/route.ts`（GET → { pendingSongs }、POST → 201 { pendingSong }）/ `src/app/api/pending-songs/[songId]/route.ts`（DELETE → 204）
- **フック（unit-03 リポジトリへのイベントポイント追加は spec が許可）**: performances.ts の `addPerformance`（created.calledByMe=true のとき）と `updatePerformance`（更新後 calledByMe=true のとき）で `releasePendingSongOnCall(tx, songId)` を呼ぶ。既存トランザクション内で完結・既存テストを壊さない。
- 統合テスト: 追加→一覧（**別セッション開始後でも取得可**）→ called_by_me=true 演奏登録で自動解除 / false では解除されない / 設定 false なら解除しない / 重複 POST 冪等 / DELETE 404 → **基準4**
- 警告バッジ: 保留曲を当日演奏済みにして POST recommendations → pendingSongs に**残ったまま** warnings=PLAYED_TODAY が付く統合テスト → **基準5**
- targets: 基準4・5

### Task 9: 統合テスト（tests/api/recommendations.test.ts）+ seed 再現
- **繰り返し減点（基準2）**: 固定データ+固定 seed で POST を2回 → requests/candidates が2組保存され、1回目の提示曲の保存 score が2回目で下がっている（減点が効いた）ことを検証。
- **seed 再現（基準6）**: POST 後に DB から seed と requestId を読み、`executeRecommendation(sessionId, 同一入力, { seed, beforeRequestId: requestId, persist: false })` を再実行 → 保存された candidates（song_id・score・display_order・candidate_type）と完全一致。※後続リクエストが履歴（繰り返し減点）に影響するため as-of 再構築が必須。
- **エラー統一形式（基準8）**: 存在しないセッション 404 / ENDED セッションへの POST 409 CONFLICT（expectApiError）/ zod 不正 400。新規環境変数なし（observable/deployable）。
- targets: 基準2・6・8

### Task 10: 性能テスト（基準7）+ unit-08 連携 scaffold（基準9）
- tests/api/recommendations-performance.test.ts:
  - 決定的ジェネレータで 曲500（キー・ジャンル・属性を分散）・venues 2（home/非home）・sessions ~100・performances 5,000 を一時DBへトランザクション一括 INSERT。
  - ACTIVE セッションを用意し、Route Handler を warm-up 1回 → 20回実行、各回の所要時間から p95 を算出し `expect(p95).toBeLessThan(2000)`。intent/条件を回ごとに変えて現実的な分布に。`npm test` に含める。
- tests/api/recommendations-import.test.ts（scaffold）:
  - unit-08 の CSV インポート API 経由で履歴投入 → 登場回数・久しぶり度への反映を検証する結合テストを skip 付き（import route の存在チェック or フラグ定数）で用意し、「unit-08 完成後に有効化」の TODO を明記。DBレベルの同等検証は Task 4 で実装済み。
- targets: 基準7・9

### 完了時チェック
- `npm run lint && npm run typecheck && npm test` 全通過。
- src/engine/ 外にスコア計算が無い（API層は詰め替え・保存・整形のみ）ことを自己レビュー。
- 新規環境変数なし・マイグレーションは additive のみ。

## Risks
1. **EngineResult に poolSize が無い** — engine 内部へ手を伸ばすと境界崩れ。→ Mitigation: EngineResult へ additive に poolSize を追加（Task 1。スコアロジック不変・既存テストの期待値追記のみ）。
2. **コール履歴ゼロ時の genreCallRatios** — 全ジャンル 0 を渡すと全ジャンル曲一律 −8 になり初期利用で歪む。→ Mitigation: 総コール0のときのみ空 Record（減点スキップ=安全側）、1件以上なら全ジャンル分（0含む）を渡す（handoff-notes 準拠）。テストで挙動を固定。
3. **設定キー形状と EngineConfig の不一致**（repeat_penalties のネスト / genre_draw_decay・genreRepeat のキー欠如 / snake_case）— 詰め替えミスで係数がズレる。→ Mitigation: マッパーを config.ts に一元化し「SETTING_SEEDS→map が makeConfig() と deepEqual」のピン留めテスト。
4. **seed 再現が後続履歴で崩れる** — 再実行時に繰り返し減点の入力が変わる。→ Mitigation: 履歴読み取りに beforeRequestId を通す as-of 再構築 + persist:false の再実行オプション。
5. **性能テストの flaky 化**（マシン差）— Mitigation: warm-up + 反復20回で p95 算出。エンジン単体 <100ms 実績（tests/engine/performance.test.ts）があり支配項は集計SQL。単一 GROUP BY + Task 2 インデックスで担保、閾値2000msは緩めない。
6. **自動解除フックによる既存 performances テスト回帰** — Mitigation: calledByMe=true のときのみ同一 tx 内 DELETE。既存テスト全通過を Task 8 の完了条件に含める。

## Criteria ↔ Task 対応（9/9）
| 基準 | Task |
|---|---|
| 1 EngineInput 集計の期待値テスト | 4 |
| 2 履歴保存+繰り返し減点 | 1,5,6,9 |
| 3 intent.last_values / defaults | 6,7 |
| 4 保留曲フロー+自動解除 | 8 |
| 5 保留曲の警告バッジ | 8 |
| 6 seed 保存・再現 | 2,5,6,9 |
| 7 性能 p95<2秒 | 2,4,10 |
| 8 統一エラー・409 | 6,9 |
| 9 インポート履歴の集計反映 | 4（前倒しDBレベル）,10（skip付き結合テスト、unit-08 後に有効化） |