/**
 * PATCH  /api/songs/:id — 部分更新（ジャンルタグ差し替え・needs_review 解除含む）
 * DELETE /api/songs/:id — 削除（演奏記録・推薦履歴が参照中なら 409。履歴保全）
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { deleteSong, updateSong } from "@/server/repositories/songs";
import { idParamSchema } from "@/server/validation/common";
import { songUpdateSchema } from "@/server/validation/songs";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const id = idParamSchema.parse((await ctx.params).id);
  const patch = await parseJsonBody(req, songUpdateSchema);
  return NextResponse.json({ song: updateSong(id, patch) });
});

export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const id = idParamSchema.parse((await ctx.params).id);
  deleteSong(id);
  return new NextResponse(null, { status: 204 });
});
