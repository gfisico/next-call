/**
 * DELETE /api/pending-songs/:songId — 保留曲の手動解除（保留中でなければ 404）
 */
import { NextResponse } from "next/server";
import { withErrorHandling } from "@/server/http/handler";
import { removePendingSong } from "@/server/repositories/pending-songs";
import { idParamSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ songId: string }> };

export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const songId = idParamSchema.parse((await ctx.params).songId);
  removePendingSong(songId);
  return new NextResponse(null, { status: 204 });
});
