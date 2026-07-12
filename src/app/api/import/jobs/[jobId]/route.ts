/**
 * DELETE /api/import/jobs/:jobId
 * プレビューを破棄する（status=DISCARDED）。レスポンス 204。
 */
import { NextResponse } from "next/server";
import { withErrorHandling } from "@/server/http/handler";
import { getJobOrThrow, markStatus } from "@/server/repositories/import-jobs";
import { idParamSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const jobId = idParamSchema.parse((await ctx.params).jobId);
  getJobOrThrow(jobId); // 存在しなければ 404
  markStatus(jobId, "DISCARDED");
  return new NextResponse(null, { status: 204 });
});
