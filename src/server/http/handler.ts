/**
 * Route Handler 共通ラッパー（全 API 規約 — unit-03 で確立。後続ユニット 04/08 もここに従う）
 *
 * すべての Route Handler は withErrorHandling() で包むこと。
 * - ApiError throw → 対応ステータス + 統一形式 { error: { code, message, details? } }
 * - ZodError（バリデーション失敗）→ 400 VALIDATION_ERROR + details に zod issues
 * - その他の未捕捉例外 → console.error でスタックを出力（observable 基準）し、
 *   500 INTERNAL_ERROR の統一形式で返す（内部情報はレスポンスに漏らさない）
 */
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApiError, apiError } from "./errors";

type Handler<Args extends unknown[]> = (
  ...args: Args
) => Promise<NextResponse> | NextResponse;

export function withErrorHandling<Args extends unknown[]>(
  handler: Handler<Args>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return apiError(err.status, err.code, err.message, err.details);
      }
      if (err instanceof ZodError) {
        return apiError(
          400,
          "VALIDATION_ERROR",
          "リクエストの形式が不正です",
          err.issues,
        );
      }
      // 未捕捉例外: スタックをサーバーログへ（障害調査の基点）
      console.error(err);
      return apiError(
        500,
        "INTERNAL_ERROR",
        "サーバー内部でエラーが発生しました",
      );
    }
  };
}

/**
 * JSON ボディを読み取り zod スキーマで検証する。
 * - JSON として不正 → 400 VALIDATION_ERROR
 * - スキーマ不一致 → ZodError（withErrorHandling が 400 に変換）
 */
export async function parseJsonBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "JSON ボディが不正です");
  }
  return schema.parse(raw);
}
