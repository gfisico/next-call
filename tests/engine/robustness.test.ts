/**
 * 堅牢性の境界テスト:
 * - 属性未整備曲（needs_review・属性 NULL）で安全側処理・非クラッシュ
 * - 演奏記録0件（直前曲なし）で直前曲系ルールが一切発火しない
 * - 空入力で非クラッシュ
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterExcluded } from "@/engine/exclude";
import { recommend } from "@/engine/index";
import { generateReasons } from "@/engine/reasons";
import { scoreSong } from "@/engine/score";
import type { EngineSong } from "@/engine/types";
import {
  makeConfig,
  makeInput,
  makeIntent,
  makePrev,
  makeSong,
} from "./helpers";

const config = makeConfig();

/** needs_review 相当の属性未整備曲（NULL だらけ） */
function nullSong(id: number): EngineSong {
  return makeSong({
    id,
    songKey: null,
    form: null,
    composer: null,
    noChartOk: null,
    isStandard: null,
    simpleForm: null,
    inKurobon1: null,
    season: null,
    listenerLevel: null,
    energyLevel: null,
    needsReview: true,
    genres: [],
  });
}

describe("属性未整備曲（needs_review・NULL属性）の安全側処理", () => {
  it("中立意図では NULL 属性曲のスコアは base_score のまま（寄与はすべて中立 0）", () => {
    const song = nullSong(1);
    const input = makeInput({ songs: [song] });
    expect(scoreSong(song, input, config)).toBe(50);
  });

  it("listener ON でも listener_level=null は中立扱いで寄与 0（NaN にならない）", () => {
    const song = nullSong(1);
    const input = makeInput({ songs: [song], intent: makeIntent({ listener: true }) });
    const score = scoreSong(song, input, config);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(50);
  });

  it("mood スライダーでも energy_level=null は中立扱いで寄与 0", () => {
    const song = nullSong(1);
    const input = makeInput({ songs: [song], intent: makeIntent({ mood: 2 }) });
    expect(scoreSong(song, input, config)).toBe(50);
  });

  it("seasonal ON でも season=null は一致なし扱いで寄与 0", () => {
    const song = nullSong(1);
    const input = makeInput({ songs: [song], intent: makeIntent({ seasonal: true }) });
    expect(scoreSong(song, input, config)).toBe(50);
  });

  it("キー null 同士・作曲者 null 同士は「同じ」とみなさない（減点なし）", () => {
    const song = nullSong(1);
    const input = makeInput({
      songs: [song],
      previousPerformance: makePrev({ songKey: null, composer: null }),
    });
    expect(scoreSong(song, input, config)).toBe(50);
  });

  it("NULL 属性曲を含む入力でも recommend はクラッシュせず結果を返す", () => {
    const songs = [nullSong(1), nullSong(2), makeSong({ id: 3 })];
    const input = makeInput({
      songs,
      previousPerformance: makePrev(),
      conditions: { horns: "UNKNOWN", beginner: "UNKNOWN", kurobon1Only: false, genreOverride: [] },
      pendingSongIds: [1],
    });
    const result = recommend(input, config, 1);
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(Array.isArray(result.conditionalCandidates)).toBe(true);
    expect(Array.isArray(result.pendingSongs)).toBe(true);
    for (const c of result.candidates) {
      expect(Number.isFinite(c.score)).toBe(true);
    }
  });

  it("stats が欠落した曲でもクラッシュしない（安全側の既定値で処理）", () => {
    const song = makeSong({ id: 99 });
    const input = makeInput({ songs: [song] });
    delete input.stats[99];
    expect(() => recommend(input, config, 1)).not.toThrow();
  });
});

describe("演奏記録0件（直前曲なし = セッション1曲目）で直前曲系ルールが一切発火しない", () => {
  // 仮に直前曲が存在すれば全ルールが発火するはずの曲:
  // キーG・form AABA・作曲者一致・特殊ジャンル（ファンク・歌もの）・vo 後の歌もの
  const song = makeSong({
    id: 1,
    songKey: "G",
    form: "AABA",
    composer: "Same Composer",
    genres: ["ファンク", "歌もの"],
  });

  it("同キー・特殊ジャンル連続・同作曲者・§12.5 の減点がすべて 0（score = base）", () => {
    const input = makeInput({ songs: [song], previousPerformance: null });
    expect(scoreSong(song, input, config)).toBe(50);
  });

  it("対照実験: 同一の曲でも直前曲があれば減点される（テスト自体の妥当性確認）", () => {
    const input = makeInput({
      songs: [song],
      previousPerformance: makePrev({
        songKey: "G",
        form: "ABAC", // form は変え、除外ではなく減点系のみ発火させる
        composer: "Same Composer",
        genres: ["ファンク", "歌もの"],
        frontInstruments: ["vo"],
      }),
    });
    // −15(同キー) −30(ファンク+歌もの) −5(作曲者) −15(§12.5) = −65
    expect(scoreSong(song, input, config)).toBe(-15);
  });

  it("同 form 除外も発火しない（filterExcluded を通過する）", () => {
    const input = makeInput({ songs: [song], previousPerformance: null });
    expect(filterExcluded(input, config).map((s) => s.id)).toEqual([1]);
  });

  it("「直前曲と変わる」理由（CONTRAST_WITH_PREVIOUS）も発火しない", () => {
    const input = makeInput({ songs: [song], previousPerformance: null });
    const codes = generateReasons(song, input, config).map((r) => r.code);
    expect(codes).not.toContain("CONTRAST_WITH_PREVIOUS");
  });

  it("直前曲なしでも recommend はクラッシュせず候補を返す", () => {
    const songs = [makeSong({ id: 1 }), makeSong({ id: 2, form: "ABAC" })];
    const result = recommend(makeInput({ songs, previousPerformance: null }), config, 1);
    expect(result.candidates.length).toBeGreaterThan(0);
  });
});

describe("純関数性: Math.random / Date.now を直接使わない", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recommend は Math.random を呼ばない（乱数は seed 注入の決定的 PRNG）", () => {
    const spy = vi.spyOn(Math, "random");
    const songs = [makeSong({ id: 1 }), makeSong({ id: 2, form: "ABAC" })];
    recommend(makeInput({ songs }), config, 1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("recommend は Date.now を呼ばない（現在日時・季節は引数で受け取る）", () => {
    const spy = vi.spyOn(Date, "now");
    const songs = [makeSong({ id: 1 }), makeSong({ id: 2, form: "ABAC" })];
    recommend(makeInput({ songs }), config, 1);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("空・極小入力", () => {
  it("曲0件でもクラッシュせず、候補は空・isSparse=true", () => {
    const result = recommend(makeInput({ songs: [] }), config, 1);
    expect(result.candidates).toEqual([]);
    expect(result.isSparse).toBe(true);
  });

  it("全曲が完全除外されてもクラッシュせず、候補は空・isSparse=true", () => {
    const songs = [makeSong({ id: 1, hasPlayed: false }), makeSong({ id: 2, hasPlayed: false })];
    const result = recommend(makeInput({ songs }), config, 1);
    expect(result.candidates).toEqual([]);
    expect(result.isSparse).toBe(true);
  });
});
