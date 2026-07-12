/**
 * Stage 5: 繰り返し減点（§14.3–14.4）
 * 前回提示 −12 / 直近5リクエスト(30日) −6 / 同一署名3回以上 追加−6 / 前回提示ジャンル −3
 * Stage 1–3 通過曲数 < 8 で全て半減。
 */
import { describe, expect, it } from "vitest";
import { recommend } from "@/engine/index";
import { applyRepeatPenalties } from "@/engine/repeat";
import type { EngineInput } from "@/engine/types";
import { makeConfig, makeInput, makeSong } from "./helpers";

const config = makeConfig();

/** n 曲（id 1..n・スコア一律 50）の scores Map と input を作る */
function fixture(n: number, inputOverrides: Partial<EngineInput> = {}) {
  const songs = Array.from({ length: n }, (_, i) =>
    makeSong({ id: i + 1, genres: i + 1 === 4 ? ["ファンク"] : [] }),
  );
  const scores = new Map(songs.map((s) => [s.id, 50]));
  const input = makeInput({ songs, ...inputOverrides });
  return { scores, input };
}

describe("§14.3 繰り返し減点（通過曲数 ≥ 8 = 全額適用）", () => {
  it("前回リクエストで提示した曲 → −12", () => {
    const { scores, input } = fixture(10, {
      history: { lastRequestSongIds: [1], recentSongIds: [], sameSignatureCounts: {}, lastRequestGenres: [] },
    });
    const out = applyRepeatPenalties(scores, input, config);
    expect(out.get(1)).toBe(38);
    expect(out.get(2)).toBe(50);
  });

  it("直近5リクエスト（30日以内）で提示した曲 → −6", () => {
    const { scores, input } = fixture(10, {
      history: { lastRequestSongIds: [], recentSongIds: [2], sameSignatureCounts: {}, lastRequestGenres: [] },
    });
    const out = applyRepeatPenalties(scores, input, config);
    expect(out.get(2)).toBe(44);
    expect(out.get(3)).toBe(50);
  });

  it("同一 condition_signature で3回以上提示 → 追加 −6", () => {
    const { scores, input } = fixture(10, {
      history: { lastRequestSongIds: [], recentSongIds: [], sameSignatureCounts: { 3: 3 }, lastRequestGenres: [] },
    });
    const out = applyRepeatPenalties(scores, input, config);
    expect(out.get(3)).toBe(44);
  });

  it("同一 condition_signature 2回では追加減点なし（境界: 3回以上）", () => {
    const { scores, input } = fixture(10, {
      history: { lastRequestSongIds: [], recentSongIds: [], sameSignatureCounts: { 3: 2 }, lastRequestGenres: [] },
    });
    const out = applyRepeatPenalties(scores, input, config);
    expect(out.get(3)).toBe(50);
  });

  it("§14.4 前回リクエスト候補の特殊ジャンルを持つ曲 → −3", () => {
    const { scores, input } = fixture(10, {
      history: { lastRequestSongIds: [], recentSongIds: [], sameSignatureCounts: {}, lastRequestGenres: ["ファンク"] },
    });
    const out = applyRepeatPenalties(scores, input, config);
    expect(out.get(4)).toBe(47); // song4 のみファンク属性
    expect(out.get(5)).toBe(50);
  });

  it("直近提示 + 同一署名3回以上は累積する（−6 追加 −6 = −12）", () => {
    const { scores, input } = fixture(10, {
      history: { lastRequestSongIds: [], recentSongIds: [5], sameSignatureCounts: { 5: 3 }, lastRequestGenres: [] },
    });
    const out = applyRepeatPenalties(scores, input, config);
    expect(out.get(5)).toBe(38);
  });

  it("engine.repeat_penalties は config 経由（lastRequest 20 → −20）", () => {
    const { scores, input } = fixture(10, {
      history: { lastRequestSongIds: [1], recentSongIds: [], sameSignatureCounts: {}, lastRequestGenres: [] },
    });
    const out = applyRepeatPenalties(
      scores,
      input,
      makeConfig({ repeatPenalties: { lastRequest: 20, recentRequests: 6, sameSignature: 6, genreRepeat: 3 } }),
    );
    expect(out.get(1)).toBe(30);
  });
});

describe("§14.3 緩和: 通過曲数 < 8 で減点を半減", () => {
  it("通過曲数 7（< 8）では前回提示減点が半減 −6", () => {
    const { scores, input } = fixture(7, {
      history: { lastRequestSongIds: [1], recentSongIds: [], sameSignatureCounts: {}, lastRequestGenres: [] },
    });
    const out = applyRepeatPenalties(scores, input, config);
    expect(out.get(1)).toBe(44);
  });

  it("通過曲数 8 ちょうどでは全額 −12（境界）", () => {
    const { scores, input } = fixture(8, {
      history: { lastRequestSongIds: [1], recentSongIds: [], sameSignatureCounts: {}, lastRequestGenres: [] },
    });
    const out = applyRepeatPenalties(scores, input, config);
    expect(out.get(1)).toBe(38);
  });

  it("半減はジャンル繰り返し減点にも適用される（−3 → −1.5）", () => {
    const { scores, input } = fixture(7, {
      history: { lastRequestSongIds: [], recentSongIds: [], sameSignatureCounts: {}, lastRequestGenres: ["ファンク"] },
    });
    const out = applyRepeatPenalties(scores, input, config);
    expect(out.get(4)).toBeCloseTo(48.5, 5);
  });
});

describe("純関数性", () => {
  it("入力の scores Map を破壊しない（新しい Map を返す）", () => {
    const { scores, input } = fixture(10, {
      history: { lastRequestSongIds: [1], recentSongIds: [], sameSignatureCounts: {}, lastRequestGenres: [] },
    });
    applyRepeatPenalties(scores, input, config);
    expect(scores.get(1)).toBe(50);
  });
});

describe("recommend 統合: 同一条件で連続実行すると前回提示曲のスコアが下がる", () => {
  it("前回提示された曲は次回リクエストで他の同条件曲よりスコアが低い", () => {
    // 同一属性の2曲のみ・candidate_count=2 → 両方必ず候補に入る
    const songs = [makeSong({ id: 1 }), makeSong({ id: 2 })];
    const cfg = makeConfig({ candidateCount: 2 });

    const first = recommend(makeInput({ songs }), cfg, 1);
    expect(first.candidates.map((c) => c.songId).sort()).toEqual([1, 2]);
    const score1st = first.candidates[0].score;

    // 2回目: song1 を前回提示として渡す（通過曲数 2 < 8 → 半減 −6）
    const second = recommend(
      makeInput({
        songs,
        history: { lastRequestSongIds: [1], recentSongIds: [], sameSignatureCounts: {}, lastRequestGenres: [] },
      }),
      cfg,
      2,
    );
    const c1 = second.candidates.find((c) => c.songId === 1);
    const c2 = second.candidates.find((c) => c.songId === 2);
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1!.score).toBeLessThan(c2!.score);
    expect(c2!.score - c1!.score).toBeCloseTo(6, 5);
    expect(c2!.score).toBeCloseTo(score1st, 5);
  });
});
