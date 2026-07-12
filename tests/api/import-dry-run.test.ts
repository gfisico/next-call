/**
 * 成功基準5: dry-run が DB 無変更で差分サマリを返す（前後で全テーブル件数不変）
 */
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  csvUploadRequest,
  getRequest,
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
const SONGS_HEADER =
  "title,key,form,composer,has_played,no_chart_ok,is_standard,simple_form,in_kurobon1,season,listener_level,energy_level,genres,note";

const TABLES = [
  "songs",
  "song_genre_tags",
  "venues",
  "sessions",
  "performances",
  "performance_front_instruments",
];

async function tableCounts(): Promise<Record<string, number>> {
  const db = await testDb();
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const r = db.get(sql.raw(`select count(*) as n from ${t}`)) as { n: number };
    out[t] = r.n;
  }
  return out;
}

async function uploadSetlists(csv: string) {
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
async function dryRun(jobId: number) {
  const { GET } = await import("@/app/api/import/jobs/[jobId]/dry-run/route");
  return GET(getRequest(`/api/import/jobs/${jobId}/dry-run`), routeParams({ jobId: String(jobId) }));
}

describe("GET /api/import/jobs/:jobId/dry-run", () => {
  it("dry-run 前後で全テーブル件数が不変（基準5）", async () => {
    const { POST } = await import("@/app/api/import/[type]/route");
    // songs ジョブと setlists ジョブの両方を用意
    const songsRes = await POST(
      csvUploadRequest(
        "/api/import/songs",
        `${SONGS_HEADER}
New Song A,C,AABA,,0,0,0,0,0,通年,3,3,,
New Song B,F,OTHER,,0,0,0,0,0,通年,3,3,歌もの,`,
      ),
      routeParams({ type: "songs" }),
    );
    const songsJob = (await songsRes.json()).job.id;

    const setBody = await (await uploadSetlists(`${SET_HEADER}
2024-07-01,店A,1,Some Tune,1,sax,0,0,,as
2024-07-01,店A,2,Other Tune,0,,0,0,,`)).json();
    await saveResolutions(setBody.job.id, {
      venues: { 店A: true },
      titles: {
        "Some Tune": { action: "create_stub" },
        "Other Tune": { action: "skip" },
      },
    });

    const before = await tableCounts();

    const songsSummary = (await (await dryRun(songsJob)).json()).summary;
    expect(songsSummary).toMatchObject({
      type: "songs",
      songsToCreate: 2,
      songsToUpdate: 0,
    });

    const setRes = await dryRun(setBody.job.id);
    expect(setRes.status).toBe(200);
    const setSummary = (await setRes.json()).summary;
    expect(setSummary).toMatchObject({
      type: "setlists",
      venuesToCreate: 1,
      sessionsToCreate: 1,
      performancesToCreate: 1, // create_stub 行のみ（skip 除外）
      skippedRows: 1,
      stubsToCreate: 1,
      duplicateSessions: 0,
      unresolvedVenues: 0,
    });

    const after = await tableCounts();
    expect(after).toEqual(before);
  });
});
