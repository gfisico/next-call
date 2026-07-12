/**
 * Stage 2–4: スコアリングの寄与別単体テスト
 * 寄与式・係数は discovery.md「Stage 4: スコアリング」「Provisional Values」に厳密準拠。
 * score = BASE(50) + Σスライダー寄与 + Σチェック寄与 + ジャンル上書き加点 − Σルール減点
 */
import { describe, expect, it } from "vitest";
import { scoreSong } from "@/engine/score";
import { SPECIAL_CONSECUTIVE_GENRES } from "@/engine/types";
import type { EngineInput, EngineSong } from "@/engine/types";
import {
  makeConfig,
  makeConditions,
  makeInput,
  makeIntent,
  makePrev,
  makeSong,
  makeStats,
} from "./helpers";

const config = makeConfig();

/** song を input.songs/stats に登録して scoreSong を呼ぶ */
function score(
  song: EngineSong,
  inputOverrides: Partial<EngineInput> = {},
  cfg = config,
): number {
  const input = makeInput({ songs: [song], ...inputOverrides });
  return scoreSong(song, input, cfg);
}

describe("基礎点", () => {
  it("中立な曲・中立な意図では score = BASE(50) ちょうど", () => {
    expect(score(makeSong({ id: 1 }))).toBe(50);
  });

  it("engine.base_score は config 経由（40 に変えると 40 になる）", () => {
    expect(score(makeSong({ id: 1 }), {}, makeConfig({ baseScore: 40 }))).toBe(40);
  });
});

describe("§9.2 スライダー: 珍しい曲（s × 6 × m_rare）", () => {
  const rareCase = (s: number, a: number) =>
    score(makeSong({ id: 1 }), {
      stats: { 1: makeStats({ appearanceCount: a }) },
      intent: makeIntent({ rare: s }),
    });

  it("s=+2, 登場0回（m_rare=1.0）→ +12", () => {
    expect(rareCase(2, 0)).toBe(62);
  });

  it("s=+2, 登場1回（m_rare=0.8）→ +9.6", () => {
    expect(rareCase(2, 1)).toBeCloseTo(59.6, 5);
  });

  it("s=+2, 登場2回（境界: 1–2 は m_rare=0.8）→ +9.6", () => {
    expect(rareCase(2, 2)).toBeCloseTo(59.6, 5);
  });

  it("s=+2, 登場3回（境界: 3–5 は m_rare=0.5）→ +6", () => {
    expect(rareCase(2, 3)).toBe(56);
  });

  it("s=+2, 登場5回→+6 / 登場6回（境界: 6–10 は m_rare=0.2）→ +2.4", () => {
    expect(rareCase(2, 5)).toBe(56);
    expect(rareCase(2, 6)).toBeCloseTo(52.4, 5);
  });

  it("s=+2, 登場10回→+2.4 / 登場11回（境界: 11+ は m_rare=0.0）→ 0", () => {
    expect(rareCase(2, 10)).toBeCloseTo(52.4, 5);
    expect(rareCase(2, 11)).toBe(50);
  });

  it("s=−2, 登場0回 → −12（マイナス方向も対称）", () => {
    expect(rareCase(-2, 0)).toBe(38);
  });

  it("s=0 なら登場回数によらず寄与 0", () => {
    expect(rareCase(0, 0)).toBe(50);
  });
});

describe("§9.3 スライダー: 久しぶり（s × 6 × m_old, m_old = min(日数/730, 1)）", () => {
  const oldCase = (s: number, days: number | null) =>
    score(makeSong({ id: 1 }), {
      stats: { 1: makeStats({ daysSinceLastPlayed: days }) },
      intent: makeIntent({ longUnplayed: s }),
    });

  it("s=+2, 730日 → m_old=1.0 → +12", () => {
    expect(oldCase(2, 730)).toBe(62);
  });

  it("s=+2, 365日 → m_old=0.5 → +6", () => {
    expect(oldCase(2, 365)).toBe(56);
  });

  it("s=+2, 1460日 → m_old は 1.0 で飽和 → +12", () => {
    expect(oldCase(2, 1460)).toBe(62);
  });

  it("s=+2, 未演奏（has_played=true だが履歴なし = null）→ m_old=1.0 → +12", () => {
    expect(oldCase(2, null)).toBe(62);
  });

  it("s=−2, 730日 → −12", () => {
    expect(oldCase(-2, 730)).toBe(38);
  });
});

