/**
 * Stage 8: 推薦理由生成（§15.1。固定テンプレート・LLM不使用）
 * - 各候補に最低2件・最大4件
 * - 発火していないルールの理由を捏造しない
 * - フォールバック（FALLBACK_*）は発火理由が2件未満のときのみ2件まで補完
 */
import { describe, expect, it } from "vitest";
import { recommend } from "@/engine/index";
import { generateReasons } from "@/engine/reasons";
import type { Reason, ReasonCode } from "@/engine/types";
import {
  makeConfig,
  makeInput,
  makeIntent,
  makePrev,
  makeSong,
  makeStats,
} from "./helpers";

const config = makeConfig();

const FIRED_CODES: ReasonCode[] = [
  "LONG_UNPLAYED",
  "RARE_AT_VENUE",
  "CONTRAST_WITH_PREVIOUS",
  "MOOD_MATCH",
  "LISTENER_FRIENDLY",
  "SEASON_MATCH",
  "BEGINNER_FRIENDLY",
  "SAFETY_SAFE",
  "SAFETY_CHALLENGE",
  "BALLAD_MATCH",
];

const codes = (reasons: Reason[]) => reasons.map((r) => r.code);
const fallbackCount = (reasons: Reason[]) =>
  reasons.filter((r) => r.code.startsWith("FALLBACK_")).length;

