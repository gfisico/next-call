/**
 * 曲マスター API のリクエストスキーマ（置き場規約は common.ts のヘッダコメント参照）
 */
import { z } from "zod";
import { GENRE_TAG_NAMES } from "@/db/seed";
import {
  NON_EMPTY_MESSAGE,
  nonEmptyObject,
  queryBooleanSchema,
} from "./common";

export const seasonSchema = z.enum([
  "SPRING",
  "SUMMER",
  "AUTUMN",
  "WINTER",
  "ALL",
]);

export const formSchema = z.enum(["AABA", "ABAC", "BLUES12", "OTHER"]);

/** ジャンルタグは固定9種名のみ（仕様§7.2） */
export const genreTagNameSchema = z.enum(GENRE_TAG_NAMES);

const songFields = {
  title: z.string().trim().min(1),
  songKey: z.string().trim().min(1).nullable(),
  form: formSchema,
  composer: z.string().trim().min(1).nullable(),
  hasPlayed: z.boolean(),
  noChartOk: z.boolean(),
  isStandard: z.boolean(),
  simpleForm: z.boolean(),
  inKurobon1: z.boolean(),
  season: seasonSchema,
  listenerLevel: z.number().int().min(1).max(5),
  energyLevel: z.number().int().min(1).max(5),
  needsReview: z.boolean(),
  note: z.string().nullable(),
  genreTags: z.array(genreTagNameSchema),
};

/** POST /api/songs — title 以外は省略可（DB 既定値を使う） */
export const songCreateSchema = z
  .object(songFields)
  .partial()
  .required({ title: true });

/** PATCH /api/songs/:id — 部分更新（needs_review の解除・ジャンルタグ差し替え含む） */
export const songUpdateSchema = z
  .object(songFields)
  .partial()
  .refine(nonEmptyObject, { message: NON_EMPTY_MESSAGE });

/** POST /api/songs/quick — title のみ */
export const songQuickCreateSchema = z.object({
  title: z.string().trim().min(1),
});

/** GET /api/songs のクエリ */
export const songListQuerySchema = z.object({
  q: z.string().optional(),
  needsReview: queryBooleanSchema.optional(),
  genre: genreTagNameSchema.optional(),
  season: seasonSchema.optional(),
  hasPlayed: queryBooleanSchema.optional(),
  sort: z.enum(["title", "updated"]).optional(),
});

export type SongCreateInput = z.infer<typeof songCreateSchema>;
export type SongUpdateInput = z.infer<typeof songUpdateSchema>;
export type SongListQuery = z.infer<typeof songListQuerySchema>;
