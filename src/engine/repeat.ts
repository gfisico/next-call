/**
 * Stage 5: 繰り返し減点（§14.3–14.4）
 * - 前回リクエスト提示曲 −12 / 直近5リクエスト(30日) −6
 * - 同一 condition_signature 3回以上 追加 −6 / 前回提示ジャンル −3
 * - Stage 1–3 通過曲数（= scores のエントリ数）< relax_pool_threshold で全て半減
 *
 * 純関数: 入力 Map を破壊せず、新しい Map を返す。
 */
import type { EngineConfig, EngineInput } from "./types";

export function applyRepeatPenalties(
  _scores: Map<number, number>,
  _input: EngineInput,
  _config: EngineConfig,
): Map<number, number> {
  throw new Error("not implemented");
}
