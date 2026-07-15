/**
 * 成功基準1: songs.csv の正常取込（title upsert・genres 複数タグ・season/boolean/level 変換）
 * 成功基準3: バリデーションエラー行（行番号+理由）を返しつつ有効行のプレビューは継続
 */
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

const HEADER =
  "title,key,form,composer,has_played,no_chart_ok,is_standard,difficulty,in_kurobon1,season,listener_level,energy_level,genres,note";

async function upload(csv: string) {
  const { POST } = await import("@/app/api/import/[type]/route");
  return POST(csvUploadRequest("/api/import/songs", csv), routeParams({ type: "songs" }));
}

async function commit(jobId: number) {
  const { POST } = await import("@/app/api/import/jobs/[jobId]/commit/route");
  return POST(
    jsonRequest(`/api/import/jobs/${jobId}/commit`, "POST", {}),
    routeParams({ jobId: String(jobId) }),
  );
}

async function listSongs() {
  const { listSongs } = await import("@/server/repositories/songs");
  return listSongs({}, await testDb());
}

describe("POST /api/import/songs（取込）", () => {
  it("新規曲を upsert し、genres 複数・season/boolean/level を正しく変換する（基準1）", async () => {
    const csv = `${HEADER}
Stella By Starlight,Bb,AABA,Victor Young,1,1,1,3,1,通年,4,5,歌もの|バラード,
Recorda Me,C,OTHER,Joe Henderson,1,0,0,,1,夏,3,3,ボサノバ,memo`;
    const res = await upload(csv);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.totalRows).toBe(2);
    expect(body.validRows).toBe(2);
    expect(body.errors).toHaveLength(0);

    const commitRes = await commit(body.job.id);
    expect(commitRes.status).toBe(200);
    const summary = (await commitRes.json()).summary;
    expect(summary).toMatchObject({ songsCreated: 2, songsUpdated: 0 });

    const songs = await listSongs();
    const stella = songs.find((s) => s.title === "Stella By Starlight")!;
    expect(stella.songKey).toBe("Bb");
    expect(stella.form).toBe("AABA");
    expect(stella.hasPlayed).toBe(true);
    expect(stella.noChartOk).toBe(true);
    expect(stella.isStandard).toBe(true);
    expect(stella.difficulty).toBe(3);
    expect(stella.inKurobon1).toBe(true);
    expect(stella.season).toBe("ALL");
    expect(stella.listenerLevel).toBe(4);
    expect(stella.energyLevel).toBe(5);
    expect(stella.genreTags.sort()).toEqual(["バラード", "歌もの"].sort());

    const recorda = songs.find((s) => s.title === "Recorda Me")!;
    expect(recorda.difficulty).toBeNull();
    expect(recorda.season).toBe("SUMMER");
    expect(recorda.genreTags).toEqual(["ボサノバ"]);
    expect(recorda.note).toBe("memo");
  });

  it("既存曲（正規化一致）は更新される（title upsert）", async () => {
    // 1回目: 作成（difficulty 未設定）
    const first = await (await upload(`${HEADER}
Blue Bossa,C,OTHER,Kenny Dorham,0,0,0,,0,通年,3,3,,`)).json();
    await commit(first.job.id);

    // 2回目: 同曲を正規化一致（前後空白・大小差）で更新（difficulty も反映）
    const second = await upload(`${HEADER}
  BLUE  BOSSA ,Cm,AABA,Kenny Dorham,1,0,1,4,1,通年,5,4,ボサノバ,updated`);
    const secondBody = await second.json();
    const summary = (await (await commit(secondBody.job.id)).json()).summary;
    expect(summary).toMatchObject({ songsCreated: 0, songsUpdated: 1 });

    const songs = await listSongs();
    const blue = songs.filter(
      (s) => s.titleNormalized === "blue bossa",
    );
    expect(blue).toHaveLength(1); // 二重作成されない
    expect(blue[0].form).toBe("AABA");
    expect(blue[0].hasPlayed).toBe(true);
    expect(blue[0].difficulty).toBe(4);
    expect(blue[0].listenerLevel).toBe(5);
    expect(blue[0].genreTags).toEqual(["ボサノバ"]);
  });

  it("エラー行は行番号+理由付きで返り、有効行はプレビュー継続する（基準3）", async () => {
    const csv = `${HEADER}
Good Song,C,AABA,X,1,0,0,,0,通年,3,3,歌もの,
Bad Boolean,C,AABA,X,9,0,0,,0,通年,3,3,,
Bad Season,C,AABA,X,1,0,0,,0,謎,3,3,,
Another Good,F,OTHER,Y,0,0,0,,0,春,2,2,,`;
    const res = await upload(csv);
    const body = await res.json();
    expect(body.totalRows).toBe(4);
    expect(body.validRows).toBe(2);
    expect(body.errors).toHaveLength(2);
    // 行番号: ヘッダを1行目とした 3行目(Bad Boolean)・4行目(Bad Season)
    expect(body.errors[0].line).toBe(3);
    expect(body.errors[0].reason).toContain("has_played");
    expect(body.errors[1].line).toBe(4);
    expect(body.errors[1].reason).toContain("season");
    expect(body.errors[0].raw.title).toBe("Bad Boolean");

    // 有効行だけが取込まれる
    const summary = (await (await commit(body.job.id)).json()).summary;
    expect(summary.songsCreated).toBe(2);
  });

  it("difficulty 範囲外（6/0/非数）は行エラーで報告し、有効行は取込む（基準3）", async () => {
    const csv = `${HEADER}
Diff Too High,C,AABA,X,0,0,0,6,0,通年,3,3,,
Diff Zero,C,AABA,X,0,0,0,0,0,通年,3,3,,
Diff NaN,C,AABA,X,0,0,0,x,0,通年,3,3,,
Diff OK,C,AABA,X,0,0,0,5,0,通年,3,3,,`;
    const res = await upload(csv);
    const body = await res.json();
    expect(body.totalRows).toBe(4);
    expect(body.validRows).toBe(1);
    expect(body.errors).toHaveLength(3);
    // 行番号: ヘッダ=1行目 → 2〜4行目が difficulty エラー
    expect(body.errors.map((e: { line: number }) => e.line)).toEqual([2, 3, 4]);
    for (const e of body.errors as Array<{ reason: string }>) {
      expect(e.reason).toContain("difficulty");
    }

    const summary = (await (await commit(body.job.id)).json()).summary;
    expect(summary.songsCreated).toBe(1);
    const songs = await listSongs();
    expect(songs.find((s) => s.title === "Diff OK")!.difficulty).toBe(5);
  });

  it("simple_form 列を含まない CSV でも取込める（列は撤去済み）", async () => {
    // HEADER には simple_form が存在せず difficulty のみ。取込が成功する。
    expect(HEADER).not.toContain("simple_form");
    const csv = `${HEADER}
No SimpleForm Col,C,AABA,X,0,0,0,2,0,通年,3,3,,`;
    const res = await upload(csv);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.validRows).toBe(1);
    expect(body.errors).toHaveLength(0);

    const summary = (await (await commit(body.job.id)).json()).summary;
    expect(summary.songsCreated).toBe(1);
    const song = (await listSongs()).find((s) => s.title === "No SimpleForm Col")!;
    expect(song.difficulty).toBe(2);
  });

  it("未知の type は 400（VALIDATION_ERROR）", async () => {
    const { POST } = await import("@/app/api/import/[type]/route");
    const res = await POST(
      csvUploadRequest("/api/import/foo", `${HEADER}\nX,C,AABA,,0,0,0,,0,通年,3,3,,`),
      routeParams({ type: "foo" }),
    );
    expect(res.status).toBe(400);
  });
});
