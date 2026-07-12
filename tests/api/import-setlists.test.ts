/**
 * 成功基準2: setlists.csv の正常取込（date+venue_name でセッション集約・order 順演奏記録。
 *            約5,000行のフィクスチャで検証）
 * 成功基準9: performances が session 経由で正しい日付・called_by_me を持つ
 * 成功基準11: front_instruments が position 順で PerformanceFrontInstrument に保存される
 */
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  csvUploadRequest,
  jsonRequest,
  routeParams,
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

const SET_HEADER =
  "date,venue_name,order,title,participated,instrument,called_by_me,no_chart,memo,front_instruments";

async function upload(csv: string) {
  const { POST } = await import("@/app/api/import/[type]/route");
  return POST(csvUploadRequest("/api/import/setlists", csv), routeParams({ type: "setlists" }));
}
async function saveResolutions(jobId: number, body: unknown) {
  const { POST } = await import("@/app/api/import/jobs/[jobId]/resolutions/route");
  return POST(
    jsonRequest(`/api/import/jobs/${jobId}/resolutions`, "POST", body),
    routeParams({ jobId: String(jobId) }),
  );
}
async function commit(jobId: number, body: unknown = {}) {
  const { POST } = await import("@/app/api/import/jobs/[jobId]/commit/route");
  return POST(
    jsonRequest(`/api/import/jobs/${jobId}/commit`, "POST", body),
    routeParams({ jobId: String(jobId) }),
  );
}

/** 曲マスターを事前投入（setlists の title 自動 match 用） */
async function seedSongs(titles: string[]) {
  const db = await testDb();
  const { songs } = await import("@/db/schema");
  const { normalizeTitle } = await import("@/lib/normalize-title");
  for (const t of titles) {
    db.insert(songs)
      .values({ title: t, titleNormalized: normalizeTitle(t) })
      .run();
  }
}

describe("POST /api/import/setlists（大規模取込）", () => {
  it("約5,000行を date+venue で集約し order 順に演奏記録を作る（基準2）", async () => {
    const TITLES = Array.from({ length: 20 }, (_, i) => `Song ${i}`);
    await seedSongs(TITLES);

    const ROWS = 5000;
    const PER_SESSION = 100; // → 50 セッション
    const lines = [SET_HEADER];
    for (let i = 0; i < ROWS; i++) {
      const sessionIdx = Math.floor(i / PER_SESSION);
      const day = String((sessionIdx % 28) + 1).padStart(2, "0");
      const month = String(Math.floor(sessionIdx / 28) + 1).padStart(2, "0");
      const date = `2024-${month}-${day}`;
      const venue = `Venue ${sessionIdx % 2}`;
      const order = (i % PER_SESSION) + 1;
      const title = TITLES[i % TITLES.length];
      const participated = i % 2 === 0 ? "1" : "0";
      const instrument = i % 2 === 0 ? "sax" : "";
      const front = i % 2 === 0 ? "vo|as" : "";
      lines.push(
        `${date},${venue},${order},${title},${participated},${instrument},1,0,,${front}`,
      );
    }

    const body = await (await upload(lines.join("\n"))).json();
    expect(body.totalRows).toBe(ROWS);
    expect(body.validRows).toBe(ROWS);
    // Venue 0/1 が未知 → is_home 解決が必要
    expect(body.unknowns.venues.sort()).toEqual(["Venue 0", "Venue 1"]);
    // title は全て master 一致 → 未知 title なし
    expect(body.unknowns.titles).toHaveLength(0);

    await saveResolutions(body.job.id, {
      venues: { "Venue 0": true, "Venue 1": false },
      titles: {},
    });
    const summary = (await (await commit(body.job.id)).json()).summary;
    expect(summary.sessionsCreated).toBe(50);
    expect(summary.performancesCreated).toBe(ROWS);
    expect(summary.venuesCreated).toBe(2);
    expect(summary.skippedRows).toBe(0);

    const db = await testDb();
    const { performances, sessions } = await import("@/db/schema");
    const totalPerf = db.select().from(performances).all();
    expect(totalPerf).toHaveLength(ROWS);
    const totalSessions = db.select().from(sessions).all();
    expect(totalSessions).toHaveLength(50);
    // 全セッションが ENDED（履歴取込）
    expect(totalSessions.every((s) => s.status === "ENDED")).toBe(true);

    // 1 セッションの order 連番検証（1..100）
    const first = totalSessions[0];
    const rows = db
      .select()
      .from(performances)
      .where(eq(performances.sessionId, first.id))
      .orderBy(asc(performances.orderIndex))
      .all();
    expect(rows).toHaveLength(PER_SESSION);
    expect(rows.map((r) => r.orderIndex)).toEqual(
      Array.from({ length: PER_SESSION }, (_, i) => i + 1),
    );
  });

  it("performances が session 経由の日付・called_by_me を持つ（基準9）+ front 順序保存（基準11）", async () => {
    await seedSongs(["Alone Together", "Blue Bossa"]);
    const csv = `${SET_HEADER}
2024-05-12,某店,1,Alone Together,1,sax,1,0,,vo|as|as
2024-05-12,某店,2,Blue Bossa,0,,0,1,,`;
    const body = await (await upload(csv)).json();
    await saveResolutions(body.job.id, { venues: { 某店: true }, titles: {} });
    await commit(body.job.id);

    const db = await testDb();
    const { performances, sessions, performanceFrontInstruments, songs } =
      await import("@/db/schema");

    const session = db.select().from(sessions).all()[0];
    expect(session.sessionDate).toBe("2024-05-12");

    const alone = db
      .select({ id: songs.id })
      .from(songs)
      .where(eq(songs.title, "Alone Together"))
      .get()!;
    const perf = db
      .select()
      .from(performances)
      .where(
        and(
          eq(performances.sessionId, session.id),
          eq(performances.songId, alone.id),
        ),
      )
      .get()!;
    expect(perf.calledByMe).toBe(true);
    expect(perf.instrument).toBe("SAX");
    expect(perf.participated).toBe(true);

    // front_instruments が position 0.. で順序どおり保存（vo, as, as）
    const fronts = db
      .select()
      .from(performanceFrontInstruments)
      .where(eq(performanceFrontInstruments.performanceId, perf.id))
      .orderBy(asc(performanceFrontInstruments.position))
      .all();
    expect(fronts.map((f) => [f.position, f.instrumentCode])).toEqual([
      [0, "vo"],
      [1, "as"],
      [2, "as"],
    ]);
  });
});
