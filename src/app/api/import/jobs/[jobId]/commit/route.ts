/**
 * POST /api/import/jobs/:jobId/commit
 * 単一トランザクションで取込を実行し、ジョブを COMMITTED に更新する。
 * PREVIEW 以外（既にコミット済み/破棄済み）は 409（1ジョブ1回のみ）。
 * ボディ（任意）: { recalcHasPlayed?: boolean }
 * レスポンス 200: { summary }
 */
import { NextResponse } from "next/server";
import { withErrorHandling } from "@/server/http/handler";
import { commitImport } from "@/server/import/commit";
import { idParamSchema } from "@/server/validation/common";
import { commitSchema } from "@/server/validation/import";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const jobId = idParamSchema.parse((await ctx.params).jobId);
  // ボディは任意（空でも既定値で動く）
  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const input = commitSchema.parse(raw ?? {});
  return NextResponse.json({ summary: commitImport(jobId, input) });
});
