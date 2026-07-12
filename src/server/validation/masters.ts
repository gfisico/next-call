/**
 * 楽器・店舗マスター API のリクエストスキーマ（置き場規約は common.ts のヘッダコメント参照）
 */
import { z } from "zod";
import { NON_EMPTY_MESSAGE, nonEmptyObject } from "./common";

/** POST /api/instruments */
export const instrumentCreateSchema = z.object({
  code: z.string().trim().min(1).max(16),
  label: z.string().trim().min(1),
  sortOrder: z.number().int().min(0).optional(),
});

/** POST /api/venues — is_home は必須（初回登録時の一度だけの判定。仕様§4.2） */
export const venueCreateSchema = z.object({
  name: z.string().trim().min(1),
  isHome: z.boolean(),
});

/** PATCH /api/venues/:id */
export const venueUpdateSchema = z
  .object({
    name: z.string().trim().min(1),
    isHome: z.boolean(),
  })
  .partial()
  .refine(nonEmptyObject, { message: NON_EMPTY_MESSAGE });

export type InstrumentCreateInput = z.infer<typeof instrumentCreateSchema>;
export type VenueCreateInput = z.infer<typeof venueCreateSchema>;
export type VenueUpdateInput = z.infer<typeof venueUpdateSchema>;
