/**
 * セッション API のリクエストスキーマ（置き場規約は common.ts のヘッダコメント参照）
 */
import { z } from "zod";
import { NON_EMPTY_MESSAGE, nonEmptyObject } from "./common";

/** POST /api/sessions — sessionDate 省略時は JST 当日 */
export const sessionStartSchema = z.object({
  sessionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください")
    .optional(),
  venueId: z.number().int().positive(),
  hasListeners: z.boolean().optional(),
});

/**
 * PATCH /api/sessions/:id
 * - status は ENDED への遷移のみ許可
 * - sessionDate / venueId は sessionStartSchema と同一規則（venue 存在検証は repository 側）
 */
export const sessionUpdateSchema = z
  .object({
    sessionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください"),
    venueId: z.number().int().positive(),
    hasListeners: z.boolean(),
    note: z.string().nullable(),
    status: z.literal("ENDED"),
  })
  .partial()
  .refine(nonEmptyObject, { message: NON_EMPTY_MESSAGE });

/** PATCH /api/sessions/:id/performances/order — performance_id の新しい並び */
export const sessionReorderSchema = z.object({
  order: z.array(z.number().int().positive()).min(1),
});

export type SessionStartInput = z.infer<typeof sessionStartSchema>;
export type SessionUpdateInput = z.infer<typeof sessionUpdateSchema>;
export type SessionReorderInput = z.infer<typeof sessionReorderSchema>;
