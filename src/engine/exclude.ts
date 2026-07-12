/**
 * Stage 1: 完全除外（§12.1）
 * - has_played=false（コール可能曲でない）
 * - 当日すでに演奏済み
 * - 直前の曲と form が同じ（直前 Performance が null ならスキップ）
 * - beginner=PRESENT 時: NOT(is_standard AND no_chart_ok AND simple_form)
 *   （属性 null は「満たさない」扱い = 安全側で除外）
 * - kurobon1_only=true かつ in_kurobon1=false（in_kurobon1 が null なら評価不能 → 除外しない）
 */
import type { EngineConfig, EngineInput, EngineSong } from "./types";

/** 完全除外を適用し、通過した曲のみ返す */
export function filterExcluded(
  _input: EngineInput,
  _config: EngineConfig,
): EngineSong[] {
  throw new Error("not implemented");
}
