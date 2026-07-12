/**
 * 性能基準: 曲500・履歴5000規模の合成データで recommend() < 100ms
 * （API 全体 2 秒の検証は unit-04。ここではエンジン単体の余裕分を確認する）
 * 履歴5000件はエンジンへは事前集計（stats/history）として渡る前提で、
 * その規模に相当する集計値・履歴 ID 集合を合成する。
 */
import { describe, expect, it } from "vitest";
import { recommend } from "@/engine/index";
import type { EngineSong, SongStats } from "@/engine/types";
import { ALL_GENRES } from "@/engine/types";
import { makeConfig, makeInput, makeSong } from "./helpers";

const KEYS = ["C", "F", "Bb", "Eb", "G", "D", "A", "Ab"];
const FORMS = ["AABA", "ABAC", "BLUES12", "OTHER"] as const;
const COMPOSERS = ["Monk", "Ellington", "Parker", "Davis", "Shorter", null];

function syntheticDataset(songCount: number, historyCount: number) {
  const songs: EngineSong[] = [];
  const stats: Record<number, SongStats> = {};
  for (let i = 1; i <= songCount; i++) {
    songs.push(
      makeSong({
        id: i,
        songKey: KEYS[i % KEYS.length],
        form: FORMS[i % FORMS.length],
        composer: COMPOSERS[i % COMPOSERS.length],
        isStandard: i % 3 === 0,
        noChartOk: i % 2 === 0,
        simpleForm: i % 4 === 0,
        inKurobon1: i % 2 === 0,
        season: i % 10 === 0 ? "SUMMER" : "ALL",
        listenerLevel: (i % 5) + 1,
        energyLevel: ((i * 7) % 5) + 1,
        genres: i % 6 === 0 ? [ALL_GENRES[i % ALL_GENRES.length]] : [],
      }),
    );
    // 履歴 historyCount 件相当の事前集計を決定的に合成
    stats[i] = {
      appearanceCount: (i * 13) % 15,
      daysSinceLastPlayed: i % 7 === 0 ? null : (i * 31) % 2000,
      myPlayCount: (i * 3) % 12,
      myCallCount: (i * 5) % 8,
    };
  }
  const sameSignatureCounts: Record<number, number> = {};
  for (let i = 1; i <= songCount; i++) {
    sameSignatureCounts[i] = (i * 11) % 5;
  }
  const historyDensity = Math.max(1, Math.floor(songCount / (historyCount / 100)));
  return makeInput({
    songs,
    stats,
    playedTodaySongIds: [1, 2, 3, 4, 5],
    previousPerformance: {
      songKey: "F",
      form: "AABA",
      composer: "Monk",
      genres: ["ファンク"],
      inKurobon1: true,
      season: "ALL",
      frontInstruments: ["vo", "tp"],
    },
    history: {
      lastRequestSongIds: [10, 20, 30],
      recentSongIds: Array.from({ length: 15 }, (_, i) => (i * historyDensity) % songCount + 1),
      sameSignatureCounts,
      lastRequestGenres: ["ファンク", "バラード"],
    },
    topCalledSongIds: Array.from({ length: 10 }, (_, i) => i * 7 + 1),
    genreCallRatios: Object.fromEntries(
      ALL_GENRES.map((g, i) => [g, i % 3 === 0 ? 0.02 : 0.15]),
    ),
    intent: {
      rare: 1,
      longUnplayed: 1,
      safety: -1,
      mood: 1,
      ballad: 0,
      seasonal: true,
      listener: true,
    },
    conditions: {
      horns: "UNKNOWN", // 最悪ケース: 条件別ブランチも全実行
      beginner: "UNKNOWN",
      kurobon1Only: false,
      genreOverride: ["ファンク"],
    },
    pendingSongIds: [7, 77, 177],
  });
}

describe("性能", () => {
  it("曲500・履歴5000規模の合成データで recommend() が 100ms 未満で完了する", () => {
    const input = syntheticDataset(500, 5000);
    const config = makeConfig();

    // ウォームアップ（JIT の初回コンパイル分を除外）
    recommend(input, config, 1);

    const t0 = performance.now();
    const result = recommend(input, config, 42);
    const elapsed = performance.now() - t0;

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});
