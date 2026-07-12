/**
 * POST /api/sessions/:id/recommendations — 推薦の実行（unit-04）
 * - EngineInput を SQL 集計で組み立て、recommend()（unit-02）を seed 付きで実行
 * - RecommendationRequest/Candidates を保存し、意図値を intent.last_values に保存
 * - セッションが存在しなければ 404、ACTIVE でなければ 409
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { executeRecommendation } from "@/server/recommendation/service";
import { idParamSchema } from "@/server/validation/common";
import { recommendationCreateSchema } from "@/server/validation/recommendations";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const sessionId = idParamSchema.parse((await ctx.params).id);
  const input = await parseJsonBody(req, recommendationCreateSchema);
  return NextResponse.json(
    { recommendation: executeRecommendation(sessionId, input) },
    { status: 201 },
  );
});