describe("§15.1 発火型テンプレート", () => {
  it("m_old ≥ 0.5（365日以上）で LONG_UNPLAYED 理由「…ぶり」が付く", () => {
    const song = makeSong({ id: 1 });
    const input = makeInput({
      songs: [song],
      stats: { 1: makeStats({ daysSinceLastPlayed: 800 }) },
    });
    const reasons = generateReasons(song, input, config);
    expect(codes(reasons)).toContain("LONG_UNPLAYED");
    expect(reasons.find((r) => r.code === "LONG_UNPLAYED")!.text).toMatch(/ぶり/);
  });

  it("m_rare ≥ 0.8（登場2回以下）で RARE_AT_VENUE 理由「登場…少なめ」が付く", () => {
    const song = makeSong({ id: 1 });
    const input = makeInput({
      songs: [song],
      stats: { 1: makeStats({ appearanceCount: 1 }) },
    });
    const reasons = generateReasons(song, input, config);
    expect(codes(reasons)).toContain("RARE_AT_VENUE");
    expect(reasons.find((r) => r.code === "RARE_AT_VENUE")!.text).toMatch(/登場/);
  });

  it("キー・構成・特殊ジャンルすべて直前曲と不一致なら CONTRAST_WITH_PREVIOUS が付く", () => {
    const song = makeSong({ id: 1, songKey: "C", form: "AABA", genres: [] });
    const input = makeInput({
      songs: [song],
      previousPerformance: makePrev({ songKey: "G", form: "ABAC", genres: ["ファンク"] }),
    });
    expect(codes(generateReasons(song, input, config))).toContain("CONTRAST_WITH_PREVIOUS");
  });

  it("直前曲とキーが一致する場合は CONTRAST_WITH_PREVIOUS は付かない", () => {
    const song = makeSong({ id: 1, songKey: "G" });
    const input = makeInput({
      songs: [song],
      previousPerformance: makePrev({ songKey: "G" }),
    });
    expect(codes(generateReasons(song, input, config))).not.toContain("CONTRAST_WITH_PREVIOUS");
  });

  it("直前 Performance がない（セッション1曲目）場合は CONTRAST_WITH_PREVIOUS は付かない", () => {
    const song = makeSong({ id: 1 });
    const input = makeInput({ songs: [song], previousPerformance: null });
    expect(codes(generateReasons(song, input, config))).not.toContain("CONTRAST_WITH_PREVIOUS");
  });

  it("mood 寄与 > 0 で MOOD_MATCH が付く", () => {
    const song = makeSong({ id: 1, energyLevel: 5 });
    const input = makeInput({ songs: [song], intent: makeIntent({ mood: 2 }) });
    expect(codes(generateReasons(song, input, config))).toContain("MOOD_MATCH");
  });

  it("listener ON かつ level ≥ 4 で LISTENER_FRIENDLY「リスナー…」が付く", () => {
    const song = makeSong({ id: 1, listenerLevel: 4 });
    const input = makeInput({ songs: [song], intent: makeIntent({ listener: true }) });
    const reasons = generateReasons(song, input, config);
    expect(codes(reasons)).toContain("LISTENER_FRIENDLY");
    expect(reasons.find((r) => r.code === "LISTENER_FRIENDLY")!.text).toMatch(/リスナー/);
  });

  it("seasonal ON かつ季節一致で SEASON_MATCH「…季節…」が付く", () => {
    const song = makeSong({ id: 1, season: "SUMMER" });
    const input = makeInput({
      songs: [song],
      currentSeason: "SUMMER",
      intent: makeIntent({ seasonal: true }),
    });
    const reasons = generateReasons(song, input, config);
    expect(codes(reasons)).toContain("SEASON_MATCH");
    expect(reasons.find((r) => r.code === "SEASON_MATCH")!.text).toMatch(/季節/);
  });

  it("beginner=PRESENT（通過曲）には BEGINNER_FRIENDLY「…初心者…」が付く", () => {
    const song = makeSong({ id: 1, isStandard: true, noChartOk: true, difficulty: 1 });
    const input = makeInput({
      songs: [song],
      conditions: { horns: "ONE", beginner: "PRESENT", kurobon1Only: false, genreOverride: [] },
    });
    const reasons = generateReasons(song, input, config);
    expect(codes(reasons)).toContain("BEGINNER_FRIENDLY");
    const beginnerText = reasons.find((r) => r.code === "BEGINNER_FRIENDLY")!.text;
    expect(beginnerText).toMatch(/初心者/);
    expect(beginnerText).not.toMatch(/構成/);
  });

  it("safety 左（s<0）で寄与 > 0 なら SAFETY_SAFE「…手堅い」が付く", () => {
    const song = makeSong({ id: 1, isStandard: true, noChartOk: true, difficulty: 1 });
    const input = makeInput({
      songs: [song],
      stats: { 1: makeStats({ myPlayCount: 5, myCallCount: 3 }) },
      intent: makeIntent({ safety: -2 }),
    });
    const reasons = generateReasons(song, input, config);
    expect(codes(reasons)).toContain("SAFETY_SAFE");
    expect(codes(reasons)).not.toContain("SAFETY_CHALLENGE");
  });

  it("safety 右（s>0）で寄与 > 0 なら SAFETY_CHALLENGE「…攻め…」が付く", () => {
    const song = makeSong({ id: 1 }); // safety_score=0 → 攻め側で寄与プラス
    const input = makeInput({ songs: [song], intent: makeIntent({ safety: 2 }) });
    const reasons = generateReasons(song, input, config);
    expect(codes(reasons)).toContain("SAFETY_CHALLENGE");
    expect(reasons.find((r) => r.code === "SAFETY_CHALLENGE")!.text).toMatch(/攻め/);
  });

  it("ballad s ≥ +1 かつバラード該当で BALLAD_MATCH「バラード…」が付く", () => {
    const song = makeSong({ id: 1, genres: ["バラード"] });
    const input = makeInput({ songs: [song], intent: makeIntent({ ballad: 1 }) });
    const reasons = generateReasons(song, input, config);
    expect(codes(reasons)).toContain("BALLAD_MATCH");
    expect(reasons.find((r) => r.code === "BALLAD_MATCH")!.text).toMatch(/バラード/);
  });
});

