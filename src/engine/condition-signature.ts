/**
 * condition_signature（§14.3 の「同一条件」判定用の署名文字列）
 * 編成（horns/beginner）+ 黒本1 + ジャンル上書き + スライダー符号から生成する。
 * - スライダーは符号（−/0/+）のみ反映（+1 と +2 は同一署名）
 * - チェックボックス（seasonal/listener）は署名に含めない
 * - genreOverride は順序に依存しない
 */
import type { EngineConditions, SelectionIntent } from "./types";

export function conditionSignature(
  _conditions: EngineConditions,
  _intent: SelectionIntent,
): string {
  throw new Error("not implemented");
}
