/**
 * Stage 9: 条件別候補（§8/§15.2）
 * - horns=UNKNOWN → ONE / MULTI、beginner=UNKNOWN → NONE / PRESENT の各ブランチで再実行
 * - 各軸を独立に分岐し、分岐しない側の軸は UNKNOWN のまま（除外・減点なし）維持
 * - 両軸 UNKNOWN でもブランチは最大4本。組み合わせブランチ（1管×初心者あり等）は生成しない
 * - 各ブランチの最上位曲が通常候補と重複しない場合のみラベル付きで追加
 */
import type { ConditionalCandidate, EngineConfig, EngineInput } from "./types";

export function generateConditionalCandidates(
  _input: EngineInput,
  _config: EngineConfig,
  _seed: number,
  _normalCandidateIds: number[],
): ConditionalCandidate[] {
  throw new Error("not implemented");
}
