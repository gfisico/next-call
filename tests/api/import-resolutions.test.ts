/**
 * 成功基準4: 未知 venue の is_home 解決、曲名不一致の match/create_stub/skip 解決が
 *            コミットに反映される（create_stub は needs_review=true）
 * 近似候補（完全一致→正規化一致→部分一致・最大3件）の順序検証
 */
import { eq } from "drizzle-orm";
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

describe("インポート解決（venue / 曲名）", () => {
  it("venue is_home・title match/create_stub/skip がコミットに反映される（基準4）", async () => {
    const existing = await insertSong("Autumn Leaves");
    const csv = `${SET_HEADER}
2024-06-01,新店,1,Autumn Leaves,1,sax,0,0,,
2024-06-01,新店,2,Totally New Tune,1,sax,0,0,,
2024-06-01,新店,3,Skip This One,0,,0,0,,`;
    const preview = await (await upload(csv)).json();
    // 未知 venue「新店」、master 一致「Autumn Leaves」は自動 match → 未知 title は残り2曲
    expect(preview.unknowns.venues).toEqual(["新店"]);
    const unknownTitles = preview.unknowns.titles.map(
      (t: { csvTitle: string }) => t.csvTitle,
    );
    expect(unknownTitles.sort()).toEqual(["Skip This One", "Totally New Tune"].sort());

    await saveResolutions(preview.job.id, {
      venues: { 新店: false },
      titles: {
        "Totally New Tune": { action: "create_stub" },
        "Skip This One": { action: "skip" },
      },
    });
    const summary = (await (await commit(preview.job.id)).json()).summary;
    expect(summary.venuesCreated).toBe(1);
    expect(summary.stubsCreated).toBe(1);
    expect(summary.skippedRows).toBe(1);
    expect(summary.sessionsCreated).toBe(1);
    expect(summary.performancesCreated).toBe(2); // Autumn Leaves + stub（skip 除外）

    const db = await testDb();
    const { venues, songs, performances } = await import("@/db/schema");

    // venue is_home=false で作成
    const venue = db.select().from(venues).where(eq(venues.name, "新店")).get()!;
    expect(venue.isHome).toBe(false);

    // create_stub は needs_review=true
    const stub = db
      .select()
      .from(songs)
      .where(eq(songs.title, "Totally New Tune"))
      .get()!;
    expect(stub.needsReview).toBe(true);
    expect(stub.hasPlayed).toBe(false);

    // skip 曲は作成されない
    const skipped = db
      .select()
      .from(songs)
      .where(eq(songs.title, "Skip This One"))
      .get();
    expect(skipped).toBeUndefined();

    // match は既存曲を使う（新規作成しない）
    const perfSongIds = db
      .select({ songId: performances.songId })
      .from(performances)
      .all()
      .map((r) => r.songId);
    expect(perfSongIds).toContain(existing.id);
    expect(perfSongIds).not.toContain(undefined);
  });

  it("未解決の未知 venue があるとコミットは 400 で失敗する", async () => {
    await insertSong("Some Song");
    const csv = `${SET_HEADER}
2024-06-01,謎店,1,Some Song,1,sax,0,0,,`;
    const preview = await (await upload(csv)).json();
    // resolutions を保存せずコミット
    const res = await commit(preview.job.id);
    expect(res.status).toBe(400);
  });

  it("近似候補は 完全一致→正規化一致→部分一致 の順で最大3件（順序検証）", async () => {
    const exact = await insertSong("Blue Bossa"); // 完全一致
    const normalized = await insertSong("Blue  Bossa"); // 正規化一致（原文は別）
    const partial = await insertSong("Blue Bossa Nova"); // 部分一致
    await insertSong("Totally Unrelated");

    const { rankTitleCandidates } = await import("@/server/import/preview");
    const db = await testDb();
    const candidates = rankTitleCandidates(db, "Blue Bossa", 3);

    expect(candidates.map((c) => c.matchType)).toEqual([
      "exact",
      "normalized",
      "partial",
    ]);
    expect(candidates[0].songId).toBe(exact.id);
    expect(candidates[1].songId).toBe(normalized.id);
    expect(candidates[2].songId).toBe(partial.id);
  });
});
