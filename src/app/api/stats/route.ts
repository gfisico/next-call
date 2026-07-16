/**
 * GET /api/stats — 統計集計（曲別・分布・傾向・月別推移）
 *
 * クエリ: ?venue=<id|home|non_home|all>&season=<SPRING|...|ALL>&from=YYYY-MM-DD&to=YYYY-MM-DD
 * 読み取り専用。StatsResponse をエンベロープ無しでトップレベル直返しする（unit-05 が型共有）。
 */
import { NextResponse } from "next/server";
import { withErrorHandling } from "@/server/http/handler";
import { getStats } from "@/server/repositories/stats";
import { statsQuerySchema } from "@/server/validation/stats";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: Request) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const query = statsQuerySchema.parse(params);
  return NextResponse.json(getStats(query));
});
