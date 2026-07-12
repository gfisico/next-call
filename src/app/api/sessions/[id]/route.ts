/**
 * GET   /api/sessions/:id — 詳細（演奏記録+フロント編成含む）
 * PATCH /api/sessions/:id — has_listeners 切替・note・status: ENDED（終了）
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { getSession, updateSession } from "@/server/repositories/sessions";
import { idParamSchema } from "@/server/validation/common";
import { sessionUpdateSchema } from "@/server/validation/sessions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const id = idParamSchema.parse((await ctx.params).id);
  return NextResponse.json({ session: getSession(id) });
});

export const PATCH = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const id = idParamSchema.parse((await ctx.params).id);
  const patch = await parseJsonBody(req, sessionUpdateSchema);
  return NextResponse.json({ session: updateSession(id, patch) });
});
