/**
 * GET /api/settings — engine.* を含む全設定（{ key: value } 形式）
 * PUT /api/settings — key-value の一括/個別更新（既知キーのみ許可・型検証は zod）
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { getAllSettings, putSettings } from "@/server/repositories/settings";
import { settingsPutSchema } from "@/server/validation/settings";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () =>
  NextResponse.json({ settings: getAllSettings() }),
);

export const PUT = withErrorHandling(async (req: Request) => {
  const entries = await parseJsonBody(req, settingsPutSchema);
  return NextResponse.json({ settings: putSettings(entries) });
});
