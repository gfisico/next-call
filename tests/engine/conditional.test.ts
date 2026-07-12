/**
 * Stage 9: 条件別候補（§8/§15.2）
 * - horns/beginner が UNKNOWN のとき各2ブランチで再実行
 * - 各ブランチの最上位曲が通常候補と重複しない場合のみラベル付きで追加
 * - 両軸 UNKNOWN でも最大4ブランチ。組み合わせブランチは生成しない
 * - 分岐しない側の軸は UNKNOWN のまま（除外・減点なし）維持
 */
import { describe, expect, it } from "vitest";
import { generateConditionalCandidates } from "@/engine/conditional";
import { recommend } from "@/engine/index";
import type { ConditionalBranch } from "@/engine/types";
import { makeConfig, makeInput, makeIntent, makeSong, makeStats } from "./helpers";

// 歌もの減点を 25 に上げ、MULTI ブランチでスコア順位が決定的に入れ替わる構成にする
const config = makeConfig({ multiHornVocalPenalty: 25 });

// rare スライダー +2 で登場回数によりスコアを決定的に制御する:
//   appearanceCount 0 → 62 / 6 → 52.4 / 11 → 50
const rareIntent = makeIntent({ rare: 2 });

describe("§8.1/§15.2 horns=UNKNOWN の2ブランチ", () => {
  const vocal = makeSong({ id: 1, genres: ["歌もの"] }); // ONE: 62 / MULTI: 37
  const instrumental = makeSong({ id: 2, form: "ABAC" }); // 常に 50
  const baseInput = () =>
    makeInput({
      songs: [vocal, instrumental],
      stats: {
        1: makeStats({ appearanceCount: 0 }),
        2: makeStats({ appearanceCount: 11 }),
      },
      intent: rareIntent,
      conditions: { horns: "UNKNOWN", beginner: "NONE", kurobon1Only: false, genreOverride: [] },
    });

  it("MULTI ブランチの最上位曲が通常候補と異なるとき「複数管なら」ラベルで追加される", () => {
    const result = generateConditionalCandidates(baseInput(), config, 1, [1]);
    expect(result).toHaveLength(1);
    expect(result[0].branch).toBe("HORNS_MULTI");
    expect(result[0].songId).toBe(2);
    expect(result[0].label).toContain("複数管");
  });

  it("ブランチ最上位曲が通常候補と重複する場合は追加されない", () => {
    // 通常候補に両曲とも含まれている → ONE/MULTI どちらの最上位も重複 → 追加ゼロ
    const result = generateConditionalCandidates(baseInput(), config, 1, [1, 2]);
    expect(result).toEqual([]);
  });

  it("beginner=NONE（既知）なら BEGINNER_* ブランチは実行されない", () => {
    const branches = generateConditionalCandidates(baseInput(), config, 1, [1]).map(
      (c) => c.branch,
    );
    expect(branches).not.toContain("BEGINNER_NONE");
    expect(branches).not.toContain("BEGINNER_PRESENT");
  });
});

describe("§8.2/§15.2 beginner=UNKNOWN の2ブランチ", () => {
  const notBeginnerSafe = makeSong({ id: 1 }); // 62（PRESENT ブランチで除外）
  const beginnerSafe = makeSong({
    id: 2,
    form: "ABAC",
    isStandard: true,
    noChartOk: true,
    simpleForm: true,
  }); // 50
  const baseInput = () =>
    makeInput({
      songs: [notBeginnerSafe, beginnerSafe],
      stats: {
        1: makeStats({ appearanceCount: 0 }),
        2: makeStats({ appearanceCount: 11 }),
      },
      intent: rareIntent,
      conditions: { horns: "ONE", beginner: "UNKNOWN", kurobon1Only: false, genreOverride: [] },
    });

  it("PRESENT ブランチでは初心者AND条件を満たす曲だけが最上位になり「初心者」ラベルで追加される", () => {
    const result = generateConditionalCandidates(baseInput(), config, 1, [1]);
    expect(result).toHaveLength(1);
    expect(result[0].branch).toBe("BEGINNER_PRESENT");
    expect(result[0].songId).toBe(2);
    expect(result[0].label).toContain("初心者");
  });

  it("horns=ONE（既知）なら HORNS_* ブランチは実行されない", () => {
    const branches = generateConditionalCandidates(baseInput(), config, 1, [1]).map(
      (c) => c.branch,
    );
    expect(branches).not.toContain("HORNS_ONE");
    expect(branches).not.toContain("HORNS_MULTI");
  });
});

