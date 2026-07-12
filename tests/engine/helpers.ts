/**
 * エンジンテスト用フィクスチャファクトリ。
 * makeConfig() の既定値は discovery.md「Provisional Values」と厳密に一致させる。
 * テストは常に明示 config を渡す（実装側のハードコードを許さない）。
 */
import type {
  EngineConfig,
  EngineConditions,
  EngineInput,
  EngineSong,
  PreviousPerformance,
  SelectionIntent,
  SongStats,
} from "@/engine/types";
import { ALL_GENRES } from "@/engine/types";

/** discovery.md「Provisional Values」準拠の既定 EngineConfig */
export function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    baseScore: 50, // engine.base_score
    appearanceWindowDays: 730, // engine.appearance_window_days
    sliderWeights: { rare: 6, longUnplayed: 6, safety: 1.2, mood: 6, ballad: 8 },
    seasonalBonus: 10, // engine.seasonal_bonus
    listenerWeight: 4, // engine.listener_weight
    sameKeyPenalty: 15, // engine.same_key_penalty
    sameKeyPenaltyOverrides: { F: 8, Bb: 8 },
    consecutiveGenre: { default: { mode: "penalty", value: 15 } },
    bluesPenalty: 10, // engine.blues_penalty
    sameComposerPenalty: 5, // engine.same_composer_penalty
    topCalledN: 10, // engine.top_called_n
    topCalledPenalty: 12, // engine.top_called_penalty
    lowFreqThreshold: 0.05, // engine.low_freq_threshold
    lowFreqPenalty: 8, // engine.low_freq_penalty
    lowFreqWaiverBonus: 10, // engine.low_freq_waiver_bonus
    multiHornVocalPenalty: 15, // engine.multi_horn_vocal_penalty
    afterVocalVocalPenalty: 15, // engine.after_vocal_vocal_penalty（§12.5）
    genreOverrideBonus: 15, // engine.genre_override_bonus
    repeatPenalties: {
      lastRequest: 12,
      recentRequests: 6,
      sameSignature: 6,
      genreRepeat: 3,
    },
    repeatWindowDays: 30, // engine.repeat_window_days
    relaxPoolThreshold: 8, // engine.relax_pool_threshold
    poolBand: 10, // engine.pool_band
    poolBandRelaxed: 15, // engine.pool_band_relaxed
    scoreFloor: 30, // engine.score_floor
    randomTemperature: 5, // engine.random_temperature
    candidateCount: 3, // engine.candidate_count
    genreDrawDecay: 0.5,
    longUnplayedDays: 365, // engine.long_unplayed_days
    ...overrides,
  };
}

/**
 * 中立な曲: 既定 intent（全スライダー0・チェックOFF）+ 既定 input（直前曲なし）で
 * scoreSong が base_score ちょうどになる属性。
 */
export function makeSong(
  overrides: Partial<EngineSong> & { id: number },
): EngineSong {
  return {
    title: `Song ${overrides.id}`,
    songKey: "C",
    form: "AABA",
    composer: null,
    hasPlayed: true,
    noChartOk: false,
    isStandard: false,
    simpleForm: false,
    inKurobon1: true,
    season: "ALL",
    listenerLevel: 3,
    energyLevel: 3,
    needsReview: false,
    genres: [],
    ...overrides,
  };
}

/**
 * 中立な事前集計。
 * appearanceCount=5 → m_rare=0.5（理由 RARE_AT_VENUE 非発火）
 * daysSinceLastPlayed=100 → m_old≈0.137（理由 LONG_UNPLAYED 非発火）
 * ※ スライダー0なら寄与はいずれも 0
 */
export function makeStats(overrides: Partial<SongStats> = {}): SongStats {
  return {
    appearanceCount: 5,
    daysSinceLastPlayed: 100,
    myPlayCount: 0,
    myCallCount: 0,
    ...overrides,
  };
}

/** 中立な選曲意図（全スライダー0・チェックOFF） */
export function makeIntent(
  overrides: Partial<SelectionIntent> = {},
): SelectionIntent {
  return {
    rare: 0,
    longUnplayed: 0,
    safety: 0,
    mood: 0,
    ballad: 0,
    seasonal: false,
    listener: false,
    ...overrides,
  };
}

export function makeConditions(
  overrides: Partial<EngineConditions> = {},
): EngineConditions {
  return {
    horns: "ONE",
    beginner: "NONE",
    kurobon1Only: false,
    genreOverride: [],
    ...overrides,
  };
}

/**
 * 直前演奏。既定値は makeSong の既定と一切衝突しない
 * （キーG≠C・form ABAC≠AABA・作曲者不一致・ジャンルなし・vo なし）。
 */
export function makePrev(
  overrides: Partial<PreviousPerformance> = {},
): PreviousPerformance {
  return {
    songKey: "G",
    form: "ABAC",
    composer: "__prev_composer__",
    genres: [],
    inKurobon1: true,
    season: "ALL",
    frontInstruments: ["as", "tp"],
    ...overrides,
  };
}

/** 全9ジャンルとも低頻度ではない比率（低頻度減点を発火させない既定） */
export function normalGenreRatios(): Record<string, number> {
  return Object.fromEntries(ALL_GENRES.map((g) => [g, 0.2]));
}

/**
 * エンジン入力。songs を渡すと stats 未指定分は makeStats() で自動補完する。
 */
export function makeInput(
  overrides: Partial<EngineInput> = {},
): EngineInput {
  const songs = overrides.songs ?? [];
  const stats: Record<number, SongStats> = { ...(overrides.stats ?? {}) };
  for (const song of songs) {
    if (!(song.id in stats)) stats[song.id] = makeStats();
  }
  return {
    playedTodaySongIds: [],
    previousPerformance: null,
    history: {
      lastRequestSongIds: [],
      recentSongIds: [],
      sameSignatureCounts: {},
      lastRequestGenres: [],
    },
    topCalledSongIds: [],
    genreCallRatios: normalGenreRatios(),
    currentSeason: "SUMMER",
    conditions: makeConditions(),
    intent: makeIntent(),
    pendingSongIds: [],
    ...overrides,
    songs,
    stats,
  };
}
