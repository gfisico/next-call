/**
 * PATCH /api/venues/:id — 店舗更新（name / isHome）
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { updateVenue } from "@/server/repositories/masters";
import { idParamSchema } from "@/server/validation/common";
import { venueUpdateSchema } from "@/server/validation/masters";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const id = idParamSchema.parse((await ctx.params).id);
  const patch = await parseJsonBody(req, venueUpdateSchema);
  return NextResponse.json({ venue: updateVenue(id, patch) });
});
