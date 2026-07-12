/**
 * 推薦 API のリクエストスキーマ（置き場規約は common.ts のヘッダコメント参照）
 *
 * 意図フィールドの API 契約名は rare / fresh / safety / mood / ballad
 * （fresh はエンジンの longUnplayed に対応。unit-04 spec Notes）。
 */
import { z } from "zod";
import { ALL_GENRES } from "@/engine/types";

/** スライダー値（仕様§9。-2..+2 の整数） */
const sliderSchema = z.number().int().min(-2).max(2);

/** 選曲意図（API 契約形。fresh = エンジンの longUnplayed） */
export const recommendationIntentSchema = z.object({
  rare: sliderSchema,
  fresh: sliderSchema,
  safety: sliderSchema,
  mood: sliderSchema,
  ballad: sliderSchema,
  seasonal: z.boolean(),
  listener: z.boolean(),
});

/** POST /api/sessions/:id/recommendations のボディ */
export const recommendationCreateSchema = z.object({
  conditions: z.object({
    horns: z.enum(["ONE", "MULTI", "UNKNOWN"]),
    beginner: z.enum(["NONE", "PRESENT", "UNKNOWN"]),
  }),
  constraints: z.object({
    kurobon1Only: z.boolean(),
    /** ジャンル上書き（ALL_GENRES のみ。重複は除去） */
    genreOverride: z
      .array(z.enum(ALL_GENRES))
      .transform((genres) => [...new Set(genres)])
      .optional(),
  }),
  intent: recommendationIntentSchema,
});

export type RecommendationIntentInput = z.infer<typeof recommendationIntentSchema>;
export type RecommendationCreateInput = z.infer<typeof recommendationCreateSchema>;