describe("発火していないルールの理由を捏造しない", () => {
  it("中立条件（スライダー全0・チェックOFF・直前曲なし・m_rare/m_old 低）では発火型理由が1件も付かない", () => {
    const song = makeSong({ id: 1 });
    const input = makeInput({
      songs: [song],
      stats: { 1: makeStats({ appearanceCount: 5, daysSinceLastPlayed: 100 }) },
    });
    const reasons = generateReasons(song, input, config);
    for (const code of codes(reasons)) {
      expect(FIRED_CODES).not.toContain(code);
    }
  });

  it("mood=0 では MOOD_MATCH が付かない / listener OFF では LISTENER_FRIENDLY が付かない", () => {
    const song = makeSong({ id: 1, energyLevel: 5, listenerLevel: 5 });
    const input = makeInput({ songs: [song] });
    const c = codes(generateReasons(song, input, config));
    expect(c).not.toContain("MOOD_MATCH");
    expect(c).not.toContain("LISTENER_FRIENDLY");
  });
});

describe("フォールバック補完（発火理由が2件未満のときのみ）", () => {
  it("発火理由 0 件なら常時生成可能なフォールバック2件で補完される", () => {
    const song = makeSong({ id: 1 });
    const input = makeInput({
      songs: [song],
      stats: { 1: makeStats({ appearanceCount: 5, daysSinceLastPlayed: 100 }) },
    });
    const reasons = generateReasons(song, input, config);
    expect(reasons).toHaveLength(2);
    expect(codes(reasons).sort()).toEqual(["FALLBACK_KEY_FORM", "FALLBACK_PLAY_COUNT"]);
  });

  it("発火理由 1 件ならフォールバック1件だけ足して合計2件にする", () => {
    const song = makeSong({ id: 1 });
    const input = makeInput({
      songs: [song],
      stats: { 1: makeStats({ appearanceCount: 1, daysSinceLastPlayed: 100 }) }, // RARE のみ発火
    });
    const reasons = generateReasons(song, input, config);
    expect(reasons).toHaveLength(2);
    expect(codes(reasons)).toContain("RARE_AT_VENUE");
    expect(fallbackCount(reasons)).toBe(1);
  });

  it("発火理由が2件以上あればフォールバックは付かない", () => {
    const song = makeSong({ id: 1 });
    const input = makeInput({
      songs: [song],
      stats: { 1: makeStats({ appearanceCount: 0, daysSinceLastPlayed: 800 }) }, // RARE + LONG_UNPLAYED
    });
    const reasons = generateReasons(song, input, config);
    expect(fallbackCount(reasons)).toBe(0);
    expect(codes(reasons)).toContain("RARE_AT_VENUE");
    expect(codes(reasons)).toContain("LONG_UNPLAYED");
  });
});

describe("件数の上限・下限", () => {
  it("理由は最大4件/曲（トリガーが5件以上発火しても4件に絞る）", () => {
    const song = makeSong({
      id: 1,
      season: "SUMMER",
      energyLevel: 5,
      listenerLevel: 5,
      isStandard: true,
      noChartOk: true,
      difficulty: 1,
    });
    const input = makeInput({
      songs: [song],
      stats: { 1: makeStats({ appearanceCount: 0, daysSinceLastPlayed: 800 }) },
      previousPerformance: makePrev({ songKey: "G", form: "ABAC", genres: ["ファンク"] }),
      currentSeason: "SUMMER",
      intent: makeIntent({ mood: 2, seasonal: true, listener: true }),
    });
    const reasons = generateReasons(song, input, config);
    expect(reasons).toHaveLength(4);
    expect(fallbackCount(reasons)).toBe(0);
  });

  it("recommend の各候補には理由が2件以上4件以下付く", () => {
    const songs = Array.from({ length: 10 }, (_, i) =>
      makeSong({ id: i + 1, form: i % 2 === 0 ? "AABA" : "ABAC" }),
    );
    const result = recommend(makeInput({ songs }), config, 9);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.reasons.length).toBeGreaterThanOrEqual(2);
      expect(candidate.reasons.length).toBeLessThanOrEqual(4);
    }
  });
});
