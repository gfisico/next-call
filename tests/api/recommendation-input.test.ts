/**
 * 基準1（unit-04）: buildEngineInput の集計値それぞれの期待値テスト
 * - 店舗区分別登場回数（期間内/期間外・店舗区分切替）
 * - 最終演奏日（participated のみ）→ daysSinceLastPlayed
 * - 演奏回数・コール回数
 * - 累計コール上位N曲（決定的タイブレーク）
 * - ジャンル別コール比率（全ジャンル 0 初期化・総コール 0 は空 Record）
 * - 当日演奏済み集合 / 直前 Performance（フロント編成 null/配列・1曲目 null）
 * - 保留曲
 * 基準9（前倒し）: インポート相当データ（過去 sessions/performances の直接 INSERT）の反映
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeConditions, makeIntent } from "../engine/helpers";
import { setupTestDb, teardownTestDb, testDb } from "./helpers";

beforeEach(async () => {
  await setupTestDb();
});

afterEach(() => {
  teardownTestDb();
});

/** 対象セッション日。集計期間は既定 30 日（windowStart = 2026-06-12） */
const SESSION_DATE = "2026-07-12";
const WINDOW_DAYS = 30;

async function ctx() {
  const db = await testDb();
  const schema = await import("@/db/schema");
  const { buildEngineInput } = await import(
    "@/server/recommendation/build-input"
  );
  return { db, schema, buildEngineInput };
}

type C = Awaited<ReturnType<typeof ctx>>;

function insertVenue(c: C, name: string, isHome: boolean) {
  return c.db.insert(c.schema.venues).values({ name, isHome }).returning().get();
}

function insertSession(
  c: C,
  args: { date: string; venueId: number; status?: "ACTIVE" | "ENDED" },
) {
  return c.db
    .insert(c.schema.sessions)
    .values({
      sessionDate: args.date,
      venueId: args.venueId,
      status: args.status ?? "ENDED",
    })
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

function insertPerformance(
  c: C,
  args: {
    sessionId: number;
    songId: number;
    orderIndex: number;
    participated?: boolean;
    calledByMe?: boolean;
  },
) {
  return c.db
    .insert(c.schema.performances)
    .values({
      sessionId: args.sessionId,
      songId: args.songId,
      orderIndex: args.orderIndex,
      participated: args.participated ?? false,
      calledByMe: args.calledByMe ?? false,
    })
    .returning()
    .get();
}

function build(
  c: C,
  session: ReturnType<typeof insertSession>,
  overrides: Partial<Parameters<C["buildEngineInput"]>[0]> = {},
) {
  return c.buildEngineInput({
    dbx: c.db,
    session,
    conditions: makeConditions(),
    intent: makeIntent(),
    currentSeason: "SUMMER",
    appearanceWindowDays: WINDOW_DAYS,
    topCalledN: 10,
    repeatParams: { recentCount: 5, windowDays: 30 },
    signature: "test-signature",
    ...overrides,
  });
}

describe("buildEngineInput: 店舗区分別登場回数", () => {
  it("同一店舗区分・期間内のみ数える（期間外・別区分は除外）", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const other = insertVenue(c, "別店", false);
    const song = insertSong(c, "Song X");

    const inWindowHome = insertSession(c, { date: "2026-06-20", venueId: home.id });
    const outWindowHome = insertSession(c, { date: "2026-06-01", venueId: home.id });
    const inWindowOther = insertSession(c, { date: "2026-06-25", venueId: other.id });
    insertPerformance(c, { sessionId: inWindowHome.id, songId: song.id, orderIndex: 1 });
    insertPerformance(c, { sessionId: outWindowHome.id, songId: song.id, orderIndex: 1 });
    insertPerformance(c, { sessionId: inWindowOther.id, songId: song.id, orderIndex: 1 });

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    const { input } = build(c, target);
    expect(input.stats[song.id].appearanceCount).toBe(1);
  });

  it("店舗区分切替: 非某店セッションでは非某店の登場だけを数える", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const other = insertVenue(c, "別店", false);
    const other2 = insertVenue(c, "別店2", false);
    const song = insertSong(c, "Song X");

    const s1 = insertSession(c, { date: "2026-06-20", venueId: home.id });
    const s2 = insertSession(c, { date: "2026-06-25", venueId: other.id });
    const s3 = insertSession(c, { date: "2026-07-01", venueId: other2.id });
    insertPerformance(c, { sessionId: s1.id, songId: song.id, orderIndex: 1 });
    insertPerformance(c, { sessionId: s2.id, songId: song.id, orderIndex: 1 });
    insertPerformance(c, { sessionId: s3.id, songId: song.id, orderIndex: 1 });

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: other.id,
      status: "ACTIVE",
    });
    // 非某店区分（別店・別店2）での登場 2 回。某店の 1 回は数えない
    const { input } = build(c, target);
    expect(input.stats[song.id].appearanceCount).toBe(2);
  });
});

