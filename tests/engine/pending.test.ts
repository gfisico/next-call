/**
 * 保留曲の扱い（仕様§16）
 * - 推薦スコアに一切影響しない・無条件で別枠表示（完全除外該当でも隠さない）
 * - 警告バッジ: 当日演奏済み / 直前曲と同じ構成 / 黒本1条件外 / 編成に合いにくい
 * - 通常候補と重複した場合は候補側に「保留中」バッジ
 */
import { describe, expect, it } from "vitest";
import { recommend } from "@/engine/index";
import { annotatePendingSongs } from "@/engine/pending";
import { makeConfig, makeInput, makePrev, makeSong } from "./helpers";

const config = makeConfig();

describe("§16.3 無条件表示", () => {
  it("完全除外（has_played=false）に該当する保留曲も隠さず返す", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, hasPlayed: false })],
      pendingSongIds: [1],
    });
    const result = annotatePendingSongs(input, config);
    expect(result.map((p) => p.songId)).toContain(1);
  });

  it("保留曲でない曲は返さない", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1 }), makeSong({ id: 2 })],
      pendingSongIds: [2],
    });
    expect(annotatePendingSongs(input, config).map((p) => p.songId)).toEqual([2]);
  });
});

describe("§16.3 警告バッジ判定", () => {
  it("当日演奏済み → PLAYED_TODAY", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1 })],
      playedTodaySongIds: [1],
      pendingSongIds: [1],
    });
    expect(annotatePendingSongs(input, config)[0].warnings).toContain("PLAYED_TODAY");
  });

  it("直前曲と同じ構成 → SAME_FORM", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, form: "AABA" })],
      previousPerformance: makePrev({ form: "AABA" }),
      pendingSongIds: [1],
    });
    expect(annotatePendingSongs(input, config)[0].warnings).toContain("SAME_FORM");
  });

  it("kurobon1_only なのに非掲載 → KUROBON1_MISMATCH", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, inKurobon1: false })],
      conditions: { horns: "ONE", beginner: "NONE", kurobon1Only: true, genreOverride: [] },
      pendingSongIds: [1],
    });
    expect(annotatePendingSongs(input, config)[0].warnings).toContain("KUROBON1_MISMATCH");
  });

  it("複数管 × 歌もの → FORMATION_MISMATCH", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, genres: ["歌もの"] })],
      conditions: { horns: "MULTI", beginner: "NONE", kurobon1Only: false, genreOverride: [] },
      pendingSongIds: [1],
    });
    expect(annotatePendingSongs(input, config)[0].warnings).toContain("FORMATION_MISMATCH");
  });

  it("該当なしなら警告は空配列", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1 })],
      pendingSongIds: [1],
    });
    expect(annotatePendingSongs(input, config)[0].warnings).toEqual([]);
  });

  it("複数該当なら複数バッジ（当日演奏済み + 同構成）", () => {
    const input = makeInput({
      songs: [makeSong({ id: 1, form: "AABA" })],
      playedTodaySongIds: [1],
      previousPerformance: makePrev({ form: "AABA" }),
      pendingSongIds: [1],
    });
    const warnings = annotatePendingSongs(input, config)[0].warnings;
    expect(warnings).toContain("PLAYED_TODAY");
    expect(warnings).toContain("SAME_FORM");
  });
});

describe("§16.4 スコア不干渉と保留中バッジ（recommend 統合）", () => {
  it("保留登録の有無で候補のスコアは変わらない（スコア不干渉）", () => {
    const songs = [makeSong({ id: 1 }), makeSong({ id: 2, form: "ABAC" })];
    const cfg = makeConfig({ candidateCount: 2 });
    const without = recommend(makeInput({ songs }), cfg, 3);
    const withPending = recommend(makeInput({ songs, pendingSongIds: [1] }), cfg, 3);
    const scoreOf = (r: ReturnType<typeof recommend>, id: number) =>
      r.candidates.find((c) => c.songId === id)?.score;
    expect(scoreOf(withPending, 1)).toBe(scoreOf(without, 1));
    expect(scoreOf(withPending, 2)).toBe(scoreOf(without, 2));
  });

  it("保留曲が通常候補と重複した場合、候補側に isPending=true が付く", () => {
    const songs = [makeSong({ id: 1 })];
    const cfg = makeConfig({ candidateCount: 1 });
    const result = recommend(makeInput({ songs, pendingSongIds: [1] }), cfg, 3);
    expect(result.candidates[0].songId).toBe(1);
    expect(result.candidates[0].isPending).toBe(true);
  });

  it("保留曲でない候補は isPending=false", () => {
    const songs = [makeSong({ id: 1 })];
    const cfg = makeConfig({ candidateCount: 1 });
    const result = recommend(makeInput({ songs }), cfg, 3);
    expect(result.candidates[0].isPending).toBe(false);
  });

  it("recommend の結果に保留曲注釈（pendingSongs）が含まれる", () => {
    const songs = [makeSong({ id: 1 }), makeSong({ id: 2, hasPlayed: false })];
    const result = recommend(makeInput({ songs, pendingSongIds: [2] }), config, 3);
    expect(result.pendingSongs.map((p) => p.songId)).toEqual([2]);
  });
});
