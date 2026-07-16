/**
 * POST /api/sessions/import-memo/commit — 補正済み確定ペイロードの取込（単一トランザクション）
 *   body（camelCase）: { sessions: [...] }（テキストは受け取らず再パースしない）
 *   Session(status=ENDED)/Performance/FrontInstrument/SessionParticipant を生成。
 *   未知楽器コードは 400、date+venue 重複は 409。
 */
import { NextResponse } from "next/server";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { commitMemoImport } from "@/server/import/memo-commit";
import { memoCommitSchema } from "@/server/validation/import-memo";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: Request) => {
  const payload = await parseJsonBody(req, memoCommitSchema);
  return NextResponse.json({ summary: commitMemoImport(payload) });
});
