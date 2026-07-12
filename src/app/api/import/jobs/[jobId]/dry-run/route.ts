/**
 * GET /api/import/jobs/:jobId/dry-run
 * 解決内容を適用した差分サマリを返す（DB は一切変更しない）。
 * レスポンス 200: { summary }
 */
import { NextResponse } from "next/server";
import { withErrorHandling } from "@/server/http/handler";
import { dryRunImport } from "@/server/import/dry-run";
import { idParamSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const jobId = idParamSchema.parse((await ctx.params).jobId);
  return NextResponse.json({ summary: dryRunImport(jobId) });
});
