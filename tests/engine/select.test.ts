/**
 * Stage 6–7: 候補集団の作成（§14.2）+ softmax 重み付き非復元抽出（§14.2/§14.4）
 * - 固定 seed 再現性 / 統計的テスト（1000回試行）/ 同一特殊ジャンル weight 減衰
 * - 統計的テストは固定 seed 列で実行し、閾値に十分なマージンを取る（flake 対策）
 */
import { describe, expect, it } from "vitest";
import { recommend } from "@/engine/index";
import { selectCandidates } from "@/engine/select";
import type { ScoredSong } from "@/engine/types";
import { makeConfig, makeInput, makeSong, makeStats } from "./helpers";

function scored(id: number, score: number, genres: string[] = []): ScoredSong {
  return { song: makeSong({ id, genres }), score };
}

/** seed 0..trials-1 で cc=1 抽出し、songId ごとの選出回数を数える */
function tally(
  pool: ScoredSong[],
  trials: number,
  cfg = makeConfig({ candidateCount: 1 }),
): Map<number, number> {
  const counts = new Map<number, number>();
  for (let seed = 0; seed < trials; seed++) {
    const { selected } = selectCandidates(pool, cfg, seed);
    for (const s of selected) {
      counts.set(s.song.id, (counts.get(s.song.id) ?? 0) + 1);
    }
  }
  return counts;
}

describe("§14.2 候補集団の作成", () => {
  it("score_floor(30) 未満の曲は決して選出されない", () => {
    const pool = [scored(1, 50), scored(2, 29)];
    const cfg = makeConfig({ candidateCount: 3 });
    for (let seed = 0; seed < 300; seed++) {
      const { selected } = selectCandidates(pool, cfg, seed);
      expect(selected.map((s) => s.song.id)).not.toContain(2);
    }
  });

  it("集団サイズ < candidate_count+2 のとき pool_band_relaxed(15) へ一度だけ拡大する", () => {
    // maxScore=50, B=39: 初期バンド(≥40)外だが拡大後(≥35)は入る
    const pool = [scored(1, 50), scored(2, 39)];
    const counts = tally(pool, 500);
    expect(counts.get(2) ?? 0).toBeGreaterThanOrEqual(5);
    expect(counts.get(1) ?? 0).toBeGreaterThan(counts.get(2) ?? 0);
  });

  it("拡大は一度だけ: 拡大後バンド(maxScore−15)にも入らない曲は選出されない", () => {
    // B=34: 34 ≥ floor(30) だが 34 < 50−15=35 → 集団不足でも二度目の拡大はしない
    const pool = [scored(1, 50), scored(2, 34)];
    const cfg = makeConfig({ candidateCount: 1 });
    for (let seed = 0; seed < 300; seed++) {
      const { selected } = selectCandidates(pool, cfg, seed);
      expect(selected.map((s) => s.song.id)).toEqual([1]);
    }
  });

  it("集団が十分な大きさなら初期バンド(maxScore−10)外の曲は選出されない", () => {
    const pool = [scored(1, 50), scored(2, 48), scored(3, 46), scored(4, 44), scored(5, 39)];
    const counts = tally(pool, 300);
    expect(counts.get(5) ?? 0).toBe(0);
  });

  it("§14.5 candidate_count 未満なら無理に増やさず isSparse=true で少ないまま返す", () => {
    const pool = [scored(1, 50), scored(2, 48)];
    const cfg = makeConfig({ candidateCount: 3 });
    const { selected, isSparse } = selectCandidates(pool, cfg, 7);
    expect(selected).toHaveLength(2);
    expect(isSparse).toBe(true);
  });

  it("candidate_count 以上選出できるときは isSparse=false", () => {
    const pool = [scored(1, 50), scored(2, 49), scored(3, 48), scored(4, 47)];
    const cfg = makeConfig({ candidateCount: 3 });
    const { selected, isSparse } = selectCandidates(pool, cfg, 7);
    expect(selected).toHaveLength(3);
    expect(isSparse).toBe(false);
  });
});

