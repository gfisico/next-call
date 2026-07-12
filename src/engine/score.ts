/**
 * Stage 2–4: スコアリング
 * score = BASE + Σスライダー寄与 + Σチェック寄与 + ジャンル上書き加点 − Σルール減点
 *
 * 直前 Performance が null（セッション1曲目）の場合、直前曲参照ルール
 * （同キー・特殊ジャンル連続・同作曲者・§12.5 vo減点）はすべてスキップする。
 * 属性 null は中立（寄与 0）扱い。
 */
import type { EngineConfig, EngineInput, EngineSong } from "./types";

/** 1曲のスコアを計算する（Stage 2–4。繰り返し減点は含まない） */
export function scoreSong(
  _song: EngineSong,
  _input: EngineInput,
  _config: EngineConfig,
): number {
  throw new Error("not implemented");
}