describe("§9.4 スライダー: 安全性（(−s) × 1.2 × (safety_score − 5)）", () => {
  const safest = makeSong({
    id: 1,
    isStandard: true,
    noChartOk: true,
    simpleForm: true,
  });
  const safestStats = makeStats({ myPlayCount: 5, myCallCount: 3 });
  const riskiest = makeSong({ id: 1 }); // 全フラグ false
  const riskiestStats = makeStats({ myPlayCount: 0, myCallCount: 0 });

  it("s=−2（安全側）× safety_score=10 → +12", () => {
    // safety_score = 2+3+2 + 5×0.4 + 3×(1/3) = 10
    expect(
      score(safest, { stats: { 1: safestStats }, intent: makeIntent({ safety: -2 }) }),
    ).toBeCloseTo(62, 5);
  });

  it("s=−2（安全側）× safety_score=0 → −12", () => {
    expect(
      score(riskiest, { stats: { 1: riskiestStats }, intent: makeIntent({ safety: -2 }) }),
    ).toBeCloseTo(38, 5);
  });

  it("s=+2（攻め側）× safety_score=0 → +12（未知曲に最大加点）", () => {
    expect(
      score(riskiest, { stats: { 1: riskiestStats }, intent: makeIntent({ safety: 2 }) }),
    ).toBeCloseTo(62, 5);
  });

  it("s=+2（攻め側）× safety_score=10 → −12", () => {
    expect(
      score(safest, { stats: { 1: safestStats }, intent: makeIntent({ safety: 2 }) }),
    ).toBeCloseTo(38, 5);
  });

  it("中間値: s=−1, 演奏2回・コール1回 → safety_score=1.1333 → 寄与 −4.64", () => {
    // safety_score = 0 + min(2,5)×0.4 + min(1,3)×(1/3) = 1.13333…
    // 寄与 = (−(−1)) × 1.2 × (1.13333 − 5) = −4.64
    expect(
      score(riskiest, {
        stats: { 1: makeStats({ myPlayCount: 2, myCallCount: 1 }) },
        intent: makeIntent({ safety: -1 }),
      }),
    ).toBeCloseTo(45.36, 2);
  });

  it("演奏回数・コール回数の寄与は min(5)・min(3) で飽和する", () => {
    const a = score(riskiest, {
      stats: { 1: makeStats({ myPlayCount: 5, myCallCount: 3 }) },
      intent: makeIntent({ safety: -2 }),
    });
    const b = score(riskiest, {
      stats: { 1: makeStats({ myPlayCount: 50, myCallCount: 30 }) },
      intent: makeIntent({ safety: -2 }),
    });
    expect(a).toBeCloseTo(b, 5);
  });
});

describe("§9.5 スライダー: 雰囲気（s × 6 × (energy_level − 3) / 2）", () => {
  const moodCase = (s: number, energy: number) =>
    score(makeSong({ id: 1, energyLevel: energy }), { intent: makeIntent({ mood: s }) });

  it("s=+2, energy=5 → +12", () => {
    expect(moodCase(2, 5)).toBe(62);
  });

  it("s=+2, energy=1 → −12", () => {
    expect(moodCase(2, 1)).toBe(38);
  });

  it("s=−2, energy=5 → −12", () => {
    expect(moodCase(-2, 5)).toBe(38);
  });

  it("s=+1, energy=4 → +3", () => {
    expect(moodCase(1, 4)).toBe(53);
  });

  it("energy=3（中立）なら寄与 0", () => {
    expect(moodCase(2, 3)).toBe(50);
  });

  it("§9.5 ファンク自動優先はしない: 同じ energy_level ならファンク属性の有無でスコアが変わらない", () => {
    const funk = makeSong({ id: 1, energyLevel: 5, genres: ["ファンク"] });
    const plain = makeSong({ id: 2, energyLevel: 5, genres: [] });
    const input = makeInput({ songs: [funk, plain], intent: makeIntent({ mood: 2 }) });
    expect(scoreSong(funk, input, config)).toBe(scoreSong(plain, input, config));
  });
});

