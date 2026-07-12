/**
 * GET /api/export — 全テーブルのデータを単一 JSON としてダウンロード
 * （Content-Disposition: attachment。バックアップとは独立したユーザー主導の復旧手段）
 */
import { NextResponse } from "next/server";
import { jstDateString } from "@/lib/jst-date";
import { withErrorHandling } from "@/server/http/handler";
import { exportAll } from "@/server/repositories/export";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const payload = exportAll();
  const filename = `next-call-export-${jstDateString().replaceAll("-", "")}.json`;
  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
});
