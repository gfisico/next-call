/**
 * 保留曲 API のリクエストスキーマ（置き場規約は common.ts のヘッダコメント参照）
 */
import { z } from "zod";

/** POST /api/pending-songs のボディ */
export const pendingSongCreateSchema = z.object({
  songId: z.number().int().positive(),
});

export type PendingSongCreateInput = z.infer<typeof pendingSongCreateSchema>;