describe("§9.6 スライダー: バラード（該当曲に s × 8）", () => {
  it("s=+2, バラード属性あり → +16", () => {
    expect(
      score(makeSong({ id: 1, genres: ["バラード"] }), { intent: makeIntent({ ballad: 2 }) }),
    ).toBe(66);
  });

  it("s=+2 でもバラード属性なしなら寄与 0", () => {
    expect(score(makeSong({ id: 1 }), { intent: makeIntent({ ballad: 2 }) })).toBe(50);
  });

  it("s=−2, バラード属性あり → −16", () => {
    expect(
      score(makeSong({ id: 1, genres: ["バラード"] }), { intent: makeIntent({ ballad: -2 }) }),
    ).toBe(34);
  });

  it("s≥+1 のときバラードの低頻度ジャンル減点は免除される", () => {
    const song = makeSong({ id: 1, genres: ["バラード"] });
    const ratios = { バラード: 0.01 }; // < 5% → 通常なら −8
    expect(
      score(song, { genreCallRatios: ratios, intent: makeIntent({ ballad: 1 }) }),
    ).toBe(58); // 50 + 8（低頻度減点なし）
  });

  it("s=0 なら低頻度バラードに通常どおり −8 が適用される", () => {
    const song = makeSong({ id: 1, genres: ["バラード"] });
    expect(score(song, { genreCallRatios: { バラード: 0.01 } })).toBe(42);
  });
});

describe("§9.7 チェック: 季節感（一致 +10・避ける方向なし）", () => {
  it("ON かつ曲の season == 現在の季節 → +10", () => {
    expect(
      score(makeSong({ id: 1, season: "SUMMER" }), {
        currentSeason: "SUMMER",
        intent: makeIntent({ seasonal: true }),
      }),
    ).toBe(60);
  });

  it("ON でも通年（ALL）は 0", () => {
    expect(
      score(makeSong({ id: 1, season: "ALL" }), {
        currentSeason: "SUMMER",
        intent: makeIntent({ seasonal: true }),
      }),
    ).toBe(50);
  });

  it("ON でも季節不一致は 0（マイナスにはしない）", () => {
    expect(
      score(makeSong({ id: 1, season: "WINTER" }), {
        currentSeason: "SUMMER",
        intent: makeIntent({ seasonal: true }),
      }),
    ).toBe(50);
  });

  it("OFF なら一致しても 0", () => {
    expect(
      score(makeSong({ id: 1, season: "SUMMER" }), {
        currentSeason: "SUMMER",
        intent: makeIntent({ seasonal: false }),
      }),
    ).toBe(50);
  });
});

describe("§9.8 チェック: リスナー向け（(listener_level − 3) × 4）", () => {
  it("ON, level=5 → +8", () => {
    expect(
      score(makeSong({ id: 1, listenerLevel: 5 }), { intent: makeIntent({ listener: true }) }),
    ).toBe(58);
  });

  it("ON, level=1 → −8", () => {
    expect(
      score(makeSong({ id: 1, listenerLevel: 1 }), { intent: makeIntent({ listener: true }) }),
    ).toBe(42);
  });

  it("ON, level=3 → 0", () => {
    expect(
      score(makeSong({ id: 1, listenerLevel: 3 }), { intent: makeIntent({ listener: true }) }),
    ).toBe(50);
  });

  it("OFF なら level=5 でも 0", () => {
    expect(
      score(makeSong({ id: 1, listenerLevel: 5 }), { intent: makeIntent({ listener: false }) }),
    ).toBe(50);
  });
});

