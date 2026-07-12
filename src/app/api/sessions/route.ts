/**
 * GET  /api/sessions — 履歴一覧（venue 名含む・新しい順）
 * POST /api/sessions — セッション開始（sessionDate 既定=JST当日）。ACTIVE が既にあれば 409
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { listSessions, startSession } from "@/server/repositories/sessions";
import { sessionStartSchema } from "@/server/validation/sessions";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () =>
  NextResponse.json({ sessions: listSessions() }),
);

export const POST = withErrorHandling(async (req: Request) => {
  const input = await parseJsonBody(req, sessionStartSchema);
  return NextResponse.json({ session: startSession(input) }, { status: 201 });
});
