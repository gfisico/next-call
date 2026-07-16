/**
 * POST /api/sessions/import-memo/preview — 貼付メモの解析プレビュー（DB 未書込）
 *   body（camelCase）: { text: string }
 *   parseMemo → venue/曲名/楽器コード突合結果（解決済み/要確認/警告）を返す。
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { previewMemoImport } from "@/server/import/memo-preview";
import { memoPreviewSchema } from "@/server/validation/import-memo";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: Request) => {
  const { text } = await parseJsonBody(req, memoPreviewSchema);
  return NextResponse.json(previewMemoImport(text));
});
