/**
 * 基準7（unit-04）: 曲500・演奏記録5,000件のシードデータで
 * POST /api/sessions/:id/recommendations の p95 < 2秒
 *
 * - 決定的ジェネレータで一時DBへトランザクション一括 INSERT
 * - Route Handler を warm-up 1回 → 20回実行し p95 を算出
 * - intent/条件を回ごとに変えて現実的な分布にする（履歴も 20 リクエスト分成長する）
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonRequest, routeParams, setupTestDb, teardownTestDb, testDb } from "./helpers";

beforeEach(async () => {
  await setupTestDb();
});

afterEach(() => {
  teardownTestDb();
});

const SONG_COUNT = 500;
const PERFORMANCE_COUNT = 5000;
const KEYS = ["C", "F", "Bb", "Eb", "G", "D", "A", "Ab"];
const FORMS = ["AABA", "ABAC", "BLUES12", "OTHER"] as const;
const SEASONS = ["SPRING", "SUMMER", "AUTUMN", "WINTER", "ALL"] as const;
const COMPOSERS = ["Monk", "Ellington", "Parker", "Davis", "Shorter", null];

/** YYYY-MM-DD の days 日前 */
function dateDaysBefore(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime();
  return new Date(t - days * 86_400_000).toISOString().slice(0, 10);
}

const SESSION_DATE = "2026-07-12";

/** 曲500・店舗2・セッション~100・演奏5,000 を決定的に一括投入し ACTIVE セッションを返す */
async function seedLargeDataset(): Promise<number> {
  const db = await testDb();
  const schema = await import("@/db/schema");

  return db.transaction((tx) => {
    const home = tx
      .insert(schema.venues)
      .values({ name: "某店", isHome: true })
      .returning()
      .get();
    const other = tx
      .insert(schema.venues)
      .values({ name: "別店", isHome: false })
      .returning()
      .get();

    // 曲 500（キー・構成・ジャンル・属性を分散）
    const genreTagRows = tx.select().from(schema.genreTags).all();
    const songIds: number[] = [];
    for (let i = 1; i <= SONG_COUNT; i++) {
      const song = tx
        .insert(schema.songs)
        .values({
          title: `Perf Song ${String(i).padStart(3, "0")}`,
          titleNormalized: `perf song ${String(i).padStart(3, "0")}`,
          songKey: KEYS[i % KEYS.length],
          form: FORMS[i % FORMS.length],
          composer: COMPOSERS[i % COMPOSERS.length],
          hasPlayed: i % 10 !== 0, // 9割がコール可能
          noChartOk: i % 2 === 0,
          isStandard: i % 3 === 0,
          simpleForm: i % 4 === 0,
          inKurobon1: i % 2 === 0,
          season: SEASONS[i % SEASONS.length],
          listenerLevel: (i % 5) + 1,
          energyLevel: ((i * 7) % 5) + 1,
        })
        .returning()
        .get();
      songIds.push(song.id);
      if (i % 3 === 0) {
        tx.insert(schema.songGenreTags)
          .values({
            songId: song.id,
            genreTagId: genreTagRows[i % genreTagRows.length].id,
          })
          .run();
      }
    }

    // 過去セッション 100（店舗 home/other 交互、直近 ~2 年に分散）
    const sessionIds: number[] = [];
    for (let i = 1; i <= 100; i++) {
      const session = tx
        .insert(schema.sessions)
        .values({
          sessionDate: dateDaysBefore(SESSION_DATE, (i * 7) % 730),
          venueId: i % 2 === 0 ? home.id : other.id,
          status: "ENDED",
        })
        .returning()
        .get();
      sessionIds.push(session.id);
    }

    // 演奏 5,000（participated / called_by_me を分散）
    const rows = [];
    for (let i = 1; i <= PERFORMANCE_COUNT; i++) {
      rows.push({
        sessionId: sessionIds[i % sessionIds.length],
        songId: songIds[(i * 13) % SONG_COUNT],
        orderIndex: Math.floor(i / sessionIds.length) + 1,
        participated: i % 3 === 0,
        calledByMe: i % 5 === 0,
      });
    }
    for (let i = 0; i < rows.length; i += 500) {
      tx.insert(schema.performances)
        .values(rows.slice(i, i + 500))
        .run();
    }

    // 対象の ACTIVE セッション（当日演奏 3 件 + 直前曲）
    const active = tx
      .insert(schema.sessions)
      .values({ sessionDate: SESSION_DATE, venueId: home.id, status: "ACTIVE" })
      .returning()
      .get();
    for (let i = 0; i < 3; i++) {
      tx.insert(schema.performances)
        .values({
          sessionId: active.id,
          songId: songIds[i],
          orderIndex: i + 1,
          participated: i === 0,
          calledByMe: i === 1,
        })
        .run();
    }
    return active.id;
  });
}

/** 回ごとに intent/条件を変える（現実的な分布 + 履歴の成長も含めて計測する） */
function bodyForRun(i: number) {
  const slider = (n: number) => ((n % 5) - 2) as number;
  return {
    conditions: {
      horns: (["ONE", "MULTI", "UNKNOWN"] as const)[i % 3],
      beginner: (["NONE", "PRESENT", "UNKNOWN"] as const)[(i + 1) % 3],
    },
    constraints: {
      kurobon1Only: i % 4 === 0,
      genreOverride: i % 3 === 0 ? ["バラード"] : [],
    },
    intent: {
      rare: slider(i),
      fresh: slider(i + 1),
      safety: slider(i + 2),
      mood: slider(i + 3),
      ballad: slider(i + 4),
      seasonal: i % 2 === 0,
      listener: i % 3 === 0,
    },
  };
}

describe("推薦 API の応答時間（基準7）", () => {
  it("曲500・演奏5,000で 20回実行の p95 < 2秒", async () => {
    const sessionId = await seedLargeDataset();
    const { POST } = await import(
      "@/app/api/sessions/[id]/recommendations/route"
    );
    const run = async (i: number) => {
      const t0 = performance.now();
      const res = await POST(
        jsonRequest(
          `/api/sessions/${sessionId}/recommendations`,
          "POST",
          bodyForRun(i),
        ),
        routeParams({ id: String(sessionId) }),
      );
      const elapsed = performance.now() - t0;
      expect(res.status).toBe(201);
      return elapsed;
    };

    // warm-up 1回（モジュール初期化・JIT を除外）
    await run(0);

    const times: number[] = [];
    for (let i = 1; i <= 20; i++) {
      times.push(await run(i));
    }
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    expect(p95).toBeLessThan(2000);
  }, 120_000);
});
