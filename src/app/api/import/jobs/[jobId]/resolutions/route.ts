/**
 * POST /api/import/jobs/:jobId/resolutions
 * プレビューでの解決内容（venue 区分 / 曲名解決）を保存する。
 * job が PREVIEW でなければ 409。
 * レスポンス 200: { job, resolutions }
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { saveResolutions } from "@/server/repositories/import-jobs";
import { idParamSchema } from "@/server/validation/common";
import { resolutionsSchema } from "@/server/validation/import";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const jobId = idParamSchema.parse((await ctx.params).jobId);
  const resolutions = await parseJsonBody(req, resolutionsSchema);
  const job = saveResolutions(jobId, resolutions);
  return NextResponse.json({
    job: { id: job.id, type: job.type, status: job.status },
    resolutions,
  });
});
