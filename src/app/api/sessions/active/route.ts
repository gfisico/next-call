/**
 * GET /api/sessions/active — 進行中セッション+演奏記録一覧（フロント編成含む）。
 * 進行中が無ければ 404。
 */
import { NextResponse } from "next/server";
import { notFound } from "@/server/http/errors";
import { withErrorHandling } from "@/server/http/handler";
import { getActiveSession } from "@/server/repositories/sessions";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const session = getActiveSession();
  if (!session) throw notFound("進行中のセッションはありません");
  return NextResponse.json({ session });
});
