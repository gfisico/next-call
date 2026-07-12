/**
 * 推薦履歴（recommendation_requests / recommendation_candidates）のデータアクセス
 *
 * - 保存: リクエスト（条件・意図スナップショット + condition_signature + pool_size + seed）
 *   と候補（NORMAL / 条件別）を単一トランザクション内で保存する
 * - 読み取り: Stage 5 繰り返し減点の入力（前回提示曲・直近Nリクエスト・同一署名回数・
 *   前回提示ジャンル）を組み立てる。beforeRequestId を渡すと「そのリクエスト実行時点」の
 *   履歴を as-of 再構築できる（seed 再現用。後続リクエストの影響を受けない）
 * - スコアロジックは一切持たない（境界: src/engine/）
 */
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import {
  genreTags,
  recommendationCandidates,
  recommendationRequests,
  songGenreTags,
} from "@/db/schema";
import { SPECIAL_CONSECUTIVE_GENRES } from "@/engine/types";
import type {
  Candidate,
  ConditionalBranch,
  ConditionalCandidate,
  EngineConditions,
  RecommendationHistoryInput,
  SelectionIntent,
} from "@/engine/types";
import type { DbOrTx } from "./songs";

/** 条件別ブランチ → recommendation_candidates.candidate_type の対応 */
const BRANCH_TO_CANDIDATE_TYPE: Record<
  ConditionalBranch,
  "ONE_HORN" | "MULTI_HORN" | "BEGINNER"
> = {
  HORNS_ONE: "ONE_HORN",
  HORNS_MULTI: "MULTI_HORN",
  BEGINNER_NONE: "BEGINNER",
  BEGINNER_PRESENT: "BEGINNER",
};

export interface SaveRecommendationParams {
  sessionId: number;
  conditions: EngineConditions;
  /** エンジン形の意図（longUnplayed / listener）。列へは long_unplayed / listener_focus で保存 */
  intent: SelectionIntent;
  conditionSignature: string;
  poolSize: number;
  seed: number;
  candidates: Candidate[];
  conditionalCandidates: ConditionalCandidate[];
}

/** 推薦実行結果を保存する（呼び出し側のトランザクション内で使う） */
export function saveRecommendation(
  tx: DbOrTx,
  params: SaveRecommendationParams,
): { requestId: number; requestedAt: string } {
  const { conditions, intent } = params;
  const request = tx
    .insert(recommendationRequests)
    .values({
      sessionId: params.sessionId,
      horns: conditions.horns,
      beginner: conditions.beginner,
      kurobon1Only: conditions.kurobon1Only,
      genreOverride: JSON.stringify(conditions.genreOverride),
      rare: intent.rare,
      longUnplayed: intent.longUnplayed,
      safety: intent.safety,
      mood: intent.mood,
      ballad: intent.ballad,
      seasonal: intent.seasonal,
      listenerFocus: intent.listener,
      conditionSignature: params.conditionSignature,
      poolSize: params.poolSize,
      seed: params.seed,
    })
    .returning()
    .get();

  const rows = [
    ...params.candidates.map((c, i) => ({
      requestId: request.id,
      songId: c.songId,
      candidateType: "NORMAL" as const,
      score: c.score,
      reasons: JSON.stringify(c.reasons),
      isConditional: false,
      conditionLabel: null,
      displayOrder: i + 1,
    })),
    ...params.conditionalCandidates.map((c, i) => ({
      requestId: request.id,
      songId: c.songId,
      candidateType: BRANCH_TO_CANDIDATE_TYPE[c.branch],
      score: c.score,
      reasons: JSON.stringify(c.reasons),
      isConditional: true,
      conditionLabel: c.label,
      displayOrder: i + 1,
    })),
  ];
  if (rows.length > 0) {
    tx.insert(recommendationCandidates).values(rows).run();
  }

  return { requestId: request.id, requestedAt: request.requestedAt };
}

export interface HistoryReadOptions {
  /** 履歴参照期間（engine.repeat_window_days、既定 30） */
  windowDays: number;
  /** 直近リクエストの参照本数（engine.repeat_penalties.recent.count、既定 5） */
  recentCount: number;
  /**
   * このリクエスト ID より前（id 昇順で厳密に前）の履歴だけを読む as-of 指定。
   * window の基準時刻もそのリクエストの requested_at になる（seed 再現用）。
   */
  beforeRequestId?: number;
}

