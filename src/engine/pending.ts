/**
 * 保留曲の注釈（仕様§16）
 * - スコアに一切影響しない。無条件で全保留曲を返す（完全除外該当でも隠さない）
 * - 警告バッジ: 当日演奏済み / 直前曲と同じ構成 / 黒本1条件外 / 編成に合いにくい
 */
import { sameNonNull } from "./predicates";
import type {
  EngineConfig,
  EngineInput,
  PendingAnnotation,
  PendingWarning,
} from "./types";

export function annotatePendingSongs(
  input: EngineInput,
  _config: EngineConfig,
): PendingAnnotation[] {
  const songsById = new Map(input.songs.map((s) => [s.id, s]));
  const playedToday = new Set(input.playedTodaySongIds);
  const prev = input.previousPerformance;
  const { conditions } = input;

  const annotations: PendingAnnotation[] = [];
  for (const songId of input.pendingSongIds) {
    const song = songsById.get(songId);
    if (!song) continue;

    const warnings: PendingWarning[] = [];

    // 当日演奏済み
    if (playedToday.has(songId)) warnings.push("PLAYED_TODAY");

    // 直前曲と同じ構成
    if (prev !== null && sameNonNull(song.form, prev.form)) {
      warnings.push("SAME_FORM");
    }

    // 黒本1条件外
    if (conditions.kurobon1Only && song.inKurobon1 === false) {
      warnings.push("KUROBON1_MISMATCH");
    }

    // 今回の編成に合いにくい（複数管 × 歌もの等）
    if (conditions.horns === "MULTI" && song.genres.includes("歌もの")) {
      warnings.push("FORMATION_MISMATCH");
    }

    annotations.push({ songId, warnings });
  }
  return annotations;
}