describe("§12.2 減点: 直前曲と同じ黒本キー", () => {
  it("同キー（G）→ −15", () => {
    expect(
      score(makeSong({ id: 1, songKey: "G" }), {
        previousPerformance: makePrev({ songKey: "G" }),
      }),
    ).toBe(35);
  });

  it("F は曲数が多いため −8 に緩和", () => {
    expect(
      score(makeSong({ id: 1, songKey: "F" }), {
        previousPerformance: makePrev({ songKey: "F" }),
      }),
    ).toBe(42);
  });

  it("B♭ も −8 に緩和", () => {
    expect(
      score(makeSong({ id: 1, songKey: "Bb" }), {
        previousPerformance: makePrev({ songKey: "Bb" }),
      }),
    ).toBe(42);
  });

  it("キーが異なれば減点なし", () => {
    expect(
      score(makeSong({ id: 1, songKey: "C" }), {
        previousPerformance: makePrev({ songKey: "G" }),
      }),
    ).toBe(50);
  });

  it("engine.same_key_penalty は config 経由（20 に変えると −20）", () => {
    expect(
      score(
        makeSong({ id: 1, songKey: "G" }),
        { previousPerformance: makePrev({ songKey: "G" }) },
        makeConfig({ sameKeyPenalty: 20 }),
      ),
    ).toBe(30);
  });
});

describe("§12.3 減点: 直前曲と特殊ジャンル・特徴の重複（対象は8種のみ）", () => {
  it.each(SPECIAL_CONSECUTIVE_GENRES.map((g) => [g]))(
    "§12.3 特殊ジャンル「%s」が直前曲と重複 → −15/種",
    (genre) => {
      const bluesExtra = genre === "ブルース" ? 10 : 0; // §12.4 常時減点が別途乗る
      expect(
        score(makeSong({ id: 1, genres: [genre] }), {
          previousPerformance: makePrev({ genres: [genre] }),
        }),
      ).toBe(50 - 15 - bluesExtra);
    },
  );

  it("§12.3 「循環」は連続回避の対象外（8種に含まれない）→ 重複しても減点なし", () => {
    expect(
      score(makeSong({ id: 1, genres: ["循環"] }), {
        previousPerformance: makePrev({ genres: ["循環"] }),
      }),
    ).toBe(50);
  });

  it("2種重複（ファンク+3拍子）→ 1種ごとに −15 で合計 −30", () => {
    expect(
      score(makeSong({ id: 1, genres: ["ファンク", "3拍子"] }), {
        previousPerformance: makePrev({ genres: ["ファンク", "3拍子"] }),
      }),
    ).toBe(20);
  });

  it("直前曲と重複しないジャンルなら減点なし", () => {
    expect(
      score(makeSong({ id: 1, genres: ["歌もの"] }), {
        previousPerformance: makePrev({ genres: ["ファンク"] }),
      }),
    ).toBe(50);
  });

  it("engine.consecutive_genre は config 経由（値 20 → −20）", () => {
    expect(
      score(
        makeSong({ id: 1, genres: ["ファンク"] }),
        { previousPerformance: makePrev({ genres: ["ファンク"] }) },
        makeConfig({ consecutiveGenre: { default: { mode: "penalty", value: 20 } } }),
      ),
    ).toBe(30);
  });
});

describe("§12.4 減点: ブルース常時減点", () => {
  it("ブルース属性の曲は直前曲によらず常に −10", () => {
    expect(score(makeSong({ id: 1, genres: ["ブルース"] }))).toBe(40);
  });

  it("engine.blues_penalty は config 経由（3 → −3）", () => {
    expect(
      score(makeSong({ id: 1, genres: ["ブルース"] }), {}, makeConfig({ bluesPenalty: 3 })),
    ).toBe(47);
  });
});

describe("§12.6 減点: 直前曲と同じ作曲者", () => {
  it("同一作曲者 → −5（やや減点。除外しない）", () => {
    expect(
      score(makeSong({ id: 1, composer: "Thelonious Monk" }), {
        previousPerformance: makePrev({ composer: "Thelonious Monk" }),
      }),
    ).toBe(45);
  });

  it("作曲者が異なれば減点なし", () => {
    expect(
      score(makeSong({ id: 1, composer: "Thelonious Monk" }), {
        previousPerformance: makePrev({ composer: "Duke Ellington" }),
      }),
    ).toBe(50);
  });

  it("双方 null（作曲者未設定同士）は「同じ」とみなさない → 減点なし", () => {
    expect(
      score(makeSong({ id: 1, composer: null }), {
        previousPerformance: makePrev({ composer: null }),
      }),
    ).toBe(50);
  });
});

