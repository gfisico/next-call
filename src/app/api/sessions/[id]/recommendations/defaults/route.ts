/**
 * GET /api/sessions/:id/recommendations/defaults — 選曲支援画面の初期値（unit-04）
 * - 前回意図値（intent.last_values）。無ければ全スライダー中央（0）+ チェック OFF
 * - suggestSeasonalOn: セッション1曲目（演奏記録 0 件）かつ設定
 *   engine.first_song_seasonal_default が true のとき true（仕様§9.7。
 *   API はフラグを返すだけで、初期値への適用は unit-06 の UI が行う）
 * - 編成条件既定は UNKNOWN / kurobon1Only=false / genreOverride=[]
 */
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { performances, sessions } from "@/db/schema";
import { notFound } from "@/server/http/errors";
import { withErrorHandling } from "@/server/http/handler";
import { getFirstSongSeasonalDefault } from "@/server/recommendation/config";
import { INTENT_LAST_VALUES_KEY } from "@/server/recommendation/service";
import { getAllSettings } from "@/server/repositories/settings";
import { idParamSchema } from "@/server/validation/common";
import { recommendationIntentSchema } from "@/server/validation/recommendations";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 初回の中央値（全スライダー 0・チェック OFF） */
const NEUTRAL_INTENT = {
  rare: 0,
  fresh: 0,
  safety: 0,
  mood: 0,
  ballad: 0,
  seasonal: false,
  listener: false,
} as const;

export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const sessionId = idParamSchema.parse((await ctx.params).id);
  const db = getDb();

  const session = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!session) {
    throw notFound(`セッションが見つかりません: id=${sessionId}`);
  }

  const settings = getAllSettings(db);

  // 前回意図値（形が不正なら初回扱いで中央値へフォールバック）
  const lastValues = recommendationIntentSchema.safeParse(
    settings[INTENT_LAST_VALUES_KEY],
  );
  const intent = lastValues.success ? lastValues.data : { ...NEUTRAL_INTENT };

  // 1曲目（演奏記録 0 件）なら季節感チェックの推奨フラグを立てる
  const performanceCount =
    db
      .select({ n: sql<number>`count(*)` })
      .from(performances)
      .where(eq(performances.sessionId, sessionId))
      .get()?.n ?? 0;
  const suggestSeasonalOn =
    performanceCount === 0 && getFirstSongSeasonalDefault(settings);

  return NextResponse.json({
    defaults: {
      intent,
      conditions: {
        horns: "UNKNOWN",
        beginner: "UNKNOWN",
        kurobon1Only: false,
        genreOverride: [],
      },
      suggestSeasonalOn,
    },
  });
});
