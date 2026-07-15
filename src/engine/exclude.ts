/**
 * Stage 1: 完全除外（§12.1）
 * - has_played=false（コール可能曲でない）
 * - 当日すでに演奏済み
 * - 直前の曲と form が同じ（直前 Performance が null ならスキップ）
 * - beginner=PRESENT 時: difficulty===null || difficulty>2 を除外（難易度が低い曲=difficulty≤2 のみ通過）
 *   （difficulty=null は評価不能 → null は安全側で除外）
 * - kurobon1_only=true かつ in_kurobon1=false（in_kurobon1 が null なら評価不能 → 除外しない）
 */
import { isBeginnerFriendly, sameNonNull } from "./predicates";
import type { EngineConfig, EngineInput, EngineSong } from "./types";

/** 完全除外を適用し、通過した曲のみ返す */
export function filterExcluded(
  input: EngineInput,
  _config: EngineConfig,
): EngineSong[] {
  const playedToday = new Set(input.playedTodaySongIds);
  const prev = input.previousPerformance;
  const { beginner, kurobon1Only } = input.conditions;

  return input.songs.filter((song) => {
    // §6/§12.1: コール可能曲でない
    if (!song.hasPlayed) return false;

    // §12.1: 当日すでに演奏済み
    if (playedToday.has(song.id)) return false;

    // §12.1: 直前の曲と form が同じ。
    // 直前 Performance なし（セッション1曲目）／どちらかの form が null（評価不能）ならスキップ
    if (prev !== null && sameNonNull(song.form, prev.form)) return false;

    // §8.2/§12.1: 初心者対応時は難易度が低い曲（difficulty≤2）のみ通過。
    // difficulty===null || difficulty>2 は除外（null は安全側で除外）
    if (beginner === "PRESENT" && !isBeginnerFriendly(song)) return false;

    // §11/§12.1: 黒本1限定。in_kurobon1 が null なら評価不能 → 除外しない
    if (kurobon1Only && song.inKurobon1 === false) return false;

    return true;
  });
}