describe("§12.7 減点: 累計コール回数 上位10曲", () => {
  it("上位10曲に入っている → −12", () => {
    expect(
      score(makeSong({ id: 1 }), { topCalledSongIds: [1, 2, 3] }),
    ).toBe(38);
  });

  it("上位10曲に入っていない → 減点なし", () => {
    expect(score(makeSong({ id: 1 }), { topCalledSongIds: [2, 3] })).toBe(50);
  });

  it("beginner=PRESENT では半減 −6（超定番曲が必要になるため緩和）", () => {
    const safe = makeSong({ id: 1, isStandard: true, noChartOk: true, simpleForm: true });
    const base = score(safe, {
      conditions: makeConditions({ beginner: "PRESENT" }),
    });
    const penalized = score(safe, {
      topCalledSongIds: [1],
      conditions: makeConditions({ beginner: "PRESENT" }),
    });
    expect(base - penalized).toBeCloseTo(6, 5);
  });

  it("safety スライダー ≤ −1（安全重視）でも半減 −6", () => {
    const base = score(makeSong({ id: 1 }), { intent: makeIntent({ safety: -1 }) });
    const penalized = score(makeSong({ id: 1 }), {
      topCalledSongIds: [1],
      intent: makeIntent({ safety: -1 }),
    });
    expect(base - penalized).toBeCloseTo(6, 5);
  });

  it("safety=0（通常時）は全額 −12", () => {
    const base = score(makeSong({ id: 1 }));
    const penalized = score(makeSong({ id: 1 }), { topCalledSongIds: [1] });
    expect(base - penalized).toBeCloseTo(12, 5);
  });
});

describe("§10.3–10.4 減点: 低頻度ジャンル（コール比率 < 5%）", () => {
  it("比率 0.04（< 5%）のジャンルを持つ曲 → −8", () => {
    expect(
      score(makeSong({ id: 1, genres: ["ボサノバ"] }), {
        genreCallRatios: { ボサノバ: 0.04 },
      }),
    ).toBe(42);
  });

  it("比率 0.05（= 5%）は低頻度ではない → 減点なし（境界）", () => {
    expect(
      score(makeSong({ id: 1, genres: ["ボサノバ"] }), {
        genreCallRatios: { ボサノバ: 0.05 },
      }),
    ).toBe(50);
  });

  it("§10.4 意図由来プラス寄与合計 ≥ +10 なら減点免除（条件に十分合う場合だけ候補へ戻す）", () => {
    // rare s=+2 × 登場0回 → +12 ≥ 10 → 免除
    expect(
      score(makeSong({ id: 1, genres: ["ボサノバ"] }), {
        stats: { 1: makeStats({ appearanceCount: 0 }) },
        genreCallRatios: { ボサノバ: 0.01 },
        intent: makeIntent({ rare: 2 }),
      }),
    ).toBe(62);
  });

  it("意図由来プラス寄与が +10 未満なら減点は維持される", () => {
    // rare s=+1 × 登場0回 → +6 < 10 → −8 適用
    expect(
      score(makeSong({ id: 1, genres: ["ボサノバ"] }), {
        stats: { 1: makeStats({ appearanceCount: 0 }) },
        genreCallRatios: { ボサノバ: 0.01 },
        intent: makeIntent({ rare: 1 }),
      }),
    ).toBe(48);
  });
});

