/**
 * Task 3（unit-04）: 設定→EngineConfig マッパー + 季節判定の単体テスト
 * - SETTING_SEEDS をマップすると tests/engine/helpers.ts の makeConfig() と deepEqual（ピン留め）
 * - 欠損キー・欠損サブキー・旧形状はすべて既定値へフォールバック
 * - 季節境界（3月・2月・12月）と season_months カスタム区切り
 */
import { describe, expect, it } from "vitest";
import { SETTING_SEEDS } from "@/db/seed";
import {
  buildEngineConfig,
  getFirstSongSeasonalDefault,
  getPendingAutoReleaseOnCall,
  getRepeatReadParams,
} from "@/server/recommendation/config";
import { seasonForDate } from "@/server/recommendation/season";
import { makeConfig } from "../engine/helpers";

describe("buildEngineConfig", () => {
  it("SETTING_SEEDS のマップ結果が makeConfig()（Provisional Values）と一致する", () => {
    expect(buildEngineConfig({ ...SETTING_SEEDS })).toEqual(makeConfig());
  });

  it("空の設定でも全キー既定値（makeConfig と同値）にフォールバックする", () => {
    expect(buildEngineConfig({})).toEqual(makeConfig());
  });

  it("サブキー欠損（slider_weights.ballad なし等）は当該サブキーのみ既定値", () => {
    const config = buildEngineConfig({
      "engine.slider_weights": { rare: 9 },
      "engine.repeat_penalties": { last_request: 20 },
    });
    expect(config.sliderWeights).toEqual({
      rare: 9,
      longUnplayed: 6,
      safety: 1.2,
      mood: 6,
      ballad: 8,
    });
    expect(config.repeatPenalties).toEqual({
      lastRequest: 20,
      recentRequests: 6,
      sameSignature: 6,
      genreRepeat: 3,
    });
  });

  it("設定値が反映される（ネスト形状 recent.penalty / same_condition.penalty）", () => {
    const config = buildEngineConfig({
      "engine.base_score": 60,
      "engine.repeat_penalties": {
        last_request: 10,
        recent: { count: 3, penalty: 4 },
        same_condition: { min_times: 3, penalty: 5 },
      },
      "engine.consecutive_genre": {
        default: { mode: "penalty", value: 15 },
        overrides: { バラード: { mode: "exclude", value: 0 } },
      },
    });
    expect(config.baseScore).toBe(60);
    expect(config.repeatPenalties.recentRequests).toBe(4);
    expect(config.repeatPenalties.sameSignature).toBe(5);
    expect(config.consecutiveGenre.overrides).toEqual({
      バラード: { mode: "exclude", value: 0 },
    });
  });

  it("型不正（文字列など）は既定値へフォールバックする", () => {
    const config = buildEngineConfig({
      "engine.base_score": "50",
      "engine.slider_weights": "broken",
      "engine.same_key_penalty_overrides": { F: "8", Bb: 8 },
    });
    expect(config.baseScore).toBe(50);
    expect(config.sliderWeights).toEqual(makeConfig().sliderWeights);
    expect(config.sameKeyPenaltyOverrides).toEqual({ Bb: 8 });
  });
});

describe("getRepeatReadParams", () => {
  it("SETTING_SEEDS から recent.count=5 / windowDays=30 を取り出す", () => {
    expect(getRepeatReadParams({ ...SETTING_SEEDS })).toEqual({
      recentCount: 5,
      windowDays: 30,
    });
  });

  it("欠損時は既定値（5, 30）", () => {
    expect(getRepeatReadParams({})).toEqual({ recentCount: 5, windowDays: 30 });
  });
});

describe("設定フラグヘルパ", () => {
  it("first_song_seasonal_default / pending.auto_release_on_call は既定 true", () => {
    expect(getFirstSongSeasonalDefault({})).toBe(true);
    expect(getPendingAutoReleaseOnCall({})).toBe(true);
    expect(
      getFirstSongSeasonalDefault({ "engine.first_song_seasonal_default": false }),
    ).toBe(false);
    expect(
      getPendingAutoReleaseOnCall({ "pending.auto_release_on_call": false }),
    ).toBe(false);
  });
});

describe("seasonForDate", () => {
  const months = SETTING_SEEDS["engine.season_months"];

  it("季節境界: 3月=SPRING / 2月=WINTER / 12月=WINTER / 6月=SUMMER / 11月=AUTUMN", () => {
    expect(seasonForDate("2026-03-01", months)).toBe("SPRING");
    expect(seasonForDate("2026-02-28", months)).toBe("WINTER");
    expect(seasonForDate("2026-12-31", months)).toBe("WINTER");
    expect(seasonForDate("2026-06-01", months)).toBe("SUMMER");
    expect(seasonForDate("2026-11-30", months)).toBe("AUTUMN");
  });

  it("season_months が欠損・不正なら既定の区切りで判定する", () => {
    expect(seasonForDate("2026-07-12", undefined)).toBe("SUMMER");
    expect(seasonForDate("2026-07-12", { SPRING: [13] })).toBe("SUMMER");
    expect(seasonForDate("2026-07-12", "broken")).toBe("SUMMER");
  });

  it("カスタム区切り（12ヶ月網羅）が使われる", () => {
    const custom = {
      SPRING: [2, 3, 4],
      SUMMER: [5, 6, 7],
      AUTUMN: [8, 9, 10],
      WINTER: [11, 12, 1],
    };
    expect(seasonForDate("2026-02-01", custom)).toBe("SPRING");
    expect(seasonForDate("2026-11-01", custom)).toBe("WINTER");
  });

  it("不正な日付は例外", () => {
    expect(() => seasonForDate("2026/07/12", months)).toThrow();
    expect(() => seasonForDate("2026-13-01", months)).toThrow();
  });
});
