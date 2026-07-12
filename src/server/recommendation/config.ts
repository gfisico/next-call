/**
 * 設定（settings key-value ストア）→ EngineConfig マッパー
 *
 * - キー対応は discovery.md「Provisional Values」（src/db/seed.ts SETTING_SEEDS）に従う
 * - 欠損キー・欠損サブキー・型不正は既定値へフォールバック（既存DBの旧形状にも耐える）
 * - genreDrawDecay / repeatPenalties.genreRepeat は設定キーが存在しないため常に既定値
 * - スコアロジックは一切持たない（詰め替えのみ。境界: src/engine/）
 */
import type { ConsecutiveGenreRule, EngineConfig } from "@/engine/types";

type Settings = Record<string, unknown>;

/** discovery.md「Provisional Values」準拠の既定値（設定欠損時のフォールバック） */
const DEFAULTS = {
  baseScore: 50,
  appearanceWindowDays: 730,
  sliderWeights: { rare: 6, longUnplayed: 6, safety: 1.2, mood: 6, ballad: 8 },
  seasonalBonus: 10,
  listenerWeight: 4,
  sameKeyPenalty: 15,
  sameKeyPenaltyOverrides: { F: 8, Bb: 8 } as Record<string, number>,
  consecutiveGenreDefault: { mode: "penalty", value: 15 } as ConsecutiveGenreRule,
  bluesPenalty: 10,
  sameComposerPenalty: 5,
  topCalledN: 10,
  topCalledPenalty: 12,
  lowFreqThreshold: 0.05,
  lowFreqPenalty: 8,
  lowFreqWaiverBonus: 10,
  multiHornVocalPenalty: 15,
  afterVocalVocalPenalty: 15,
  genreOverrideBonus: 15,
  repeatPenalties: {
    lastRequest: 12,
    recentRequests: 6,
    sameSignature: 6,
    genreRepeat: 3,
  },
  repeatWindowDays: 30,
  relaxPoolThreshold: 8,
  poolBand: 10,
  poolBandRelaxed: 15,
  scoreFloor: 30,
  randomTemperature: 5,
  candidateCount: 3,
  genreDrawDecay: 0.5,
  longUnplayedDays: 365,
  recentRequestCount: 5,
  firstSongSeasonalDefault: true,
  pendingAutoReleaseOnCall: true,
} as const;

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** { F: 8, Bb: 8 } 形式の数値マップ（不正エントリは捨てる） */
function numberMap(
  value: unknown,
  fallback: Record<string, number>,
): Record<string, number> {
  const obj = record(value);
  if (!obj) return { ...fallback };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function consecutiveGenreRule(
  value: unknown,
  fallback: ConsecutiveGenreRule,
): ConsecutiveGenreRule {
  const obj = record(value);
  if (!obj) return { ...fallback };
  const mode = obj.mode === "exclude" ? "exclude" : "penalty";
  return { mode, value: num(obj.value, fallback.value) };
}

/** engine.consecutive_genre: { default: {mode,value}, overrides?: { ジャンル名: {mode,value} } } */
function consecutiveGenre(value: unknown): EngineConfig["consecutiveGenre"] {
  const obj = record(value);
  const def = consecutiveGenreRule(obj?.default, DEFAULTS.consecutiveGenreDefault);
  const overridesObj = record(obj?.overrides);
  if (!overridesObj) return { default: def };
  const overrides: Record<string, ConsecutiveGenreRule> = {};
  for (const [genre, rule] of Object.entries(overridesObj)) {
    overrides[genre] = consecutiveGenreRule(rule, def);
  }
  return { default: def, overrides };
}

/**
 * 設定ストアの内容から EngineConfig を組み立てる。
 * SETTING_SEEDS の形状（snake_case・repeat_penalties のネスト）を EngineConfig へ詰め替える。
 */
export function buildEngineConfig(settings: Settings): EngineConfig {
  const sliders = record(settings["engine.slider_weights"]);
  const repeat = record(settings["engine.repeat_penalties"]);
  const recent = record(repeat?.recent);
  const sameCondition = record(repeat?.same_condition);

  return {
    baseScore: num(settings["engine.base_score"], DEFAULTS.baseScore),
    appearanceWindowDays: num(
      settings["engine.appearance_window_days"],
      DEFAULTS.appearanceWindowDays,
    ),
    sliderWeights: {
      rare: num(sliders?.rare, DEFAULTS.sliderWeights.rare),
      longUnplayed: num(
        sliders?.long_unplayed,
        DEFAULTS.sliderWeights.longUnplayed,
      ),
      safety: num(sliders?.safety, DEFAULTS.sliderWeights.safety),
      mood: num(sliders?.mood, DEFAULTS.sliderWeights.mood),
      ballad: num(sliders?.ballad, DEFAULTS.sliderWeights.ballad),
    },
    seasonalBonus: num(settings["engine.seasonal_bonus"], DEFAULTS.seasonalBonus),
    listenerWeight: num(
      settings["engine.listener_weight"],
      DEFAULTS.listenerWeight,
    ),
    sameKeyPenalty: num(
      settings["engine.same_key_penalty"],
      DEFAULTS.sameKeyPenalty,
    ),
    sameKeyPenaltyOverrides: numberMap(
      settings["engine.same_key_penalty_overrides"],
      DEFAULTS.sameKeyPenaltyOverrides,
    ),
    consecutiveGenre: consecutiveGenre(settings["engine.consecutive_genre"]),
    bluesPenalty: num(settings["engine.blues_penalty"], DEFAULTS.bluesPenalty),
    sameComposerPenalty: num(
      settings["engine.same_composer_penalty"],
      DEFAULTS.sameComposerPenalty,
    ),
    topCalledN: num(settings["engine.top_called_n"], DEFAULTS.topCalledN),
    topCalledPenalty: num(
      settings["engine.top_called_penalty"],
      DEFAULTS.topCalledPenalty,
    ),
    lowFreqThreshold: num(
      settings["engine.low_freq_threshold"],
      DEFAULTS.lowFreqThreshold,
    ),
    lowFreqPenalty: num(
      settings["engine.low_freq_penalty"],
      DEFAULTS.lowFreqPenalty,
    ),
    lowFreqWaiverBonus: num(
      settings["engine.low_freq_waiver_bonus"],
      DEFAULTS.lowFreqWaiverBonus,
    ),
    multiHornVocalPenalty: num(
      settings["engine.multi_horn_vocal_penalty"],
      DEFAULTS.multiHornVocalPenalty,
    ),
    afterVocalVocalPenalty: num(
      settings["engine.after_vocal_vocal_penalty"],
      DEFAULTS.afterVocalVocalPenalty,
    ),
    genreOverrideBonus: num(
      settings["engine.genre_override_bonus"],
      DEFAULTS.genreOverrideBonus,
    ),
    repeatPenalties: {
      lastRequest: num(
        repeat?.last_request,
        DEFAULTS.repeatPenalties.lastRequest,
      ),
      recentRequests: num(
        recent?.penalty,
        DEFAULTS.repeatPenalties.recentRequests,
      ),
      sameSignature: num(
        sameCondition?.penalty,
        DEFAULTS.repeatPenalties.sameSignature,
      ),
      // 設定キーが存在しないため常に既定値（仕様定数 3）
      genreRepeat: DEFAULTS.repeatPenalties.genreRepeat,
    },
    repeatWindowDays: num(
      settings["engine.repeat_window_days"],
      DEFAULTS.repeatWindowDays,
    ),
    relaxPoolThreshold: num(
      settings["engine.relax_pool_threshold"],
      DEFAULTS.relaxPoolThreshold,
    ),
    poolBand: num(settings["engine.pool_band"], DEFAULTS.poolBand),
    poolBandRelaxed: num(
      settings["engine.pool_band_relaxed"],
      DEFAULTS.poolBandRelaxed,
    ),
    scoreFloor: num(settings["engine.score_floor"], DEFAULTS.scoreFloor),
    randomTemperature: num(
      settings["engine.random_temperature"],
      DEFAULTS.randomTemperature,
    ),
    candidateCount: num(
      settings["engine.candidate_count"],
      DEFAULTS.candidateCount,
    ),
    // 設定キーが存在しないため常に既定値
    genreDrawDecay: DEFAULTS.genreDrawDecay,
    longUnplayedDays: num(
      settings["engine.long_unplayed_days"],
      DEFAULTS.longUnplayedDays,
    ),
  };
}

/** 履歴読み取り（Stage 5 入力整備）で使うパラメータ */
export interface RepeatReadParams {
  /** 直近リクエストの参照本数（engine.repeat_penalties.recent.count、既定 5） */
  recentCount: number;
  /** 履歴参照期間（engine.repeat_window_days、既定 30） */
  windowDays: number;
}

export function getRepeatReadParams(settings: Settings): RepeatReadParams {
  const repeat = record(settings["engine.repeat_penalties"]);
  const recent = record(repeat?.recent);
  return {
    recentCount: num(recent?.count, DEFAULTS.recentRequestCount),
    windowDays: num(
      settings["engine.repeat_window_days"],
      DEFAULTS.repeatWindowDays,
    ),
  };
}

/** engine.first_song_seasonal_default（1曲目の季節感チェック推奨。既定 true） */
export function getFirstSongSeasonalDefault(settings: Settings): boolean {
  return bool(
    settings["engine.first_song_seasonal_default"],
    DEFAULTS.firstSongSeasonalDefault,
  );
}

/** pending.auto_release_on_call（コール時の保留曲自動解除。既定 true） */
export function getPendingAutoReleaseOnCall(settings: Settings): boolean {
  return bool(
    settings["pending.auto_release_on_call"],
    DEFAULTS.pendingAutoReleaseOnCall,
  );
}
