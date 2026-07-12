/**
 * POST /api/songs/quick — クイック登録（セッション中のマスタ未登録曲）
 * - title のみ受け取り needs_review=true, has_played=false, 他属性は既定値で作成（201）
 * - 既存曲と title 完全一致（normalizeTitle 後の一致）なら 409 + 既存曲を error.details.song に返す
 */
import { NextResponse } from "next/server";
import { conflict } from "@/server/http/errors";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { quickCreateSong } from "@/server/repositories/songs";
import { songQuickCreateSchema } from "@/server/validation/songs";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: Request) => {
  const { title } = await parseJsonBody(req, songQuickCreateSchema);
  const result = quickCreateSong(title);
  if (!result.created) {
    throw conflict(`同名の曲が既に存在します: ${result.song.title}`, {
      song: result.song,
    });
  }
  return NextResponse.json({ song: result.song }, { status: 201 });
});
