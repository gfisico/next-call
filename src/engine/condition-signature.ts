/**
 * condition_signature（§14.3 の「同一条件」判定用の署名文字列）
 * 編成（horns/beginner）+ 黒本1 + ジャンル上書き + スライダー符号から生成する。
 * - スライダーは符号（−/0/+）のみ反映（+1 と +2 は同一署名）
 * - チェックボックス（seasonal/listener）は署名に含めない
 * - genreOverride は順序に依存しない
 */
import type { EngineConditions, SelectionIntent } from "./types";

function sign(value: number): string {
  if (value > 0) return "+";
  if (value < 0) return "-";
  return "0";
}

export function conditionSignature(
  conditions: EngineConditions,
  intent: SelectionIntent,
): string {
  const genres = [...conditions.genreOverride].sort().join(",");
  const sliders = [
    intent.rare,
    intent.longUnplayed,
    intent.safety,
    intent.mood,
    intent.ballad,
  ]
    .map(sign)
    .join("");
  return [
    `h=${conditions.horns}`,
    `b=${conditions.beginner}`,
    `k1=${conditions.kurobon1Only ? 1 : 0}`,
    `g=${genres}`,
    `s=${sliders}`,
  ].join("|");
}
