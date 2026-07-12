/**
 * GET /api/genre-tags — ジャンル・特徴タグ一覧（固定9種。読み取りのみ。仕様§7.2）
 */
import { NextResponse } from "next/server";
import { withErrorHandling } from "@/server/http/handler";
import { listGenreTags } from "@/server/repositories/masters";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () =>
  NextResponse.json({ genreTags: listGenreTags() }),
);
