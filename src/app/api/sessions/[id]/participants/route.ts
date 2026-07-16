/**
 * PUT /api/sessions/:id/participants — パート別参加者数の置換 + リスナー数/ホストパート更新
 *   body（camelCase）: {
 *     participants: [{ instrumentCode, count }],  // 全消し→再挿入で置換
 *     listenerCount?: number|null,                // 省略で据え置き / null でクリア
 *     hostInstrumentCode?: string|null            // 省略で据え置き / null でクリア
 *   }
 *   未知 instrumentCode / hostInstrumentCode は 400。count は 0 以上。
 *   更新後のセッション詳細（participants 含む）を返す。
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { putSessionParticipants } from "@/server/repositories/sessions";
import { idParamSchema } from "@/server/validation/common";
import { sessionParticipantsSchema } from "@/server/validation/sessions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const sessionId = idParamSchema.parse((await ctx.params).id);
  const body = await parseJsonBody(req, sessionParticipantsSchema);
  return NextResponse.json({
    session: putSessionParticipants(sessionId, body),
  });
});
