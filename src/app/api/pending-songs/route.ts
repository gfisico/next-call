/**
 * GET  /api/pending-songs — 保留曲一覧（曲情報込み。セッションをまたいで保持）
 * POST /api/pending-songs — 保留曲の追加（重複は冪等に 201 成功）
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import {
  addPendingSong,
  listPendingSongs,
} from "@/server/repositories/pending-songs";
import { pendingSongCreateSchema } from "@/server/validation/pending-songs";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  return NextResponse.json({ pendingSongs: listPendingSongs() });
});

export const POST = withErrorHandling(async (req: Request) => {
  const input = await parseJsonBody(req, pendingSongCreateSchema);
  return NextResponse.json(
    { pendingSong: addPendingSong(input.songId) },
    { status: 201 },
  );
});
