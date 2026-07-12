/**
 * POST /api/import/:type（type=songs|setlists）
 * CSV アップロード（multipart/form-data の file フィールド）。行単位で zod 検証し
 * ImportJob(PREVIEW) を作成する。
 * レスポンス 201: { job, totalRows, validRows, errors, unknowns }
 *
 * ルーティング上の注記（Next.js 制約）: 同一階層で [type] と [jobId] の動的セグメントを
 * 併置できないため、ジョブ系操作は /api/import/jobs/[jobId]/... に配置している
 * （spec の :jobId 直下記法からの合理的な逸脱）。
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/server/http/errors";
import { withErrorHandling } from "@/server/http/handler";
import { previewImport } from "@/server/import/preview";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ type: string }> };

const importTypeSchema = z.enum(["songs", "setlists"]);

export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const type = importTypeSchema.parse((await ctx.params).type);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw validationError(
      "multipart/form-data の CSV ファイルが必要です（file フィールド）",
    );
  }
  const file = form.get("file");
  if (typeof file === "string" || file === null) {
    throw validationError(
      "file フィールドに CSV ファイルを添付してください",
    );
  }
  const csvText = await file.text();

  const result = previewImport(type, csvText);
  return NextResponse.json(result, { status: 201 });
});
