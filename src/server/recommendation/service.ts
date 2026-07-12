/**
 * 推薦サービス（POST /api/sessions/:id/recommendations の本体）
 *
 * 処理: セッション検証（ACTIVE のみ）→ 設定ロード → EngineInput 組み立て →
 * recommend()（unit-02 の公開 API のみ使用）→ 履歴保存 + intent.last_values 更新 →
 * レスポンス整形。スコアロジックはここに書かない（境界: src/engine/）。
 *
 * seed は保存され、opts.seed + opts.beforeRequestId + persist:false で
 * 同一 request の結果を再現できる（成功基準: seed 再現）。
 */
import { randomInt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions, settings as settingsTable } from "@/db/schema";
import { conditionSignature } from "@/engine/condition-signature";
import { recommend } from "@/engine";
import type {
  ConditionalBranch,
  EngineConditions,
  PendingWarning,
  Reason,
  SelectionIntent,
} from "@/engine/types";
import { conflict, notFound } from "@/server/http/errors";
import { saveRecommendation } from "@/server/repositories/recommendations";
import { getAllSettings } from "@/server/repositories/settings";
import type { DbOrTx, SongWithTags } from "@/server/repositories/songs";
import type {
  RecommendationCreateInput,
  RecommendationIntentInput,
} from "@/server/validation/recommendations";
import { buildEngineInput } from "./build-input";
import { buildEngineConfig, getRepeatReadParams } from "./config";
import { seasonForDate } from "./season";

/** 前回意図値の保存先 Setting キー（defaults エンドポイントが読む） */
export const INTENT_LAST_VALUES_KEY = "intent.last_values";

export interface RecommendationCandidateView {
  song: SongWithTags;
  score: number;
  reasons: Reason[];
  isPending: boolean;
}

export interface ConditionalCandidateView {
  song: SongWithTags;
  score: number;
  reasons: Reason[];
  branch: ConditionalBranch;
  conditionLabel: string;
}

export interface PendingSongView {
  song: SongWithTags;
  warnings: PendingWarning[];
}

export interface RecommendationView {
  /** persist:false（再現実行）のときは null */
  requestId: number | null;
  seed: number;
  isSparse: boolean;
  poolSize: number;
  candidates: RecommendationCandidateView[];
  conditionalCandidates: ConditionalCandidateView[];
  pendingSongs: PendingSongView[];
}

export interface ExecuteRecommendationOptions {
  /** 乱数シード（省略時はランダム生成） */
  seed?: number;
  /** この request 実行時点の履歴で as-of 再構築する（seed 再現用） */
  beforeRequestId?: number;
  /** false で履歴保存・intent.last_values 更新を行わない（既定 true） */
  persist?: boolean;
}

/** API 契約形（fresh/listener）→ エンジン形（longUnplayed/listener）の詰め替え */
function toEngineIntent(intent: RecommendationIntentInput): SelectionIntent {
  return {
    rare: intent.rare,
    longUnplayed: intent.fresh,
    safety: intent.safety,
    mood: intent.mood,
    ballad: intent.ballad,
    seasonal: intent.seasonal,
    listener: intent.listener,
  };
}

/** intent.last_values を API 契約形（rare/fresh/…）で upsert する（呼び出し側 tx 内） */
function upsertIntentLastValues(
  tx: DbOrTx,
  intent: RecommendationIntentInput,
): void {
  const now = new Date().toISOString();
  tx.insert(settingsTable)
    .values({
      key: INTENT_LAST_VALUES_KEY,
      value: JSON.stringify(intent),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: sql`excluded.value`, updatedAt: now },
    })
    .run();
}

export function executeRecommendation(
  sessionId: number,
  body: RecommendationCreateInput,
  opts: ExecuteRecommendationOptions = {},
): RecommendationView {
  const db = getDb();

  // 1. セッション検証: 404 / 非 ACTIVE は 409
  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!session) {
    throw notFound(`セッションが見つかりません: id=${sessionId}`);
  }
  if (session.status !== "ACTIVE") {
    throw conflict("進行中でないセッションには推薦を実行できません", {
      status: session.status,
    });
  }

  // 2. 設定一括ロード → EngineConfig / 現在季節 / 履歴読み取りパラメータ
  const settings = getAllSettings(db);
  const config = buildEngineConfig(settings);
  const currentSeason = seasonForDate(
    session.sessionDate,
    settings["engine.season_months"],
  );
  const repeatParams = getRepeatReadParams(settings);

  // 3. 条件・意図をエンジン形へ詰め替え、condition_signature を生成（unit-02 の実装を使用）
  const engineIntent = toEngineIntent(body.intent);
  const engineConditions: EngineConditions = {
    horns: body.conditions.horns,
    beginner: body.conditions.beginner,
    kurobon1Only: body.constraints.kurobon1Only,
    genreOverride: body.constraints.genreOverride ?? [],
  };
  const signature = conditionSignature(engineConditions, engineIntent);

  // 4. EngineInput 組み立て（集計クエリ群）
  const { input, songsById } = buildEngineInput({
    dbx: db,
    session,
    conditions: engineConditions,
    intent: engineIntent,
    currentSeason,
    appearanceWindowDays: config.appearanceWindowDays,
    topCalledN: config.topCalledN,
    repeatParams,
    signature,
    beforeRequestId: opts.beforeRequestId,
  });

  // 5. 推薦実行（seed は保存して再現可能に）
  const seed = opts.seed ?? randomInt(0, 2 ** 31);
  const result = recommend(input, config, seed);

  // 6. 履歴保存 + 意図値の前回値更新（単一トランザクション）
  let requestId: number | null = null;
  if (opts.persist !== false) {
    requestId = db.transaction((tx) => {
      const saved = saveRecommendation(tx, {
        sessionId,
        conditions: engineConditions,
        intent: engineIntent,
        conditionSignature: signature,
        poolSize: result.poolSize,
        seed,
        candidates: result.candidates,
        conditionalCandidates: result.conditionalCandidates,
      });
      upsertIntentLastValues(tx, body.intent);
      return saved.requestId;
    });
  }

  // 7. レスポンス整形（曲情報を結合。曲は必ず songsById に存在する）
  const songOf = (songId: number): SongWithTags => {
    const song = songsById.get(songId);
    if (!song) throw new Error(`曲が見つかりません: songId=${songId}`);
    return song;
  };
  return {
    requestId,
    seed,
    isSparse: result.isSparse,
    poolSize: result.poolSize,
    candidates: result.candidates.map((c) => ({
      song: songOf(c.songId),
      score: c.score,
      reasons: c.reasons,
      isPending: c.isPending,
    })),
    conditionalCandidates: result.conditionalCandidates.map((c) => ({
      song: songOf(c.songId),
      score: c.score,
      reasons: c.reasons,
      branch: c.branch,
      conditionLabel: c.label,
    })),
    pendingSongs: result.pendingSongs.map((p) => ({
      song: songOf(p.songId),
      warnings: p.warnings,
    })),
  };
}
