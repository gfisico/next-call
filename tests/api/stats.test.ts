/**
 * 基準2/3/5（unit-04）: GET /api/stats の集計・フィルタ・月別推移
 * - 曲別: callCount / playCount / lastPlayedDate（participated のみが lastPlayed に効く）
 * - 分布: byGenre（複数ジャンル曲は各ジャンルで加算）/ byKey（null→"(未設定)"）/ byForm
 * - 傾向: byVenue / byHome（母店 vs 非母店）/ bySeason（月境界で畳み込み）
 * - 月別: songsPlayed / newSongRate（フィルタ集合内初出）/ diversity
 * - フィルタ: venue（home / non_home / id）・season（月境界）・from/to が結果を変える
 * - バリデーション: 不正 venue / 日付 / season は 400 VALIDATION_ERROR
 *
 * 方式は helpers.ts（Route を直接 import して呼ぶ）。season_months はシード既定
 * （SPRING 3-5 / SUMMER 6-8 / AUTUMN 9-11 / WINTER 12,1,2）。
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StatsResponse } from "@/lib/api/types";
import {
  expectApiError,
  getRequest,
  setupTestDb,
  teardownTestDb,
  testDb,
} from "./helpers";

beforeEach(async () => {
  await setupTestDb();
});

afterEach(() => {
  teardownTestDb();
});

async function ctx() {
  const db = await testDb();
  const schema = await import("@/db/schema");
  const { GET } = await import("@/app/api/stats/route");
  return { db, schema, GET };
}

type C = Awaited<ReturnType<typeof ctx>>;

function insertVenue(c: C, name: string, isHome: boolean) {
  return c.db.insert(c.schema.venues).values({ name, isHome }).returning().get();
}

function insertSession(c: C, date: string, venueId: number) {
  return c.db
    .insert(c.schema.sessions)
    .values({ sessionDate: date, venueId, status: "ENDED" })
    .returning()
    .get();
}

function insertSong(
  c: C,
  title: string,
  attrs: Partial<typeof c.schema.songs.$inferInsert> = {},
) {
  return c.db
    .insert(c.schema.songs)
    .values({ title, titleNormalized: title, hasPlayed: true, ...attrs })
    .returning()
    .get();
}

function tagSong(c: C, songId: number, genreNames: string[]) {
  for (const name of genreNames) {
    const tag = c.db
      .select()
      .from(c.schema.genreTags)
      .where(eq(c.schema.genreTags.name, name))
      .get();
    if (!tag) throw new Error(`unknown genre: ${name}`);
    c.db
      .insert(c.schema.songGenreTags)
      .values({ songId, genreTagId: tag.id })
      .run();
  }
}

let orderCounter = 0;
function insertPerf(
  c: C,
  args: {
    sessionId: number;
    songId: number;
    participated?: boolean;
    calledByMe?: boolean;
  },
) {
  return c.db
    .insert(c.schema.performances)
    .values({
      sessionId: args.sessionId,
      songId: args.songId,
      orderIndex: ++orderCounter,
      participated: args.participated ?? false,
      calledByMe: args.calledByMe ?? false,
    })
    .returning()
    .get();
}

async function callStats(c: C, query = ""): Promise<StatsResponse> {
  const res = await c.GET(getRequest(`/api/stats${query}`));
  expect(res.status).toBe(200);
  return (await res.json()) as StatsResponse;
}

describe("GET /api/stats: 曲別集計", () => {
  it("callCount=called_by_me 合計 / playCount=participated 合計 / lastPlayedDate=participated の最大日", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Song A");
    const s1 = insertSession(c, "2026-05-01", home.id);
    const s2 = insertSession(c, "2026-06-10", home.id);
    const s3 = insertSession(c, "2026-07-01", home.id);
    insertPerf(c, { sessionId: s1.id, songId: song.id, participated: true });
    insertPerf(c, {
      sessionId: s2.id,
      songId: song.id,
      participated: true,
      calledByMe: true,
    });
    // より新しいが不参加 → lastPlayedDate は 2026-06-10 のまま・callCount には加算
    insertPerf(c, { sessionId: s3.id, songId: song.id, calledByMe: true });

    const stats = await callStats(c);
    const row = stats.songs.find((s) => s.songId === song.id);
    expect(row).toEqual({
      songId: song.id,
      title: "Song A",
      callCount: 2,
      playCount: 2,
      lastPlayedDate: "2026-06-10",
    });
  });

  it("フィルタ下で 1 度も登場しない曲は songs に含めない", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const played = insertSong(c, "Played");
    const never = insertSong(c, "Never");
    const s1 = insertSession(c, "2026-06-10", home.id);
    insertPerf(c, { sessionId: s1.id, songId: played.id, participated: true });

    const stats = await callStats(c);
    expect(stats.songs.map((s) => s.songId)).toEqual([played.id]);
    expect(stats.songs.find((s) => s.songId === never.id)).toBeUndefined();
  });
});

describe("GET /api/stats: venue フィルタ", () => {
  it("home / non_home / id で集計対象が変わる", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const other = insertVenue(c, "別店", false);
    const song = insertSong(c, "Song X");
    const sHome = insertSession(c, "2026-06-10", home.id);
    const sOther = insertSession(c, "2026-06-11", other.id);
    // 母店で 2 コール、非母店で 1 コール
    insertPerf(c, { sessionId: sHome.id, songId: song.id, calledByMe: true });
    insertPerf(c, { sessionId: sHome.id, songId: song.id, calledByMe: true });
    insertPerf(c, { sessionId: sOther.id, songId: song.id, calledByMe: true });

    const all = await callStats(c, "?venue=all");
    expect(all.songs[0].callCount).toBe(3);

    const homeOnly = await callStats(c, "?venue=home");
    expect(homeOnly.songs[0].callCount).toBe(2);

    const nonHome = await callStats(c, "?venue=non_home");
    expect(nonHome.songs[0].callCount).toBe(1);

    const byId = await callStats(c, `?venue=${other.id}`);
    expect(byId.songs[0].callCount).toBe(1);
  });
});

describe("GET /api/stats: season フィルタ（月境界・JST）", () => {
  it("SUMMER（6-8月）のみ集計する", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Song S");
    const summer = insertSession(c, "2026-07-15", home.id);
    const winter = insertSession(c, "2026-01-15", home.id);
    insertPerf(c, { sessionId: summer.id, songId: song.id, calledByMe: true });
    insertPerf(c, { sessionId: winter.id, songId: song.id, calledByMe: true });

    const all = await callStats(c);
    expect(all.songs[0].callCount).toBe(2);

    const summerOnly = await callStats(c, "?season=SUMMER");
    expect(summerOnly.songs[0].callCount).toBe(1);
  });
});

describe("GET /api/stats: from/to 期間フィルタ", () => {
  it("期間外のセッションを除外する", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Song R");
    const before = insertSession(c, "2026-03-01", home.id);
    const within = insertSession(c, "2026-07-01", home.id);
    const after = insertSession(c, "2026-11-01", home.id);
    insertPerf(c, { sessionId: before.id, songId: song.id, calledByMe: true });
    insertPerf(c, { sessionId: within.id, songId: song.id, calledByMe: true });
    insertPerf(c, { sessionId: after.id, songId: song.id, calledByMe: true });

    const ranged = await callStats(c, "?from=2026-05-01&to=2026-08-31");
    expect(ranged.songs[0].callCount).toBe(1);
    expect(ranged.monthly.map((m) => m.month)).toEqual(["2026-07"]);
  });
});

describe("GET /api/stats: 分布", () => {
  it("byGenre は複数ジャンル曲を各ジャンルで加算 / byKey は null を (未設定) に / byForm", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const g1 = insertSong(c, "G1", { songKey: "F", form: "AABA" });
    const g2 = insertSong(c, "G2", { songKey: null, form: "BLUES12" });
    tagSong(c, g1.id, ["バラード", "ボサノバ"]);
    tagSong(c, g2.id, ["バラード"]);
    const s1 = insertSession(c, "2026-06-10", home.id);
    insertPerf(c, { sessionId: s1.id, songId: g1.id, participated: true });
    insertPerf(c, { sessionId: s1.id, songId: g2.id, participated: true });

    const stats = await callStats(c);
    const genre = Object.fromEntries(
      stats.distributions.byGenre.map((b) => [b.key, b.count]),
    );
    expect(genre["バラード"]).toBe(2);
    expect(genre["ボサノバ"]).toBe(1);

    const keys = Object.fromEntries(
      stats.distributions.byKey.map((b) => [b.key, b.count]),
    );
    expect(keys["F"]).toBe(1);
    expect(keys["(未設定)"]).toBe(1);

    const forms = Object.fromEntries(
      stats.distributions.byForm.map((b) => [b.key, b.count]),
    );
    expect(forms["AABA"]).toBe(1);
    expect(forms["BLUES12"]).toBe(1);
  });
});

describe("GET /api/stats: 傾向", () => {
  it("byVenue / byHome / bySeason を返す", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const other = insertVenue(c, "別店", false);
    const song = insertSong(c, "Song T");
    // 母店・夏 2 件、非母店・冬 1 件
    const sHomeSummer = insertSession(c, "2026-07-10", home.id);
    const sHomeSummer2 = insertSession(c, "2026-08-10", home.id);
    const sOtherWinter = insertSession(c, "2026-01-10", other.id);
    insertPerf(c, { sessionId: sHomeSummer.id, songId: song.id });
    insertPerf(c, { sessionId: sHomeSummer2.id, songId: song.id });
    insertPerf(c, { sessionId: sOtherWinter.id, songId: song.id });

    const stats = await callStats(c);

    expect(stats.trends.byHome).toEqual({ home: 2, nonHome: 1 });

    const venueMap = Object.fromEntries(
      stats.trends.byVenue.map((v) => [v.venueId, v]),
    );
    expect(venueMap[home.id]).toMatchObject({ venueName: "某店", count: 2 });
    expect(venueMap[other.id]).toMatchObject({ venueName: "別店", count: 1 });

    const seasonMap = Object.fromEntries(
      stats.trends.bySeason.map((s) => [s.season, s.count]),
    );
    expect(seasonMap.SUMMER).toBe(2);
    expect(seasonMap.WINTER).toBe(1);
    expect(seasonMap.SPRING).toBe(0);
    expect(seasonMap.AUTUMN).toBe(0);
    // 4 季節が固定順で返る
    expect(stats.trends.bySeason.map((s) => s.season)).toEqual([
      "SPRING",
      "SUMMER",
      "AUTUMN",
      "WINTER",
    ]);
  });
});

describe("GET /api/stats: 月別推移", () => {
  it("songsPlayed=異なる曲数 / newSongRate=当月初出割合 / diversity=異なる曲数/演奏総数", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const a = insertSong(c, "Song A");
    const b = insertSong(c, "Song B");
    const jun = insertSession(c, "2026-06-10", home.id);
    const jul = insertSession(c, "2026-07-10", home.id);
    // 6月: A を 1 回（A の初出）
    insertPerf(c, { sessionId: jun.id, songId: a.id, participated: true });
    // 7月: A を 2 回 + B を 1 回（B の初出）。plays=3, distinct=2
    insertPerf(c, { sessionId: jul.id, songId: a.id });
    insertPerf(c, { sessionId: jul.id, songId: a.id });
    insertPerf(c, { sessionId: jul.id, songId: b.id });

    const stats = await callStats(c);
    const byMonth = Object.fromEntries(stats.monthly.map((m) => [m.month, m]));

    expect(byMonth["2026-06"]).toMatchObject({
      songsPlayed: 1,
      newSongRate: 1, // A が当月初出
      diversity: 1, // 1 曲 / 1 演奏
    });
    expect(byMonth["2026-07"].songsPlayed).toBe(2);
    expect(byMonth["2026-07"].newSongRate).toBeCloseTo(0.5); // B のみ初出 / distinct 2
    expect(byMonth["2026-07"].diversity).toBeCloseTo(2 / 3); // distinct 2 / plays 3
    // 月は昇順
    expect(stats.monthly.map((m) => m.month)).toEqual(["2026-06", "2026-07"]);
  });
});

describe("GET /api/stats: バリデーション", () => {
  it("不正な venue（0）は 400 VALIDATION_ERROR", async () => {
    const c = await ctx();
    const res = await c.GET(getRequest("/api/stats?venue=0"));
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("フォーマット不正な日付は 400 VALIDATION_ERROR", async () => {
    const c = await ctx();
    const res = await c.GET(getRequest("/api/stats?from=2026%2F07%2F01"));
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("不正な season は 400 VALIDATION_ERROR", async () => {
    const c = await ctx();
    const res = await c.GET(getRequest("/api/stats?season=INVALID"));
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("パラメータ未指定（全期間・venue=all）でも 200 を返す", async () => {
    const c = await ctx();
    const stats = await callStats(c);
    expect(stats).toMatchObject({
      songs: expect.any(Array),
      distributions: expect.any(Object),
      trends: expect.any(Object),
      monthly: expect.any(Array),
    });
  });
});

describe("GET /api/stats: 性能スモーク（基準4）", () => {
  it("曲500・演奏5,000規模でも即時応答する", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const other = insertVenue(c, "別店", false);
    const genreRows = c.db.select().from(c.schema.genreTags).all();

    c.db.transaction((tx) => {
      const songIds: number[] = [];
      for (let i = 1; i <= 500; i++) {
        const song = tx
          .insert(c.schema.songs)
          .values({
            title: `Perf ${String(i).padStart(3, "0")}`,
            titleNormalized: `perf ${String(i).padStart(3, "0")}`,
            songKey: ["C", "F", "Bb", null][i % 4],
            form: (["AABA", "ABAC", "BLUES12", "OTHER"] as const)[i % 4],
          })
          .returning()
          .get();
        songIds.push(song.id);
        if (i % 3 === 0) {
          tx.insert(c.schema.songGenreTags)
            .values({
              songId: song.id,
              genreTagId: genreRows[i % genreRows.length].id,
            })
            .run();
        }
      }
      const sessionIds: number[] = [];
      for (let i = 1; i <= 100; i++) {
        const d = new Date(
          Date.UTC(2026, 6, 12) - ((i * 7) % 730) * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        const s = tx
          .insert(c.schema.sessions)
          .values({
            sessionDate: d,
            venueId: i % 2 === 0 ? home.id : other.id,
            status: "ENDED",
          })
          .returning()
          .get();
        sessionIds.push(s.id);
      }
      const rows = [];
      for (let i = 1; i <= 5000; i++) {
        rows.push({
          sessionId: sessionIds[i % sessionIds.length],
          songId: songIds[(i * 13) % 500],
          orderIndex: i,
          participated: i % 3 === 0,
          calledByMe: i % 5 === 0,
        });
      }
      for (let i = 0; i < rows.length; i += 500) {
        tx.insert(c.schema.performances)
          .values(rows.slice(i, i + 500))
          .run();
      }
    });

    const t0 = performance.now();
    const stats = await callStats(c);
    const elapsed = performance.now() - t0;
    expect(stats.songs.length).toBeGreaterThan(0);
    expect(stats.monthly.length).toBeGreaterThan(0);
    // フレーク回避のため上限は緩め（SQL 集計・N+1 なしを担保）
    expect(elapsed).toBeLessThan(1000);
  });
});
