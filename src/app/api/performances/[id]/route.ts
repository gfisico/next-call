/**
 * PATCH  /api/performances/:id — 修正（フロント編成の差し替え含む）
 * DELETE /api/performances/:id — 削除（同一セッション内の order_index を 1..N に再採番。
 *                                 has_played は巻き戻さない）
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import {
  deletePerformance,
  updatePerformance,
} from "@/server/repositories/performances";
import { idParamSchema } from "@/server/validation/common";
import { performanceUpdateSchema } from "@/server/validation/performances";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const id = idParamSchema.parse((await ctx.params).id);
  const patch = await parseJsonBody(req, performanceUpdateSchema);
  return NextResponse.json({ performance: updatePerformance(id, patch) });
});

export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const id = idParamSchema.parse((await ctx.params).id);
  deletePerformance(id);
  return new NextResponse(null, { status: 204 });
});
