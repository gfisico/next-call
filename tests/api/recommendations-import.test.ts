/**
 * 基準9（unit-04 / unit-08 連携）: CSV インポート API 経由で取り込んだ過去履歴が
 * 登場回数・久しぶり度の集計に反映されることを end-to-end で検証する結合テスト。
 *
 * DB レベルの同等検証（過去 sessions/performances の直接 INSERT が集計へ反映される）は
 * tests/api/recommendation-input.test.ts「インポート相当の履歴反映」で実装済み。
 * ここでは unit-08 の実 API（アップロード→コミット）を通した再検証を行う。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeConditions, makeIntent } from "../engine/helpers";
import {
  csvUploadRequest,
  jsonRequest,
  routeParams,
  setupTestDb,
  teardownTestDb,
  testDb,
} from "./helpers";

/** unit-08 のアップロード Route が存在するか（実ルート: import/[type]/route.ts） */
function importRouteExists(): boolean {
  return existsSync(
    path.join(process.cwd(), "src", "app", "api", "import", "[type]", "route.ts"),
  );
}

const SESSION_DATE = "2026-07-12";
const WINDOW_DAYS = 30;
const SET_HEADER =
  "date,venue_name,order,title,participated,instrument,called_by_me,no_chart,memo,front_instruments";

beforeEach(async () => {
  await setupTestDb();
});
afterEach(() => {
  teardownTestDb();
});

async function upload(csv: string) {
  const { POST } = await import("@/app/api/import/[type]/route");
  return POST(csvUploadRequest("/api/import/setlists", csv), routeParams({ type: "setlists" }));
}
async function commit(jobId: number) {
  const { POST } = await import("@/app/api/import/jobs/[jobId]/commit/route");
  return POST(
    jsonRequest(`/api/import/jobs/${jobId}/commit`, "POST", {}),
    routeParams({ jobId: String(jobId) }),
  );
}

describe("インポート済み履歴の集計反映（基準9 / unit-08 結合）", () => {
  it("unit-08 のインポート Route が実装済みである（scaffold 有効化の前提）", () => {
    expect(importRouteExists()).toBe(true);
  });

  it("CSV インポート API 経由の履歴が登場回数・久しぶり度に反映される", async () => {
    const db = await testDb();
    const schema = await import("@/db/schema");
    const { normalizeTitle } = await import("@/lib/normalize-title");
    const { buildEngineInput } = await import(
      "@/server/recommendation/build-input"
    );

    // 某店（home）と対象曲を事前作成（venue は import で解決不要にする）
    const home = db
      .insert(schema.venues)
      .values({ name: "某店", isHome: true })
      .returning()
      .get();
    const song = db
      .insert(schema.songs)
      .values({ title: "Imported Song", titleNormalized: normalizeTitle("Imported Song") })
      .returning()
      .get();

    // 過去履歴 2 セッションを CSV インポート（1つは participated=1）
    const csv = `${SET_HEADER}
2026-06-15,某店,1,Imported Song,1,sax,0,0,,
2026-06-25,某店,1,Imported Song,0,,0,0,,`;
    const body = await (await upload(csv)).json();
    expect(body.unknowns.venues).toHaveLength(0); // 某店は既知
    expect(body.unknowns.titles).toHaveLength(0); // Imported Song は既知
    const commitRes = await commit(body.job.id);
    expect(commitRes.status).toBe(200);

    // ACTIVE 対象セッション（某店）を作成
    const target = db
      .insert(schema.sessions)
      .values({ sessionDate: SESSION_DATE, venueId: home.id, status: "ACTIVE" })
      .returning()
      .get();

    const { input } = buildEngineInput({
      dbx: db,
      session: target,
      conditions: makeConditions(),
      intent: makeIntent(),
      currentSeason: "SUMMER",
      appearanceWindowDays: WINDOW_DAYS,
      topCalledN: 10,
      repeatParams: { recentCount: 5, windowDays: 30 },
      signature: "test-signature",
    });

    // 某店・期間内の 2 セッションで登場 → 2
    expect(input.stats[song.id].appearanceCount).toBe(2);
    // 最終 participated 演奏 2026-06-15 → 27 日前
    expect(input.stats[song.id].daysSinceLastPlayed).toBe(27);
  });
});

describe("実データ抽出→取込リハーサル（基準12・存在ガード付き）", () => {
  const REAL_XLSX = "/Users/fisico/Downloads/やれる曲.xlsx";

  it.skipIf(!existsSync(REAL_XLSX))(
    "やれる曲.xlsx を抽出→ import→（dry-run まで）通す",
    async () => {
      const ExcelJS = (await import("exceljs")).default;
      const { extractWorkbook } = await import("../../scripts/extract-excel");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(REAL_XLSX);
      const extracted = extractWorkbook(wb);
      // 警告は人間確認用にログへ
      console.log(
        `[rehearsal] songs=${extracted.songCount} setlists=${extracted.setlistCount} warnings=${extracted.warnings.length}`,
      );
      expect(extracted.songCount).toBeGreaterThan(0);
      expect(extracted.setlistCount).toBeGreaterThan(0);

      // songs を取込（コミット）→ setlists をプレビュー→（未知 venue を home 解決）→ dry-run
      const { POST: uploadPost } = await import("@/app/api/import/[type]/route");
      const { POST: commitPost } = await import(
        "@/app/api/import/jobs/[jobId]/commit/route"
      );
      const { POST: resPost } = await import(
        "@/app/api/import/jobs/[jobId]/resolutions/route"
      );
      const { GET: dryRunGet } = await import(
        "@/app/api/import/jobs/[jobId]/dry-run/route"
      );

      const songsJob = await (
        await uploadPost(
          csvUploadRequest("/api/import/songs", extracted.songsCsv),
          routeParams({ type: "songs" }),
        )
      ).json();
      await commitPost(
        jsonRequest(`/api/import/jobs/${songsJob.job.id}/commit`, "POST", {}),
        routeParams({ jobId: String(songsJob.job.id) }),
      );

      const setJob = await (
        await uploadPost(
          csvUploadRequest("/api/import/setlists", extracted.setlistsCsv),
          routeParams({ type: "setlists" }),
        )
      ).json();

      // 未知 venue は全て home=true で暫定解決、未知 title は create_stub
      const venueRes: Record<string, boolean> = {};
      for (const v of setJob.unknowns.venues as string[]) venueRes[v] = true;
      const titleRes: Record<string, { action: string }> = {};
      for (const t of setJob.unknowns.titles as Array<{ csvTitle: string }>) {
        titleRes[t.csvTitle] = { action: "create_stub" };
      }
      await resPost(
        jsonRequest(`/api/import/jobs/${setJob.job.id}/resolutions`, "POST", {
          venues: venueRes,
          titles: titleRes,
        }),
        routeParams({ jobId: String(setJob.job.id) }),
      );

      const dryRes = await dryRunGet(
        new Request(`http://localhost/api/import/jobs/${setJob.job.id}/dry-run`),
        routeParams({ jobId: String(setJob.job.id) }),
      );
      expect(dryRes.status).toBe(200);
      const summary = (await dryRes.json()).summary;
      console.log("[rehearsal] setlists dry-run:", JSON.stringify(summary));
      expect(summary.performancesToCreate).toBeGreaterThan(0);
    },
  );
});
