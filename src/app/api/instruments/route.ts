/**
 * GET  /api/instruments — フロント楽器マスター一覧（sort_order 順。初期12種）
 * POST /api/instruments — 追加（code 重複は 409）
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import {
  createInstrument,
  listInstruments,
} from "@/server/repositories/masters";
import { instrumentCreateSchema } from "@/server/validation/masters";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () =>
  NextResponse.json({ instruments: listInstruments() }),
);

export const POST = withErrorHandling(async (req: Request) => {
  const input = await parseJsonBody(req, instrumentCreateSchema);
  return NextResponse.json(
    { instrument: createInstrument(input) },
    { status: 201 },
  );
});
