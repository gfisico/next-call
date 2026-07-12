/**
 * POST /api/sessions/:id/performances — 演奏記録の追加
 * - songId または quickTitle（内部でクイック登録）を排他で受け取る
 * - order_index 自動採番（max+1）。participated=true なら has_played を自動更新
 * - ENDED セッションへの追加は 409
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { addPerformance } from "@/server/repositories/performances";
import { idParamSchema } from "@/server/validation/common";
import { performanceCreateSchema } from "@/server/validation/performances";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const sessionId = idParamSchema.parse((await ctx.params).id);
  const input = await parseJsonBody(req, performanceCreateSchema);
  return NextResponse.json(
    { performance: addPerformance(sessionId, input) },
    { status: 201 },
  );
});
