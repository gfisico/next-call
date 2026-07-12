/**
 * Stage 8: 推薦理由生成（固定テンプレート。LLM 不使用）
 * - 発火したルール・事実から最大4件/曲
 * - 発火した理由が2件未満のときのみ、フォールバック（FALLBACK_*）で2件まで補完
 * - 発火していないルールの理由を捏造しない
 */
import { intentContributions, oldMetric, rareMetric } from "./score";
import { SPECIAL_CONSECUTIVE_GENRES } from "./types";
import type {
  EngineConfig,
  EngineInput,
  EngineSong,
  Reason,
  Season,
  SongStats,
} from "./types";

const MAX_REASONS = 4;
const MIN_REASONS = 2;

const FALLBACK_STATS: SongStats = {
  appearanceCount: 0,
  daysSinceLastPlayed: null,
  myPlayCount: 0,
  myCallCount: 0,
};

const SEASON_LABELS: Record<Season, string> = {
  SPRING: "春",
  SUMMER: "夏",
  AUTUMN: "秋",
  WINTER: "冬",
};

/** 「最終演奏から{n}年{m}ヶ月ぶり」の期間表現 */
function elapsedText(days: number): string {
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  if (years > 0 && months > 0) return `${years}年${months}ヶ月`;
  if (years > 0) return `${years}年`;
  return `${Math.max(months, 1)}ヶ月`;
}

/** 集計期間（appearance_window_days）の「直近{期間}」表現 */
function windowText(config: EngineConfig): string {
  const years = config.appearanceWindowDays / 365;
  return years >= 1 ? `${Math.round(years)}年` : `${config.appearanceWindowDays}日`;
}

export function generateReasons(
  song: EngineSong,
  input: EngineInput,
  config: EngineConfig,
): Reason[] {
  const stats = input.stats[song.id] ?? FALLBACK_STATS;
  const prev = input.previousPerformance;
  const { intent, conditions } = input;
  const contrib = intentContributions(song, input, config);

  const fired: Reason[] = [];

  // m_old ≥ 0.5（既定: 365日以上）→ 「最終演奏から…ぶり」
  if (oldMetric(stats.daysSinceLastPlayed, config) >= 0.5) {
    fired.push({
      code: "LONG_UNPLAYED",
      text:
        stats.daysSinceLastPlayed === null
          ? "自分の演奏記録がなく久しぶり以上の一曲"
          : `最終演奏から${elapsedText(stats.daysSinceLastPlayed)}ぶり`,
    });
  }

  // m_rare ≥ 0.8（登場2回以下）→ 「この店では登場…少なめ」
  if (rareMetric(stats.appearanceCount) >= 0.8) {
    fired.push({
      code: "RARE_AT_VENUE",
      text: `この店（区分）では直近${windowText(config)}の登場${stats.appearanceCount}回と少なめ`,
    });
  }

  // キー・構成・特殊ジャンルすべて直前曲と不一致（直前曲なしなら発火しない）
  if (prev !== null) {
    const keyDiffers =
      song.songKey === null || prev.songKey === null || song.songKey !== prev.songKey;
    const formDiffers =
      song.form === null || prev.form === null || song.form !== prev.form;
    const genreDiffers = !SPECIAL_CONSECUTIVE_GENRES.some(
      (g) => song.genres.includes(g) && prev.genres.includes(g),
    );
    if (keyDiffers && formDiffers && genreDiffers) {
      fired.push({
        code: "CONTRAST_WITH_PREVIOUS",
        text: "直前曲とキー・構成・雰囲気が変わる",
      });
    }
  }

  // mood 寄与 > 0
  if (contrib.mood > 0) {
    const strength = Math.abs(intent.mood) >= 2 ? "強く" : "やや";
    const direction = intent.mood > 0 ? "盛り上げる" : "落ち着かせる";
    fired.push({
      code: "MOOD_MATCH",
      text: `今回の『${strength}${direction}』に合う`,
    });
  }

  // listener ON かつ level ≥ 4
  if (intent.listener && (song.listenerLevel ?? 3) >= 4) {
    fired.push({ code: "LISTENER_FRIENDLY", text: "リスナーが楽しみやすい曲" });
  }

  // seasonal ON かつ季節一致
  if (contrib.seasonal > 0) {
    fired.push({
      code: "SEASON_MATCH",
      text: `いまの季節（${SEASON_LABELS[input.currentSeason]}）の曲`,
    });
  }

  // beginner=PRESENT（AND 条件を満たす曲のみ。除外通過曲は常に満たす）
  if (
    conditions.beginner === "PRESENT" &&
    song.isStandard === true &&
    song.noChartOk === true &&
    song.simpleForm === true
  ) {
    fired.push({
      code: "BEGINNER_FRIENDLY",
      text: "超定番・譜面なし対応可・構成が単純で初心者向き",
    });
  }

  // safety 寄与 > 0（左 = 安全 / 右 = 攻め）
  if (contrib.safety > 0) {
    if (intent.safety < 0) {
      fired.push({ code: "SAFETY_SAFE", text: "演奏経験・譜面なし対応ありで手堅い" });
    } else if (intent.safety > 0) {
      fired.push({ code: "SAFETY_CHALLENGE", text: "最近やっていない攻めの一手" });
    }
  }

  // ballad s ≥ +1 かつバラード該当
  if (intent.ballad >= 1 && song.genres.includes("バラード")) {
    fired.push({ code: "BALLAD_MATCH", text: "バラードをやりたい意向に合致" });
  }

  const reasons = fired.slice(0, MAX_REASONS);

  // 発火理由が2件未満のときのみ、常時生成可能な事実ベースのフォールバックで2件まで補完
  if (reasons.length < MIN_REASONS) {
    const fallbacks: Reason[] = [
      {
        code: "FALLBACK_KEY_FORM",
        text: `黒本キー${song.songKey ?? "未設定"}・${song.form ?? "未設定"}構成`,
      },
      {
        code: "FALLBACK_PLAY_COUNT",
        text: `この${windowText(config)}で${stats.appearanceCount}回演奏`,
      },
    ];
    for (const fallback of fallbacks) {
      if (reasons.length >= MIN_REASONS) break;
      reasons.push(fallback);
    }
  }

  return reasons;
}
