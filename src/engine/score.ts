/**
 * Stage 2–4: スコアリング
 * score = BASE + Σスライダー寄与 + Σチェック寄与 + ジャンル上書き加点 − Σルール減点
 *
 * 直前 Performance が null（セッション1曲目）の場合、直前曲参照ルール
 * （同キー・特殊ジャンル連続・同作曲者・§12.5 vo減点）はすべてスキップする。
 * 属性 null は中立（寄与 0）扱い。
 */
import { SPECIAL_CONSECUTIVE_GENRES } from "./types";
import type { EngineConfig, EngineInput, EngineSong, SongStats } from "./types";

/** stats 欠落曲の安全側既定値（中立意図なら寄与 0 になる） */
const FALLBACK_STATS: SongStats = {
  appearanceCount: 0,
  daysSinceLastPlayed: null,
  myPlayCount: 0,
  myCallCount: 0,
};

/**
 * consecutive_genre の mode="exclude" 用の実効減点。
 * スコア段階では除外できないため、score_floor を必ず下回る大きな減点で除外相当にする。
 */
const EXCLUDE_MODE_PENALTY = 1e9;

/** 珍しさ metric（§9.2）: 店舗区分別登場回数 → 0..1 */
export function rareMetric(appearanceCount: number): number {
  if (appearanceCount <= 0) return 1.0;
  if (appearanceCount <= 2) return 0.8;
  if (appearanceCount <= 5) return 0.5;
  if (appearanceCount <= 10) return 0.2;
  return 0.0;
}

/** 久しぶり metric（§9.3）: m_old = min(日数 / 集計期間, 1.0)。履歴なし（null）→ 1.0 */
export function oldMetric(
  daysSinceLastPlayed: number | null,
  config: EngineConfig,
): number {
  if (daysSinceLastPlayed === null) return 1.0;
  return Math.min(daysSinceLastPlayed / config.appearanceWindowDays, 1.0);
}

/** 安全性スコア（§9.4 / Provisional #5）: 0–10 */
export function safetyScore(song: EngineSong, stats: SongStats): number {
  return (
    (song.isStandard === true ? 2 : 0) +
    (song.noChartOk === true ? 3 : 0) +
    (song.simpleForm === true ? 2 : 0) +
    Math.min(stats.myPlayCount, 5) * 0.4 +
    Math.min(stats.myCallCount, 3) * (1 / 3)
  );
}

/** 意図由来の各寄与（スライダー5 + チェック2）。理由生成（Stage 8）とも共有する */
export interface IntentContributions {
  rare: number;
  longUnplayed: number;
  safety: number;
  mood: number;
  ballad: number;
  seasonal: number;
  listener: number;
}

export function intentContributions(
  song: EngineSong,
  input: EngineInput,
  config: EngineConfig,
): IntentContributions {
  const stats = input.stats[song.id] ?? FALLBACK_STATS;
  const intent = input.intent;
  const w = config.sliderWeights;

  // §9.2 珍しい曲: s × w × m_rare
  const rare = intent.rare * w.rare * rareMetric(stats.appearanceCount);

  // §9.3 久しぶり: s × w × m_old
  const longUnplayed =
    intent.longUnplayed * w.longUnplayed * oldMetric(stats.daysSinceLastPlayed, config);

  // §9.4 安全性: (−s) × w × (safety_score − 5)
  const safety = -intent.safety * w.safety * (safetyScore(song, stats) - 5);

  // §9.5 雰囲気: s × w × (energy_level − 3) / 2（null は中立 3 扱い）
  const mood = (intent.mood * w.mood * ((song.energyLevel ?? 3) - 3)) / 2;

  // §9.6 バラード: 該当曲に s × w
  const ballad = song.genres.includes("バラード") ? intent.ballad * w.ballad : 0;

  // §9.7 季節感: ON かつ一致 → +bonus（通年 ALL・null・不一致は 0。避ける方向なし）
  const seasonal =
    intent.seasonal && song.season !== null && song.season === input.currentSeason
      ? config.seasonalBonus
      : 0;

  // §9.8 リスナー向け: ON → (level − 3) × w（null は中立 3 扱い）
  const listener = intent.listener
    ? ((song.listenerLevel ?? 3) - 3) * config.listenerWeight
    : 0;

  return { rare, longUnplayed, safety, mood, ballad, seasonal, listener };
}

