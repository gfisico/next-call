/**
 * 統計 API（GET /api/stats）のリクエストスキーマ（置き場規約は common.ts のヘッダコメント参照）
 *
 * クエリ: ?venue=<id|home|non_home|all>&season=<SPRING|...|ALL>&from=YYYY-MM-DD&to=YYYY-MM-DD
 * すべて任意。未指定は venue=all / 期間・季節フィルタなし（全期間）。
 */
import { z } from "zod";
import { seasonSchema } from "./songs";

/** ISO 日付（YYYY-MM-DD）文字列 */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "日付は YYYY-MM-DD 形式で指定してください",
});

/**
 * 店フィルタ: "all" | "home" | "non_home" | 正の整数 venueId。
 * 名前付き値を優先し、それ以外は正の整数 id へ coerce（0・負数・非数は 400）。
 */
const venueSchema = z
  .union([
    z.enum(["all", "home", "non_home"]),
    z.coerce.number().int().positive(),
  ])
  .default("all");

export const statsQuerySchema = z.object({
  venue: venueSchema,
  /** 未指定 / ALL は全期間（季節フィルタなし） */
  season: seasonSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  /**
   * 最終演奏日（participated=true の max session_date）がこの日付以前の曲だけに
   * 曲別リストを絞る（HAVING）。未演奏曲（式が NULL）は自動除外。曲別クエリのみに効く。
   */
  lastPlayedBefore: dateSchema.optional(),
});

export type StatsQuery = z.infer<typeof statsQuerySchema>;
