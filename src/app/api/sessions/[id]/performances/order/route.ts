/**
 * PATCH /api/sessions/:id/performances/order — 曲順の一括並べ替え
 *   body: { order: number[] }（performance_id の新しい並び）
 *   同一セッション全 performance の order_index を 1..N で連番再割当（トランザクション）。
 *   id 集合がセッションの全 performance と一致しない場合は 400。
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { reorderPerformances } from "@/server/repositories/performances";
import { idParamSchema } from "@/server/validation/common";
import { sessionReorderSchema } from "@/server/validation/sessions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const sessionId = idParamSchema.parse((await ctx.params).id);
  const { order } = await parseJsonBody(req, sessionReorderSchema);
  return NextResponse.json({
    performances: reorderPerformances(sessionId, order),
  });
});
