/**
 * DELETE /api/instruments/:code — 未使用時のみ削除可（フロント編成が参照中なら 409）
 */
import { NextResponse } from "next/server";
import { withErrorHandling } from "@/server/http/handler";
import { deleteInstrument } from "@/server/repositories/masters";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const { code } = await ctx.params;
  deleteInstrument(code);
  return new NextResponse(null, { status: 204 });
});
