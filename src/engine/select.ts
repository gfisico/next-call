/**
 * Stage 6–7: 候補集団の作成（§14.2）+ 重み付きランダム抽出（§14.2/§14.4）
 * - 集団: score ≥ maxScore − pool_band かつ score ≥ score_floor
 * - 集団サイズ < candidate_count+2 のとき pool_band_relaxed へ一度だけ拡大
 * - それでも candidate_count 未満なら isSparse=true で少ないまま返す
 * - weight = exp((score − maxScore) / τ) の softmax 非復元抽出
 * - 1曲引くたびに同じ特殊ジャンルを持つ残余曲の weight × genreDrawDecay
 * - 乱数は seed 注入の決定的 PRNG（Math.random() 禁止）
 */
import type { EngineConfig, ScoredSong } from "./types";

export function selectCandidates(
  _scored: ScoredSong[],
  _config: EngineConfig,
  _seed: number,
): { selected: ScoredSong[]; isSparse: boolean } {
  throw new Error("not implemented");
}