describe("両軸 UNKNOWN: 最大4ブランチ・組み合わせなし・分岐しない軸は UNKNOWN 維持", () => {
  // V: 歌もの・初心者不適合・62 → 通常候補
  // X: 器楽・初心者不適合・52.4 → MULTI ブランチ最上位（beginner 軸 UNKNOWN 維持の証明）
  // S: 器楽・初心者適合・50 → PRESENT ブランチ最上位
  // P: has_played=false（完全除外）→ どこにも出ない
  const V = makeSong({ id: 1, genres: ["歌もの"] });
  const X = makeSong({ id: 2, form: "ABAC" });
  const S = makeSong({
    id: 3,
    form: "BLUES12",
    isStandard: true,
    noChartOk: true,
    simpleForm: true,
  });
  const P = makeSong({ id: 4, hasPlayed: false });
  const bothUnknownInput = () =>
    makeInput({
      songs: [V, X, S, P],
      stats: {
        1: makeStats({ appearanceCount: 0 }),
        2: makeStats({ appearanceCount: 6 }),
        3: makeStats({ appearanceCount: 11 }),
        4: makeStats({ appearanceCount: 0 }),
      },
      intent: rareIntent,
      conditions: { horns: "UNKNOWN", beginner: "UNKNOWN", kurobon1Only: false, genreOverride: [] },
    });

  it("ブランチは 1管/複数管/初心者なし/初心者あり の4種のみで、組み合わせブランチは生成されない", () => {
    const result = generateConditionalCandidates(bothUnknownInput(), config, 1, [1]);
    const allowed: ConditionalBranch[] = [
      "HORNS_ONE",
      "HORNS_MULTI",
      "BEGINNER_NONE",
      "BEGINNER_PRESENT",
    ];
    expect(result.length).toBeLessThanOrEqual(4);
    for (const c of result) {
      expect(allowed).toContain(c.branch);
    }
  });

  it("重複しない最上位を持つブランチだけが追加される（HORNS_MULTI=X と BEGINNER_PRESENT=S）", () => {
    const result = generateConditionalCandidates(bothUnknownInput(), config, 1, [1]);
    expect(result.map((c) => [c.branch, c.songId]).sort()).toEqual([
      ["BEGINNER_PRESENT", 3],
      ["HORNS_MULTI", 2],
    ]);
  });

  it("HORNS_MULTI ブランチで初心者不適合の曲が最上位になれる = beginner 軸は UNKNOWN のまま（除外なし）", () => {
    const result = generateConditionalCandidates(bothUnknownInput(), config, 1, [1]);
    const multi = result.find((c) => c.branch === "HORNS_MULTI");
    expect(multi).toBeDefined();
    expect(multi!.songId).toBe(2); // X は is_standard=false → PRESENT なら除外される曲
  });

  it("BEGINNER_PRESENT ブランチで歌もの曲が減点されない = horns 軸は UNKNOWN のまま（減点なし）", () => {
    // 初心者適合の歌もの曲 SV(60) と 初心者適合の器楽曲 SI(52.4):
    // horns 軸が誤って MULTI に分岐すると SV は 35 となり SI が最上位になってしまう
    const SV = makeSong({
      id: 11,
      genres: ["歌もの"],
      isStandard: true,
      noChartOk: true,
      simpleForm: true,
    });
    const SI = makeSong({
      id: 12,
      form: "ABAC",
      isStandard: true,
      noChartOk: true,
      simpleForm: true,
    });
    const N = makeSong({ id: 13, form: "BLUES12" }); // 62 → 通常候補（初心者不適合）
    const input = makeInput({
      songs: [SV, SI, N],
      stats: {
        11: makeStats({ appearanceCount: 1 }), // 59.6
        12: makeStats({ appearanceCount: 6 }), // 52.4
        13: makeStats({ appearanceCount: 0 }), // 62
      },
      intent: rareIntent,
      conditions: { horns: "UNKNOWN", beginner: "UNKNOWN", kurobon1Only: false, genreOverride: [] },
    });
    const result = generateConditionalCandidates(input, config, 1, [13]);
    const present = result.find((c) => c.branch === "BEGINNER_PRESENT");
    expect(present).toBeDefined();
    expect(present!.songId).toBe(11); // 歌もの SV が減点されず最上位
  });

  it("完全除外曲はどのブランチにも現れない", () => {
    const result = generateConditionalCandidates(bothUnknownInput(), config, 1, [1]);
    expect(result.map((c) => c.songId)).not.toContain(4);
  });
});

describe("recommend 統合", () => {
  it("horns/beginner が両方既知なら conditionalCandidates は空", () => {
    const songs = [makeSong({ id: 1 }), makeSong({ id: 2, form: "ABAC" })];
    const result = recommend(
      makeInput({
        songs,
        conditions: { horns: "ONE", beginner: "NONE", kurobon1Only: false, genreOverride: [] },
      }),
      config,
      5,
    );
    expect(result.conditionalCandidates).toEqual([]);
  });

  it("条件別候補は通常候補と songId が重複しない", () => {
    const songs = Array.from({ length: 12 }, (_, i) =>
      makeSong({
        id: i + 1,
        genres: i % 3 === 0 ? ["歌もの"] : [],
        isStandard: i % 2 === 0,
        noChartOk: i % 2 === 0,
        simpleForm: i % 2 === 0,
      }),
    );
    const result = recommend(
      makeInput({
        songs,
        conditions: { horns: "UNKNOWN", beginner: "UNKNOWN", kurobon1Only: false, genreOverride: [] },
      }),
      config,
      5,
    );
    const normalIds = new Set(result.candidates.map((c) => c.songId));
    for (const c of result.conditionalCandidates) {
      expect(normalIds.has(c.songId)).toBe(false);
    }
  });
});
