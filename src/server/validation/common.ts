/**
 * src/server/validation/ — API リクエストバリデーションの置き場規約
 * （unit-03 で確立。後続ユニット unit-04（推薦・保留曲 API）・unit-08（CSV インポート）も
 *  zod スキーマは必ずこのディレクトリ配下に置くこと）
 *
 * 規約:
 * - リソースごとに 1 ファイル（songs.ts / masters.ts / settings.ts / sessions.ts / performances.ts …）
 * - JSON ボディ・レスポンスのフィールド名は camelCase（DB 列は snake_case、Drizzle が変換する）
 * - クエリパラメータも camelCase（例: ?needsReview=true&hasPlayed=false&sort=updated）
 * - スキーマ検証の失敗は ZodError のまま throw してよい
 *   （src/server/http/handler.ts の withErrorHandling が 400 VALIDATION_ERROR に変換する）
 * - エラーレスポンス形式は src/server/http/errors.ts が唯一の定義
 */
import { z } from "zod";

/** パスパラメータの数値 id（"12" → 12。非数・0以下は 400） */
export const idParamSchema = z.coerce.number().int().positive();

/** クエリパラメータの boolean（"true" / "false" のみ許可） */
export const queryBooleanSchema = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

/** 「少なくとも 1 フィールド指定」を要求する partial 更新用 refine */
export const nonEmptyObject = (obj: Record<string, unknown>) =>
  Object.values(obj).some((v) => v !== undefined);

export const NON_EMPTY_MESSAGE = "更新するフィールドを 1 つ以上指定してください";