describe("buildEngineInput: 最終演奏日・演奏回数・コール回数", () => {
  it("最終演奏日は participated=true の演奏のみから求める", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Song Y");

    const s1 = insertSession(c, { date: "2026-06-20", venueId: home.id });
    const s2 = insertSession(c, { date: "2026-06-25", venueId: home.id });
    insertPerformance(c, {
      sessionId: s1.id,
      songId: song.id,
      orderIndex: 1,
      participated: true,
    });
    // より新しいが不参加 → 最終演奏日は 2026-06-20 のまま
    insertPerformance(c, { sessionId: s2.id, songId: song.id, orderIndex: 1 });

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    const { input } = build(c, target);
    // 2026-06-20 → 2026-07-12 = 22 日
    expect(input.stats[song.id].daysSinceLastPlayed).toBe(22);
  });

  it("participated の演奏が無い曲は daysSinceLastPlayed=null（履歴なし）", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Song Z");
    const s1 = insertSession(c, { date: "2026-06-20", venueId: home.id });
    insertPerformance(c, { sessionId: s1.id, songId: song.id, orderIndex: 1 });

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    const { input } = build(c, target);
    expect(input.stats[song.id].daysSinceLastPlayed).toBeNull();
    expect(input.stats[song.id].myPlayCount).toBe(0);
    expect(input.stats[song.id].appearanceCount).toBe(1);
  });

  it("演奏履歴が一切ない曲は {0, null, 0, 0}", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Never Played");
    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    const { input } = build(c, target);
    expect(input.stats[song.id]).toEqual({
      appearanceCount: 0,
      daysSinceLastPlayed: null,
      myPlayCount: 0,
      myCallCount: 0,
    });
  });

  it("myPlayCount=participated 合計 / myCallCount=called_by_me 合計（期間無制限）", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Song W");
    const s1 = insertSession(c, { date: "2020-01-01", venueId: home.id });
    const s2 = insertSession(c, { date: "2026-06-20", venueId: home.id });
    insertPerformance(c, {
      sessionId: s1.id,
      songId: song.id,
      orderIndex: 1,
      participated: true,
      calledByMe: true,
    });
    insertPerformance(c, {
      sessionId: s2.id,
      songId: song.id,
      orderIndex: 1,
      participated: true,
    });
    insertPerformance(c, {
      sessionId: s2.id,
      songId: song.id,
      orderIndex: 2,
      calledByMe: true,
    });

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    const { input } = build(c, target);
    expect(input.stats[song.id].myPlayCount).toBe(2);
    expect(input.stats[song.id].myCallCount).toBe(2);
  });
});

describe("buildEngineInput: 累計コール上位N曲", () => {
  it("count DESC・song_id ASC の決定的タイブレークで上位 N 曲を返す", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const a = insertSong(c, "Called A");
    const b = insertSong(c, "Called B");
    const d = insertSong(c, "Called C");
    const s1 = insertSession(c, { date: "2026-06-20", venueId: home.id });
    let order = 1;
    for (const [songId, times] of [
      [a.id, 2],
      [b.id, 2],
      [d.id, 1],
    ] as const) {
      for (let i = 0; i < times; i++) {
        insertPerformance(c, {
          sessionId: s1.id,
          songId,
          orderIndex: order++,
          calledByMe: true,
        });
      }
    }

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    // 同数 2 回の A/B は song_id 昇順、次に 1 回の C
    expect(build(c, target).input.topCalledSongIds).toEqual([a.id, b.id, d.id]);
    // topCalledN=2 なら上位 2 曲のみ
    expect(build(c, target, { topCalledN: 2 }).input.topCalledSongIds).toEqual([
      a.id,
      b.id,
    ]);
  });
});

describe("buildEngineInput: ジャンル別コール比率", () => {
  it("全ジャンルを 0 で初期化し、コール比率で埋める", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const ballad = insertSong(c, "Ballad Song");
    const bossa = insertSong(c, "Bossa Song");
    const plain = insertSong(c, "Plain Song");
    tagSong(c, ballad.id, ["バラード"]);
    tagSong(c, bossa.id, ["ボサノバ"]);

    const s1 = insertSession(c, { date: "2026-06-20", venueId: home.id });
    // 総コール 4 回: バラード曲 2 / ボサノバ曲 1 / 無ジャンル曲 1
    insertPerformance(c, { sessionId: s1.id, songId: ballad.id, orderIndex: 1, calledByMe: true });
    insertPerformance(c, { sessionId: s1.id, songId: ballad.id, orderIndex: 2, calledByMe: true });
    insertPerformance(c, { sessionId: s1.id, songId: bossa.id, orderIndex: 3, calledByMe: true });
    insertPerformance(c, { sessionId: s1.id, songId: plain.id, orderIndex: 4, calledByMe: true });

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    const { input } = build(c, target);
    // 全 9 ジャンルのキーが必ず存在する（handoff-notes: 無いジャンルの減点スキップを防ぐ）
    expect(Object.keys(input.genreCallRatios).sort()).toEqual(
      [
        "バラード",
        "ボサノバ",
        "3拍子",
        "モード",
        "ファンク",
        "ブルース",
        "歌もの",
        "循環",
        "キメが多い曲",
      ].sort(),
    );
    expect(input.genreCallRatios["バラード"]).toBeCloseTo(0.5);
    expect(input.genreCallRatios["ボサノバ"]).toBeCloseTo(0.25);
    expect(input.genreCallRatios["モード"]).toBe(0);
  });

  it("総コール数 0 のときは空 Record（全ジャンル一律減点を避ける安全側）", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    insertSong(c, "Song X");
    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    expect(build(c, target).input.genreCallRatios).toEqual({});
  });
});