/** ISO タイムスタンプの days 日前（requested_at は UTC ISO なので辞書順比較可能） */
function isoDaysBefore(asOf: string, days: number): string {
  return new Date(new Date(asOf).getTime() - days * 86_400_000).toISOString();
}

/** 指定リクエスト群の候補 song_id（NORMAL + 条件別の全件、重複除去） */
function candidateSongIds(dbx: DbOrTx, requestIds: number[]): number[] {
  if (requestIds.length === 0) return [];
  const rows = dbx
    .selectDistinct({ songId: recommendationCandidates.songId })
    .from(recommendationCandidates)
    .where(inArray(recommendationCandidates.requestId, requestIds))
    .all();
  return rows.map((r) => r.songId);
}

/**
 * Stage 5 繰り返し減点の入力一式を読み取る。
 * - lastRequestSongIds: 前回（最新1）リクエストの候補 song_id 全件
 * - recentSongIds: 直近 recentCount リクエスト（windowDays 以内、セッション横断）の候補 song_id
 * - sameSignatureCounts: windowDays 以内の同一 condition_signature での提示回数（song_id 別）
 * - lastRequestGenres: 前回候補曲が持つ特殊ジャンル（SPECIAL_CONSECUTIVE_GENRES に限る）
 */
export function getRecommendationHistory(
  dbx: DbOrTx,
  signature: string,
  opts: HistoryReadOptions,
): RecommendationHistoryInput {
  const idBound: SQL | undefined =
    opts.beforeRequestId !== undefined
      ? lt(recommendationRequests.id, opts.beforeRequestId)
      : undefined;

  // window の基準時刻: as-of 再構築時は対象リクエストの requested_at、通常は現在時刻
  let asOf = new Date().toISOString();
  if (opts.beforeRequestId !== undefined) {
    const ref = dbx
      .select({ requestedAt: recommendationRequests.requestedAt })
      .from(recommendationRequests)
      .where(eq(recommendationRequests.id, opts.beforeRequestId))
      .get();
    if (ref) asOf = ref.requestedAt;
  }
  const windowStart = isoDaysBefore(asOf, opts.windowDays);

  // 前回リクエスト（最新1件。id 降順）
  const last = dbx
    .select({ id: recommendationRequests.id })
    .from(recommendationRequests)
    .where(idBound)
    .orderBy(desc(recommendationRequests.id))
    .limit(1)
    .get();

  let lastRequestSongIds: number[] = [];
  let lastRequestGenres: string[] = [];
  if (last) {
    lastRequestSongIds = candidateSongIds(dbx, [last.id]);
    if (lastRequestSongIds.length > 0) {
      const special = new Set<string>(SPECIAL_CONSECUTIVE_GENRES);
      const genreRows = dbx
        .selectDistinct({ name: genreTags.name })
        .from(songGenreTags)
        .innerJoin(genreTags, eq(songGenreTags.genreTagId, genreTags.id))
        .where(inArray(songGenreTags.songId, lastRequestSongIds))
        .all();
      lastRequestGenres = genreRows
        .map((r) => r.name)
        .filter((name) => special.has(name));
    }
  }

  // 直近 recentCount リクエスト（windowDays 以内、セッション横断）
  const recentConds = [gte(recommendationRequests.requestedAt, windowStart)];
  if (idBound) recentConds.push(idBound);
  const recentRequestIds = dbx
    .select({ id: recommendationRequests.id })
    .from(recommendationRequests)
    .where(and(...recentConds))
    .orderBy(desc(recommendationRequests.id))
    .limit(opts.recentCount)
    .all()
    .map((r) => r.id);
  const recentSongIds = candidateSongIds(dbx, recentRequestIds);

  // 同一 condition_signature の song_id 別提示回数（windowDays 以内）
  const signatureConds = [
    eq(recommendationRequests.conditionSignature, signature),
    gte(recommendationRequests.requestedAt, windowStart),
  ];
  if (idBound) signatureConds.push(idBound);
  const countRows = dbx
    .select({
      songId: recommendationCandidates.songId,
      n: sql<number>`count(*)`,
    })
    .from(recommendationCandidates)
    .innerJoin(
      recommendationRequests,
      eq(recommendationCandidates.requestId, recommendationRequests.id),
    )
    .where(and(...signatureConds))
    .groupBy(recommendationCandidates.songId)
    .all();
  const sameSignatureCounts: Record<number, number> = {};
  for (const row of countRows) sameSignatureCounts[row.songId] = row.n;

  return {
    lastRequestSongIds,
    recentSongIds,
    sameSignatureCounts,
    lastRequestGenres,
  };
}
