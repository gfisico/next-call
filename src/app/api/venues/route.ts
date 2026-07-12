/**
 * GET  /api/venues — 店舗マスター一覧
 * POST /api/venues — 追加。is_home 必須（初回登録時の一度だけの判定。仕様§4.2）。name 重複は 409
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { createVenue, listVenues } from "@/server/repositories/masters";
import { venueCreateSchema } from "@/server/validation/masters";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () =>
  NextResponse.json({ venues: listVenues() }),
);

export const POST = withErrorHandling(async (req: Request) => {
  const input = await parseJsonBody(req, venueCreateSchema);
  return NextResponse.json({ venue: createVenue(input) }, { status: 201 });
});
