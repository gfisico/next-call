/**
 * Stage 6–7: 候補集団の作成（§14.2）+ 重み付きランダム抽出（§14.2/§14.4）
 * - 集団: score ≥ maxScore − pool_band かつ score ≥ score_floor
 * - 集団サイズ < candidate_count+2 のとき pool_band_relaxed へ一度だけ拡大
 * - それでも candidate_count 未満なら isSparse=true で少ないまま返す
 * - weight = exp((score − maxScore) / τ) の softmax 非復元抽出
 * - 1曲引くたびに同じ特殊ジャンルを持つ残余曲の weight × genreDrawDecay
 * - 乱数は seed 注入の決定的 PRNG（Math.random() 禁止）
 */
import { SPECIAL_CONSECUTIVE_GENRES } from "./types";
import type { EngineConfig, ScoredSong } from "./types";

const SPECIAL_GENRES = new Set<string>(SPECIAL_CONSECUTIVE_GENRES);

/**
 * splitmix32 系の決定的 PRNG。seed（0 含む任意の整数）から [0, 1) の乱数列を生成する。
 */
export function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let t = state ^ (state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = (t ^ (t >>> 15)) >>> 0;
    return t / 4294967296;
  };
}

/** 曲が持つ特殊ジャンル（§12.3 の8種）のみ抽出 */
function specialGenresOf(song: ScoredSong): string[] {
  return song.song.genres.filter((g) => SPECIAL_GENRES.has(g));
}

export function selectCandidates(
  scored: ScoredSong[],
  config: EngineConfig,
  seed: number,
): { selected: ScoredSong[]; isSparse: boolean } {
  if (scored.length === 0) return { selected: [], isSparse: true };

  const maxScore = Math.max(...scored.map((s) => s.score));

  // Stage 6: 候補集団（点差バンド + 最低スコア床）
  const inBand = (band: number) => (s: ScoredSong) =>
    s.score >= maxScore - band && s.score >= config.scoreFloor;

  let pool = scored.filter(inBand(config.poolBand));

  // 集団サイズ不足時はバンドを一度だけ拡大（§14.2 / Provisional #8）
  if (pool.length < config.candidateCount + 2) {
    pool = scored.filter(inBand(config.poolBandRelaxed));
  }

  // それでも candidate_count 未満なら無理に増やさず isSparse で明示（§14.5）
  const isSparse = pool.length < config.candidateCount;

  // Stage 7: softmax 重み付き非復元抽出
  const rand = createPrng(seed);
  const remaining = pool.map((s) => ({
    item: s,
    weight: Math.exp((s.score - maxScore) / config.randomTemperature),
  }));

  const selected: ScoredSong[] = [];
  const drawCount = Math.min(config.candidateCount, remaining.length);
  for (let i = 0; i < drawCount; i++) {
    const total = remaining.reduce((sum, e) => sum + e.weight, 0);
    let r = rand() * total;
    let pick = remaining.length - 1;
    for (let j = 0; j < remaining.length; j++) {
      r -= remaining[j].weight;
      if (r < 0) {
        pick = j;
        break;
      }
    }
    const [drawn] = remaining.splice(pick, 1);
    selected.push(drawn.item);

    // §14.4 同一特殊ジャンルの残余曲 weight を減衰（ジャンル偏り抑制）
    const drawnSpecial = new Set(specialGenresOf(drawn.item));
    if (drawnSpecial.size > 0) {
      for (const entry of remaining) {
        if (specialGenresOf(entry.item).some((g) => drawnSpecial.has(g))) {
          entry.weight *= config.genreDrawDecay;
        }
      }
    }
  }

  return { selected, isSparse };
}
