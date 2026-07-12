/**
 * 成功基準6: コミットは単一トランザクション（途中失敗で部分取込が残らない）
 * 成功基準7: 同一 date+venue の二重取込がエラーで防がれる
 * 成功基準8: recalc_has_played で participated=1 の曲の has_played が ON になる
 * + 1ジョブ2回目 commit は 409
 */
import { eq, sql } from "drizzle-orm";
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
async function insertSong(title: string, attrs: Record<string, unknown> = {}) {
  const db = await testDb();
  const { songs } = await import("@/db/schema");
  const { normalizeTitle } = await import("@/lib/normalize-title");
  return db
    .insert(songs)
    .values({ title, titleNormalized: normalizeTitle(title), ...attrs })
    .returning()
    .get();
}
async function count(table: string): Promise<number> {
  const db = await testDb();
  return (db.get(sql.raw(`select count(*) as n from ${table}`)) as { n: number }).n;
}

describe("インポートコミット（トランザクション・冪等性）", () => {
  it("途中で失敗（未知 front コード）すると部分取込が残らない（基準6）", async () => {
    await insertSong("Song One");
    await insertSong("Song Two");
    // 2 セッション。2つ目のセッションの行に未知 front コードを含める
    const csv = `${SET_HEADER}
2024-08-01,店X,1,Song One,1,sax,0,0,,vo
2024-08-02,店X,1,Song Two,1,sax,0,0,,zzz`;
    const body = await (await upload(csv)).json();
    await saveResolutions(body.job.id, { venues: { 店X: true }, titles: {} });

    const res = await commit(body.job.id);
    expect(res.status).toBe(400);

    // 部分取込ゼロ（最初のセッションもロールバック）
    expect(await count("sessions")).toBe(0);
    expect(await count("performances")).toBe(0);
    expect(await count("venues")).toBe(0);
    expect(await count("performance_front_instruments")).toBe(0);

    // ジョブは PREVIEW のまま（COMMITTED になっていない）
    const db = await testDb();
    const { importJobs } = await import("@/db/schema");
    const job = db.select().from(importJobs).where(eq(importJobs.id, body.job.id)).get()!;
    expect(job.status).toBe("PREVIEW");
  });

  it("既存と重複する date+venue でコミットすると 409 + 全ロールバック（基準6,7）", async () => {
    await insertSong("Song A");
    await insertSong("Song B");
    // 1回目: 2024-09-02/店Y を先に取込
    const first = await (await upload(`${SET_HEADER}
2024-09-02,店Y,1,Song A,1,sax,0,0,,`)).json();
    await saveResolutions(first.job.id, { venues: { 店Y: true }, titles: {} });
    await commit(first.job.id);
    expect(await count("sessions")).toBe(1);

    const sessionsBefore = await count("sessions");
    const perfBefore = await count("performances");

    // 2回目: 新規セッション(09-01) + 重複セッション(09-02) を含む
    const second = await (await upload(`${SET_HEADER}
2024-09-01,店Y,1,Song B,1,sax,0,0,,
2024-09-02,店Y,1,Song A,1,sax,0,0,,`)).json();
    await saveResolutions(second.job.id, { venues: {}, titles: {} });
    const res = await commit(second.job.id);
    expect(res.status).toBe(409);

    // 09-01 の新規セッションも作られていない（単一トランザクションのロールバック）
    expect(await count("sessions")).toBe(sessionsBefore);
    expect(await count("performances")).toBe(perfBefore);
  });

  it("同一 CSV の二重取込は 2回目コミットで 409（基準7）", async () => {
    await insertSong("Repeat Song");
    const csv = `${SET_HEADER}
2024-10-01,店Z,1,Repeat Song,1,sax,0,0,,`;

    const j1 = await (await upload(csv)).json();
    await saveResolutions(j1.job.id, { venues: { 店Z: true }, titles: {} });
    expect((await commit(j1.job.id)).status).toBe(200);

    const j2 = await (await upload(csv)).json();
    await saveResolutions(j2.job.id, { venues: {}, titles: {} });
    expect((await commit(j2.job.id)).status).toBe(409);
  });

  it("recalc_has_played で participated=1 の曲の has_played が ON（基準8）", async () => {
    const played = await insertSong("Played Song", { hasPlayed: false });
    const notPlayed = await insertSong("Watched Song", { hasPlayed: false });
    const csv = `${SET_HEADER}
2024-11-01,店W,1,Played Song,1,sax,0,0,,
2024-11-01,店W,2,Watched Song,0,,0,0,,`;
    const body = await (await upload(csv)).json();
    await saveResolutions(body.job.id, { venues: { 店W: true }, titles: {} });
    const summary = (await (await commit(body.job.id, { recalcHasPlayed: true })).json()).summary;
    expect(summary.hasPlayedRecalculated).toBe(1);

    const db = await testDb();
    const { songs } = await import("@/db/schema");
    const p = db.select().from(songs).where(eq(songs.id, played.id)).get()!;
    const w = db.select().from(songs).where(eq(songs.id, notPlayed.id)).get()!;
    expect(p.hasPlayed).toBe(true); // participated=1 → ON
    expect(w.hasPlayed).toBe(false); // participated=0 → 変化なし
  });

  it("recalc_has_played=false（既定）なら has_played は変えない", async () => {
    const song = await insertSong("Untouched", { hasPlayed: false });
    const csv = `${SET_HEADER}
2024-12-01,店V,1,Untouched,1,sax,0,0,,`;
    const body = await (await upload(csv)).json();
    await saveResolutions(body.job.id, { venues: { 店V: true }, titles: {} });
    await commit(body.job.id, {});

    const db = await testDb();
    const { songs } = await import("@/db/schema");
    const s = db.select().from(songs).where(eq(songs.id, song.id)).get()!;
    expect(s.hasPlayed).toBe(false);
  });

  it("1ジョブ2回目の commit は 409（COMMITTED）", async () => {
    await insertSong("Once Song");
    const csv = `${SET_HEADER}
2025-01-01,店U,1,Once Song,1,sax,0,0,,`;
    const body = await (await upload(csv)).json();
    await saveResolutions(body.job.id, { venues: { 店U: true }, titles: {} });
    expect((await commit(body.job.id)).status).toBe(200);
    // 同じジョブを再コミット
    expect((await commit(body.job.id)).status).toBe(409);
  });
});