describe("§14.2 抽選の決定性（seed 注入）", () => {
  it("同じ seed なら selectCandidates の結果が完全に再現する", () => {
    const pool = [scored(1, 50), scored(2, 49), scored(3, 48), scored(4, 47), scored(5, 46)];
    const cfg = makeConfig({ candidateCount: 3 });
    const a = selectCandidates(pool, cfg, 12345);
    const b = selectCandidates(pool, cfg, 12345);
    expect(a.selected.map((s) => s.song.id)).toEqual(b.selected.map((s) => s.song.id));
  });

  it("同じ seed なら recommend 全体の結果が完全に再現する", () => {
    const songs = Array.from({ length: 10 }, (_, i) => makeSong({ id: i + 1 }));
    const stats = Object.fromEntries(
      songs.map((s, i) => [s.id, makeStats({ appearanceCount: [0, 1, 3, 6, 11][i % 5] })]),
    );
    const input = makeInput({
      songs,
      stats,
      intent: { rare: 2, longUnplayed: 0, safety: 0, mood: 0, ballad: 0, seasonal: false, listener: false },
      conditions: { horns: "UNKNOWN", beginner: "UNKNOWN", kurobon1Only: false, genreOverride: [] },
    });
    const cfg = makeConfig();
    const a = recommend(input, cfg, 42);
    const b = recommend(input, cfg, 42);
    expect(a).toEqual(b);
  });

  it("seed が異なれば選出結果は変わり得る（20 seed で複数パターン）", () => {
    const songs = Array.from({ length: 10 }, (_, i) => makeSong({ id: i + 1 }));
    const input = makeInput({ songs });
    const cfg = makeConfig({ candidateCount: 1 });
    const firstIds = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      firstIds.add(recommend(input, cfg, seed).candidates[0].songId);
    }
    expect(firstIds.size).toBeGreaterThan(1);
  });
});

describe("§14.2 softmax 重み（τ=5）の統計的性質（1000回試行）", () => {
  it("高スコア曲ほど選出頻度が高い（50 > 45 > 41）", () => {
    // weight: e^0=1, e^-1≈0.368, e^-1.8≈0.165 → P ≈ 0.652 / 0.240 / 0.108
    const pool = [scored(1, 50), scored(2, 45), scored(3, 41)];
    const counts = tally(pool, 1000);
    const c1 = counts.get(1) ?? 0;
    const c2 = counts.get(2) ?? 0;
    const c3 = counts.get(3) ?? 0;
    expect(c1 + c2 + c3).toBe(1000);
    expect(c1).toBeGreaterThan(c2);
    expect(c2).toBeGreaterThan(c3);
    expect(c1).toBeGreaterThan(550); // 期待 652
    expect(c2).toBeGreaterThan(120); // 期待 240
    expect(c3).toBeGreaterThan(30); // 期待 108
    expect(c3).toBeLessThan(220);
  });

  it("engine.random_temperature は config 経由: τ を小さくすると高スコア曲へ集中する", () => {
    const pool = [scored(1, 50), scored(2, 45)];
    // τ=5: P(B) = e^-1/(1+e^-1) ≈ 0.269
    const at5 = tally(pool, 1000, makeConfig({ candidateCount: 1, randomTemperature: 5 }));
    // τ=0.5: P(B) = e^-10/(1+e^-10) ≈ 0.00005
    const at05 = tally(pool, 1000, makeConfig({ candidateCount: 1, randomTemperature: 0.5 }));
    expect(at5.get(2) ?? 0).toBeGreaterThan(150);
    expect(at05.get(2) ?? 0).toBeLessThan(30);
  });
});

describe("§14.4 同一特殊ジャンルの weight 減衰（抽出ごとに ×0.5）", () => {
  // 同点3曲（うち2曲がファンク）から2曲抽出:
  //   減衰なしなら P(ファンク2曲) = 1/3 ≈ 333/1000
  //   減衰 0.5 なら P = 2/9 ≈ 222/1000
  const pool = () => [
    scored(1, 50, ["ファンク"]),
    scored(2, 50, ["ファンク"]),
    scored(3, 50, []),
  ];

  function countBothFunk(decay: number): number {
    const cfg = makeConfig({ candidateCount: 2, genreDrawDecay: decay });
    let both = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const { selected } = selectCandidates(pool(), cfg, seed);
      const ids = selected.map((s) => s.song.id);
      if (ids.includes(1) && ids.includes(2)) both++;
    }
    return both;
  }

  it("減衰 0.5 で同一特殊ジャンル2曲同時選出が抑制される（1/3 → 2/9 付近）", () => {
    const both = countBothFunk(0.5);
    expect(both).toBeGreaterThan(140);
    expect(both).toBeLessThan(290);
  });

  it("減衰 1.0（無効化）なら同時選出は 1/3 付近に戻る（config 駆動の確認）", () => {
    const both = countBothFunk(1.0);
    expect(both).toBeGreaterThan(280);
    expect(both).toBeLessThan(400);
  });
});