describe("§8.3 減点: 管楽器複数（horns=MULTI）の歌もの", () => {
  it("horns=MULTI × 歌もの → −15（完全除外ではなく減点）", () => {
    expect(
      score(makeSong({ id: 1, genres: ["歌もの"] }), {
        conditions: makeConditions({ horns: "MULTI" }),
      }),
    ).toBe(35);
  });

  it("horns=MULTI でも歌もの以外は減点なし", () => {
    expect(
      score(makeSong({ id: 1 }), { conditions: makeConditions({ horns: "MULTI" }) }),
    ).toBe(50);
  });

  it("horns=ONE なら歌ものも減点なし", () => {
    expect(
      score(makeSong({ id: 1, genres: ["歌もの"] }), {
        conditions: makeConditions({ horns: "ONE" }),
      }),
    ).toBe(50);
  });

  it("engine.multi_horn_vocal_penalty は config 経由（20 → −20）", () => {
    expect(
      score(
        makeSong({ id: 1, genres: ["歌もの"] }),
        { conditions: makeConditions({ horns: "MULTI" }) },
        makeConfig({ multiHornVocalPenalty: 20 }),
      ),
    ).toBe(30);
  });
});

describe("§12.5 減点: 直前曲のフロント編成に vo → 歌もの減点（3ケース必須）", () => {
  it("直前曲のフロント編成に vo あり × 歌もの → −15", () => {
    expect(
      score(makeSong({ id: 1, genres: ["歌もの"] }), {
        previousPerformance: makePrev({ frontInstruments: ["vo", "gt"] }),
      }),
    ).toBe(35);
  });

  it("直前曲のフロント編成に vo なし → 減点なし", () => {
    expect(
      score(makeSong({ id: 1, genres: ["歌もの"] }), {
        previousPerformance: makePrev({ frontInstruments: ["tp", "as"] }),
      }),
    ).toBe(50);
  });

  it("直前曲のフロント編成が未入力（null）→ スキップ（減点なし）", () => {
    expect(
      score(makeSong({ id: 1, genres: ["歌もの"] }), {
        previousPerformance: makePrev({ frontInstruments: null }),
      }),
    ).toBe(50);
  });

  it("vo ありでも歌もの以外の曲は減点なし", () => {
    expect(
      score(makeSong({ id: 1 }), {
        previousPerformance: makePrev({ frontInstruments: ["vo"] }),
      }),
    ).toBe(50);
  });

  it("engine.after_vocal_vocal_penalty は config 経由（8 → −8）", () => {
    expect(
      score(
        makeSong({ id: 1, genres: ["歌もの"] }),
        { previousPerformance: makePrev({ frontInstruments: ["vo"] }) },
        makeConfig({ afterVocalVocalPenalty: 8 }),
      ),
    ).toBe(42);
  });
});

describe("§10 ジャンル上書き（フィルタではなく強い加点 +15）", () => {
  it("指定ジャンル該当曲に +15", () => {
    expect(
      score(makeSong({ id: 1, genres: ["ファンク"] }), {
        conditions: makeConditions({ genreOverride: ["ファンク"] }),
      }),
    ).toBe(65);
  });

  it("指定ジャンル非該当曲は加点も除外もなし（候補に残る）", () => {
    expect(
      score(makeSong({ id: 1, genres: ["3拍子"] }), {
        conditions: makeConditions({ genreOverride: ["ファンク"] }),
      }),
    ).toBe(50);
  });

  it("指定ジャンルの低頻度ジャンル減点は無効化される（+15 のみ）", () => {
    expect(
      score(makeSong({ id: 1, genres: ["ボサノバ"] }), {
        genreCallRatios: { ボサノバ: 0.01 },
        conditions: makeConditions({ genreOverride: ["ボサノバ"] }),
      }),
    ).toBe(65);
  });

  it("指定していない低頻度ジャンルの減点は残る", () => {
    // 曲はブルースのみ保持: ブルース低頻度 −8 + 常時 −10、ボサノバ指定の +15 は付かない
    expect(
      score(makeSong({ id: 1, genres: ["ブルース"] }), {
        genreCallRatios: { ブルース: 0.01 },
        conditions: makeConditions({ genreOverride: ["ボサノバ"] }),
      }),
    ).toBe(32);
  });

  it("engine.genre_override_bonus は config 経由（20 → +20）", () => {
    expect(
      score(
        makeSong({ id: 1, genres: ["ファンク"] }),
        { conditions: makeConditions({ genreOverride: ["ファンク"] }) },
        makeConfig({ genreOverrideBonus: 20 }),
      ),
    ).toBe(70);
  });
});
