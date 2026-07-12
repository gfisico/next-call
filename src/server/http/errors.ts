/**
 * API エラーの統一形式（全 API 規約 — unit-03 で確立。後続ユニット 04/08 もここに従う）
 *
 * すべての API エラーレスポンスは次の JSON 形式で返す:
 *   { "error": { "code": string, "message": string, "details"?: unknown } }
 *
 * エラーコード規約（HTTP ステータスとの対応）:
 *   - VALIDATION_ERROR (400) — リクエスト形式・値の不正（zod issues を details に含める）
 *   - NOT_FOUND        (404) — 対象リソースが存在しない
 *   - CONFLICT         (409) — 重複・参照中削除・ACTIVE セッション二重開始などの競合
 *                              （details に既存リソース等の補助情報を含めてよい）
 *   - INTERNAL_ERROR   (500) — 未捕捉例外（サーバー側で console.error によりスタックを出力）
 *
 * エラー形式・エラーコードはこのファイルが唯一の定義。各 Route Handler で直接
 * NextResponse.json({ error: ... }) を組み立てないこと（apiError / ApiError を使う）。
 */
import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/** 統一形式のエラーレスポンスを生成する */
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = { error: { code, message } };
  if (details !== undefined) {
    body.error.details = details;
  }
  return NextResponse.json(body, { status });
}

/**
 * リポジトリ層・Route 層から throw する業務エラー。
 * withErrorHandling（src/server/http/handler.ts）が捕捉して統一形式に変換する。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** よく使う業務エラーのショートハンド */
export const notFound = (message: string, details?: unknown) =>
  new ApiError(404, "NOT_FOUND", message, details);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "CONFLICT", message, details);

export const validationError = (message: string, details?: unknown) =>
  new ApiError(400, "VALIDATION_ERROR", message, details);
