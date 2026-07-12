/**
 * GET  /api/songs — 一覧+検索（title 部分一致）・フィルタ（needsReview/genre/season/hasPlayed）・
 *                   ソート（sort=title|updated）。ジャンルタグを含めて返す
 * POST /api/songs — 全属性+ジャンルタグ配列で作成（title 重複は 409）
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { createSong, listSongs } from "@/server/repositories/songs";
import {
  songCreateSchema,
  songListQuerySchema,
} from "@/server/validation/songs";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: Request) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const query = songListQuerySchema.parse(params);
  return NextResponse.json({ songs: listSongs(query) });
});

export const POST = withErrorHandling(async (req: Request) => {
  const input = await parseJsonBody(req, songCreateSchema);
  return NextResponse.json({ song: createSong(input) }, { status: 201 });
});
