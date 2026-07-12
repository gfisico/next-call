/**
 * 演奏記録 API のリクエストスキーマ（置き場規約は common.ts のヘッダコメント参照）
 *
 * frontInstruments の code が楽器マスターに存在するかは DB 参照が必要なため
 * リポジトリ層（src/server/repositories/performances.ts）で検証する。
 */
import { z } from "zod";
import { NON_EMPTY_MESSAGE, nonEmptyObject } from "./common";

/** フロント編成: 順序付き・同一楽器の重複可（vo, as, as, ts 等） */
export const frontInstrumentsSchema = z.array(
  z.object({
    code: z.string().trim().min(1),
    position: z.number().int().min(0),
  }),
);

const performanceFields = {
  participated: z.boolean(),
  instrument: z.enum(["SAX", "PIANO", "NONE"]),
  calledByMe: z.boolean(),
  noChart: z.boolean(),
  note: z.string().nullable(),
  frontInstruments: frontInstrumentsSchema,
};

/**
 * POST /api/sessions/:id/performances —
 * songId または quickTitle のどちらか一方（排他）を必須とする
 */
export const performanceCreateSchema = z
  .object({
    songId: z.number().int().positive(),
    quickTitle: z.string().trim().min(1),
    ...performanceFields,
  })
  .partial()
  .refine((v) => (v.songId === undefined) !== (v.quickTitle === undefined), {
    message: "songId と quickTitle はどちらか一方だけを指定してください",
  });

/** PATCH /api/performances/:id — 曲の付け替えは不可（記録の修正のみ） */
export const performanceUpdateSchema = z
  .object(performanceFields)
  .partial()
  .refine(nonEmptyObject, { message: NON_EMPTY_MESSAGE });

export type PerformanceCreateInput = z.infer<typeof performanceCreateSchema>;
export type PerformanceUpdateInput = z.infer<typeof performanceUpdateSchema>;
