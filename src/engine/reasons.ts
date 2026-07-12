/**
 * Stage 8: 推薦理由生成（固定テンプレート。LLM 不使用）
 * - 発火したルール・事実から最大4件/曲
 * - 発火した理由が2件未満のときのみ、フォールバック（FALLBACK_*）で2件まで補完
 * - 発火していないルールの理由を捏造しない
 */
import type { EngineConfig, EngineInput, EngineSong, Reason } from "./types";

export function generateReasons(
  _song: EngineSong,
  _input: EngineInput,
  _config: EngineConfig,
): Reason[] {
  throw new Error("not implemented");
}