describe("buildEngineInput: 当日演奏済み・直前 Performance・保留曲", () => {
  it("当日演奏済み集合は対象セッションの演奏のみ", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const today = insertSong(c, "Today Song");
    const past = insertSong(c, "Past Song");
    const s1 = insertSession(c, { date: "2026-06-20", venueId: home.id });
    insertPerformance(c, { sessionId: s1.id, songId: past.id, orderIndex: 1 });

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    insertPerformance(c, { sessionId: target.id, songId: today.id, orderIndex: 1 });

    const { input } = build(c, target);
    expect(input.playedTodaySongIds).toEqual([today.id]);
  });

  it("直前 Performance = order_index 最大の行（曲属性 + フロント編成を position 順で）", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const first = insertSong(c, "First Song");
    const lastSong = insertSong(c, "Last Song", {
      songKey: "F",
      form: "ABAC",
      composer: "Monk",
      inKurobon1: true,
      season: "SUMMER",
    });
    tagSong(c, lastSong.id, ["歌もの"]);

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    insertPerformance(c, { sessionId: target.id, songId: first.id, orderIndex: 1 });
    const lastPerf = insertPerformance(c, {
      sessionId: target.id,
      songId: lastSong.id,
      orderIndex: 2,
    });
    c.db
      .insert(c.schema.performanceFrontInstruments)
      .values([
        { performanceId: lastPerf.id, instrumentCode: "vo", position: 0 },
        { performanceId: lastPerf.id, instrumentCode: "as", position: 1 },
      ])
      .run();

    const { input } = build(c, target);
    expect(input.previousPerformance).toEqual({
      songKey: "F",
      form: "ABAC",
      composer: "Monk",
      genres: ["歌もの"],
      inKurobon1: true,
      season: "SUMMER",
      frontInstruments: ["vo", "as"],
    });
  });

  it("直前 Performance のフロント編成が未入力（0件）なら frontInstruments=null", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Song X");
    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    insertPerformance(c, { sessionId: target.id, songId: song.id, orderIndex: 1 });

    const { input } = build(c, target);
    expect(input.previousPerformance?.frontInstruments).toBeNull();
  });

  it("演奏記録が無い（1曲目）なら previousPerformance=null", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    insertSong(c, "Song X");
    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    expect(build(c, target).input.previousPerformance).toBeNull();
  });

  it("保留曲の song_id が pendingSongIds に入る", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Pending Song");
    c.db.insert(c.schema.pendingSongs).values({ songId: song.id }).run();
    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    expect(build(c, target).input.pendingSongIds).toEqual([song.id]);
  });
});

describe("buildEngineInput: インポート相当の履歴反映（基準9 前倒し・DBレベル）", () => {
  it("直接 INSERT した過去履歴（unit-08 インポートの最終形）が登場回数・久しぶり度に反映される", async () => {
    const c = await ctx();
    const home = insertVenue(c, "某店", true);
    const song = insertSong(c, "Imported Song");

    // unit-08 の CSV インポートは最終的に sessions/performances 行になる
    const imported1 = insertSession(c, { date: "2026-06-15", venueId: home.id });
    const imported2 = insertSession(c, { date: "2026-06-25", venueId: home.id });
    insertPerformance(c, {
      sessionId: imported1.id,
      songId: song.id,
      orderIndex: 1,
      participated: true,
    });
    insertPerformance(c, { sessionId: imported2.id, songId: song.id, orderIndex: 1 });

    const target = insertSession(c, {
      date: SESSION_DATE,
      venueId: home.id,
      status: "ACTIVE",
    });
    const { input } = build(c, target);
    expect(input.stats[song.id].appearanceCount).toBe(2);
    // 最終演奏（participated）2026-06-15 → 27 日前
    expect(input.stats[song.id].daysSinceLastPlayed).toBe(27);
  });
});
