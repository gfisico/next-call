/**
 * Stage 1: 完全除外（§12.1）の境界テスト
 * 5条件それぞれに「除外される/されない」の両側 + 属性未整備の安全側処理 +
 * 除外曲が候補・条件別候補に一切現れないこと（recommend 統合）。
 */
import { describe, expect, it } from "vitest";
import { filterExcluded } from "@/engine/exclude";
import { recommend } from "@/engine/index";
import { makeConfig, makeInput, makePrev, makeSong } from "./helpers";

const config = makeConfig();

function passedIds(input: ReturnType<typeof makeInput>): number[] {
  return filterExcluded(input, config).map((s) => s.id);
}

describe("§12.1 完全除外: has_played", () => {
  it("has_played=false の曲は除外される（コール可能曲でない §6）", () => {
    const input = makeInput({ songs: [makeSong({ id: 1, hasPlayed: false })] });
    expect(passedIds(input)).toEqual([]);
  });

  it("has_played=true の曲は除外されない", () => {
    const input = makeInput({ songs: [makeSong({ id: 1, hasPlayed: true })] });
    expect(passedIds(input)).toEqual([1]);
  });
});

describe("§12.1 完全除外: 当日演奏済み", () => {
  it("当日すでに演奏済みの曲は除外される", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1 }), makeSong({ id: 2 })],
      playedTodaySongIds: [1],
    });
    expect(passedIds(input)).toEqual([2]);
  });

  it("当日未演奏の曲は除外されない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1 })],
      playedTodaySongIds: [],
    });
    expect(passedIds(input)).toEqual([1]);
  });
});

describe("§12.1 完全除外: 直前の曲と form が同じ", () => {
  it("直前曲と同じ form の曲は除外される", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, form: "AABA" })],
      previousPerformance: makePrev({ form: "AABA" }),
    });
    expect(passedIds(input)).toEqual([]);
  });

  it("直前曲と異なる form の曲は除外されない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, form: "AABA" })],
      previousPerformance: makePrev({ form: "ABAC" }),
    });
    expect(passedIds(input)).toEqual([1]);
  });

  it("直前 Performance が存在しない（セッション1曲目）場合は同 form でも除外されない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, form: "AABA" })],
      previousPerformance: null,
    });
    expect(passedIds(input)).toEqual([1]);
  });

  it("曲の form が null（needs_review）なら評価不能 → 安全側で除外しない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, form: null, needsReview: true })],
      previousPerformance: makePrev({ form: "AABA" }),
    });
    expect(passedIds(input)).toEqual([1]);
  });

  it("直前曲の form が null なら評価不能 → 除外しない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, form: "AABA" })],
      previousPerformance: makePrev({ form: null }),
    });
    expect(passedIds(input)).toEqual([1]);
  });
});

describe("§8.2/§12.1 完全除外: 初心者対応（beginner=PRESENT は difficulty≤2 のみ通過）", () => {
  const safe = {
    difficulty: 1,
  } as const;

  it("difficulty≤2（低難易度）の曲は除外されない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, ...safe })],
      conditions: { horns: "ONE", beginner: "PRESENT", kurobon1Only: false, genreOverride: [] },
    });
    expect(passedIds(input)).toEqual([1]);
  });

  it.each([
    ["difficulty=3", 3],
    ["difficulty=5", 5],
    ["difficulty=null（未設定）", null],
  ])("難易度が高い/未設定の曲（%s）は除外される", (_label, difficulty) => {
    const input = makeInput({
      songs: [makeSong({ id: 1, difficulty })],
      conditions: { horns: "ONE", beginner: "PRESENT", kurobon1Only: false, genreOverride: [] },
    });
    expect(passedIds(input)).toEqual([]);
  });

  it("difficulty=null（needs_review）の曲は評価不能 → 除外される（安全側）", () => {
    const input = makeInput({
      songs: [
        makeSong({
          id: 1,
          difficulty: null,
          needsReview: true,
        }),
      ],
      conditions: { horns: "ONE", beginner: "PRESENT", kurobon1Only: false, genreOverride: [] },
    });
    expect(passedIds(input)).toEqual([]);
  });

  it("beginner=NONE なら難易度が高い/未設定の曲も除外されない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, difficulty: null })],
      conditions: { horns: "ONE", beginner: "NONE", kurobon1Only: false, genreOverride: [] },
    });
    expect(passedIds(input)).toEqual([1]);
  });

  it("beginner=UNKNOWN の通常候補では初心者除外を適用しない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, difficulty: null })],
      conditions: { horns: "UNKNOWN", beginner: "UNKNOWN", kurobon1Only: false, genreOverride: [] },
    });
    expect(passedIds(input)).toEqual([1]);
  });
});

describe("§11/§12.1 完全除外: kurobon1_only", () => {
  it("kurobon1_only=true かつ in_kurobon1=false の曲は除外される", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, inKurobon1: false })],
      conditions: { horns: "ONE", beginner: "NONE", kurobon1Only: true, genreOverride: [] },
    });
    expect(passedIds(input)).toEqual([]);
  });

  it("kurobon1_only=true かつ in_kurobon1=true の曲は除外されない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, inKurobon1: true })],
      conditions: { horns: "ONE", beginner: "NONE", kurobon1Only: true, genreOverride: [] },
    });
    expect(passedIds(input)).toEqual([1]);
  });

  it("kurobon1_only=false なら非掲載曲も除外されない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, inKurobon1: false })],
      conditions: { horns: "ONE", beginner: "NONE", kurobon1Only: false, genreOverride: [] },
    });
    expect(passedIds(input)).toEqual([1]);
  });

  it("in_kurobon1 が null なら評価不能 → 安全側で除外しない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, inKurobon1: null, needsReview: true })],
      conditions: { horns: "ONE", beginner: "NONE", kurobon1Only: true, genreOverride: [] },
    });
    expect(passedIds(input)).toEqual([1]);
  });
});

describe("完全除外曲は候補・条件別候補に一切現れない（recommend 統合）", () => {
  it("除外曲（当日演奏済み・has_played=false）は candidates にも conditionalCandidates にも出ない", () => {
    // horns/beginner 両軸 UNKNOWN → 条件別ブランチも実行される状況で検証
    const songs = [
      makeSong({ id: 1 }), // 当日演奏済み → 除外
      makeSong({ id: 2, hasPlayed: false }), // コール可能でない → 除外
      makeSong({ id: 3 }),
      makeSong({ id: 4, form: "ABAC" }),
      makeSong({ id: 5, form: "BLUES12" }),
    ];
    const input = makeInput({
      songs,
      playedTodaySongIds: [1],
      conditions: { horns: "UNKNOWN", beginner: "UNKNOWN", kurobon1Only: false, genreOverride: [] },
    });
    const result = recommend(input, config, 42);
    const allIds = [
      ...result.candidates.map((c) => c.songId),
      ...result.conditionalCandidates.map((c) => c.songId),
    ];
    expect(allIds).not.toContain(1);
    expect(allIds).not.toContain(2);
  });
});