/** 意図由来プラス寄与合計（§10.4 低頻度ジャンル減点の免除判定に使う） */
function positiveIntentSum(c: IntentContributions): number {
  return Object.values(c).reduce((sum, v) => sum + Math.max(v, 0), 0);
}

/** 1曲のスコアを計算する（Stage 2–4。繰り返し減点は含まない） */
export function scoreSong(
  song: EngineSong,
  input: EngineInput,
  config: EngineConfig,
): number {
  const prev = input.previousPerformance;
  const { conditions, intent } = input;

  const contrib = intentContributions(song, input, config);
  let score =
    config.baseScore +
    contrib.rare +
    contrib.longUnplayed +
    contrib.safety +
    contrib.mood +
    contrib.ballad +
    contrib.seasonal +
    contrib.listener;

  // §10 ジャンル上書き: フィルタではなく強い加点（ユーザー確定）
  const overridden = conditions.genreOverride.filter((g) => song.genres.includes(g));
  if (overridden.length > 0) score += config.genreOverrideBonus;

  // ---- ルール減点（減点系 config は正値で保持し、減点として適用） ----

  // §12.2 直前曲と同じ黒本キー（null は「同じ」とみなさない）
  if (prev !== null && prev.songKey !== null && song.songKey !== null) {
    if (song.songKey === prev.songKey) {
      score -= config.sameKeyPenaltyOverrides[song.songKey] ?? config.sameKeyPenalty;
    }
  }

  // §12.3 直前曲と特殊ジャンル・特徴の重複（対象8種のみ。「循環」は対象外）。1種ごとに減点
  if (prev !== null) {
    for (const genre of SPECIAL_CONSECUTIVE_GENRES) {
      if (song.genres.includes(genre) && prev.genres.includes(genre)) {
        const rule =
          config.consecutiveGenre.overrides?.[genre] ?? config.consecutiveGenre.default;
        score -= rule.mode === "exclude" ? EXCLUDE_MODE_PENALTY : rule.value;
      }
    }
  }

  // §12.4 ブルース常時減点
  if (song.genres.includes("ブルース")) score -= config.bluesPenalty;

  // §12.6 直前曲と同じ作曲者（null 同士は「同じ」とみなさない）
  if (
    prev !== null &&
    prev.composer !== null &&
    song.composer !== null &&
    song.composer === prev.composer
  ) {
    score -= config.sameComposerPenalty;
  }

  // §12.7 累計コール回数 上位N曲（beginner=PRESENT または safety≤−1 で半減）
  if (input.topCalledSongIds.includes(song.id)) {
    const halved = conditions.beginner === "PRESENT" || intent.safety <= -1;
    score -= halved ? config.topCalledPenalty / 2 : config.topCalledPenalty;
  }

  // §10.3–10.4 低頻度ジャンル（自分のコール比率 < 閾値）。免除:
  //  - 意図由来プラス寄与合計 ≥ waiver（曲単位。「条件に十分合う場合だけ候補へ戻す」）
  //  - ジャンル上書きで指定されたジャンル
  //  - バラードは s ≥ +1 のとき（§9.6）
  const waivedByIntent = positiveIntentSum(contrib) >= config.lowFreqWaiverBonus;
  if (!waivedByIntent) {
    for (const genre of song.genres) {
      const ratio = input.genreCallRatios[genre];
      if (ratio === undefined || ratio >= config.lowFreqThreshold) continue;
      if (conditions.genreOverride.includes(genre)) continue;
      if (genre === "バラード" && intent.ballad >= 1) continue;
      score -= config.lowFreqPenalty;
    }
  }

  // §8.3 管楽器複数（horns=MULTI）の歌もの: 完全除外ではなく強い減点
  if (conditions.horns === "MULTI" && song.genres.includes("歌もの")) {
    score -= config.multiHornVocalPenalty;
  }

  // §12.5 直前曲のフロント編成に vo → 歌もの減点（フロント編成未入力時はスキップ）
  if (
    prev !== null &&
    prev.frontInstruments !== null &&
    prev.frontInstruments.includes("vo") &&
    song.genres.includes("歌もの")
  ) {
    score -= config.afterVocalVocalPenalty;
  }

  return score;
}
