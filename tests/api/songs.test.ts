/**
 * Success Criteria #1（songs CRUD の正常系+異常系）, #2（クイック登録）:
 * - CRUD 正常系・検索/フィルタ/ソート
 * - 400（不正 enum）・title 重複 409・参照中削除 409
 * - クイック登録: needs_review=true 作成、同名（正規化後完全一致）409 + 既存曲返却
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectApiError,
  getRequest,
  jsonRequest,
  routeParams,
  setupTestDb,
  teardownTestDb,
} from "./helpers";

beforeEach(async () => {
  await setupTestDb();
});

afterEach(() => {
  teardownTestDb();
});

const songsRoute = () => import("@/app/api/songs/route");
const songByIdRoute = () => import("@/app/api/songs/[id]/route");
const quickRoute = () => import("@/app/api/songs/quick/route");

async function createSongViaApi(body: Record<string, unknown>) {
  const { POST } = await songsRoute();
  const res = await POST(jsonRequest("/api/songs", "POST", body));
  expect(res.status).toBe(201);
  const { song } = await res.json();
  return song;
}

describe("POST /api/songs", () => {
  it("全属性+ジャンルタグ付きで作成できる（201）", async () => {
    const song = await createSongViaApi({
      title: "Misty",
      songKey: "Eb",
      form: "AABA",
      composer: "Erroll Garner",
      hasPlayed: true,
      isStandard: true,
      listenerLevel: 5,
      energyLevel: 2,
      genreTags: ["バラード", "歌もの"],
    });
    expect(song).toMatchObject({
      title: "Misty",
      titleNormalized: "misty",
      songKey: "Eb",
      form: "AABA",
      hasPlayed: true,
      isStandard: true,
      needsReview: false,
      genreTags: ["バラード", "歌もの"],
    });
  });

  it("title のみでも既定値で作成できる", async () => {
    const song = await createSongViaApi({ title: "Blue Bossa" });
    expect(song).toMatchObject({
      form: "OTHER",
      season: "ALL",
      listenerLevel: 3,
      energyLevel: 3,
      hasPlayed: false,
      needsReview: false,
      genreTags: [],
    });
  });

  it("title 重複は 409 統一形式", async () => {
    await createSongViaApi({ title: "Misty" });
    const { POST } = await songsRoute();
    const res = await POST(jsonRequest("/api/songs", "POST", { title: "Misty" }));
    await expectApiError(res, 409, "CONFLICT");
  });

  it("不正 enum（form）は 400 VALIDATION_ERROR", async () => {
    const { POST } = await songsRoute();
    const res = await POST(
      jsonRequest("/api/songs", "POST", { title: "X", form: "XYZ" }),
    );
    const body = await expectApiError(res, 400, "VALIDATION_ERROR");
    expect(body.error.details).toBeTruthy();
  });

  it("listenerLevel 範囲外（6）は 400", async () => {
    const { POST } = await songsRoute();
    const res = await POST(
      jsonRequest("/api/songs", "POST", { title: "X", listenerLevel: 6 }),
    );
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("固定9種以外のジャンルタグは 400", async () => {
    const { POST } = await songsRoute();
    const res = await POST(
      jsonRequest("/api/songs", "POST", { title: "X", genreTags: ["演歌"] }),
    );
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("JSON でないボディは 400", async () => {
    const { POST } = await songsRoute();
    const res = await POST(
      new Request("http://localhost/api/songs", {
        method: "POST",
        body: "{oops",
      }),
    );
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });
});

describe("GET /api/songs", () => {
  beforeEach(async () => {
    await createSongViaApi({
      title: "Autumn Leaves",
      season: "AUTUMN",
      hasPlayed: true,
      genreTags: ["歌もの"],
    });
    await createSongViaApi({
      title: "Misty",
      genreTags: ["バラード", "歌もの"],
    });
    await createSongViaApi({ title: "Now's The Time", genreTags: ["ブルース"] });
  });

  it("既定は title 昇順で全曲+ジャンルタグを返す", async () => {
    const { GET } = await songsRoute();
    const res = await GET(getRequest("/api/songs"));
    expect(res.status).toBe(200);
    const { songs } = await res.json();
    expect(songs.map((s: { title: string }) => s.title)).toEqual([
      "Autumn Leaves",
      "Misty",
      "Now's The Time",
    ]);
    expect(songs[1].genreTags).toEqual(["バラード", "歌もの"]);
  });

  it("q で title 部分一致検索できる", async () => {
    const { GET } = await songsRoute();
    const res = await GET(getRequest("/api/songs?q=ist"));
    const { songs } = await res.json();
    expect(songs.map((s: { title: string }) => s.title)).toEqual(["Misty"]);
  });

  it("genre / season / hasPlayed でフィルタできる", async () => {
    const { GET } = await songsRoute();
    const byGenre = await (
      await GET(getRequest(`/api/songs?genre=${encodeURIComponent("歌もの")}`))
    ).json();
    expect(byGenre.songs.map((s: { title: string }) => s.title)).toEqual([
      "Autumn Leaves",
      "Misty",
    ]);

    const bySeason = await (
      await GET(getRequest("/api/songs?season=AUTUMN"))
    ).json();
    expect(bySeason.songs.map((s: { title: string }) => s.title)).toEqual([
      "Autumn Leaves",
    ]);

    const byPlayed = await (
      await GET(getRequest("/api/songs?hasPlayed=true"))
    ).json();
    expect(byPlayed.songs.map((s: { title: string }) => s.title)).toEqual([
      "Autumn Leaves",
    ]);
  });

  it("needsReview=true でクイック登録曲のみ返る", async () => {
    const { POST } = await quickRoute();
    await POST(jsonRequest("/api/songs/quick", "POST", { title: "Oleo" }));
    const { GET } = await songsRoute();
    const res = await GET(getRequest("/api/songs?needsReview=true"));
    const { songs } = await res.json();
    expect(songs.map((s: { title: string }) => s.title)).toEqual(["Oleo"]);
  });

  it("sort=updated は最終更新の新しい順", async () => {
    const { GET } = await songsRoute();
    const { PATCH } = await songByIdRoute();
    const list = await (await GET(getRequest("/api/songs"))).json();
    const autumn = list.songs.find(
      (s: { title: string }) => s.title === "Autumn Leaves",
    );
    const res = await PATCH(
      jsonRequest(`/api/songs/${autumn.id}`, "PATCH", { note: "touched" }),
      routeParams({ id: String(autumn.id) }),
    );
    expect(res.status).toBe(200);

    const sorted = await (
      await GET(getRequest("/api/songs?sort=updated"))
    ).json();
    expect(sorted.songs[0].title).toBe("Autumn Leaves");
  });

  it("不正なクエリ（sort=xyz）は 400", async () => {
    const { GET } = await songsRoute();
    const res = await GET(getRequest("/api/songs?sort=xyz"));
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });
});

describe("PATCH /api/songs/:id", () => {
  it("部分更新（needs_review 解除・ジャンルタグ差し替え）ができる", async () => {
    const { POST } = await quickRoute();
    const created = await (
      await POST(jsonRequest("/api/songs/quick", "POST", { title: "Oleo" }))
    ).json();
    expect(created.song.needsReview).toBe(true);

    const { PATCH } = await songByIdRoute();
    const res = await PATCH(
      jsonRequest(`/api/songs/${created.song.id}`, "PATCH", {
        needsReview: false,
        songKey: "Bb",
        genreTags: ["循環"],
      }),
      routeParams({ id: String(created.song.id) }),
    );
    expect(res.status).toBe(200);
    const { song } = await res.json();
    expect(song).toMatchObject({
      needsReview: false,
      songKey: "Bb",
      genreTags: ["循環"],
    });
    expect(song.updatedAt >= created.song.updatedAt).toBe(true);
  });

  it("title 変更は titleNormalized も追従し、他曲と重複なら 409", async () => {
    const a = await createSongViaApi({ title: "Misty" });
    const b = await createSongViaApi({ title: "Oleo" });
    const { PATCH } = await songByIdRoute();

    const renamed = await PATCH(
      jsonRequest(`/api/songs/${b.id}`, "PATCH", { title: "ＯＬＥＯ mk2" }),
      routeParams({ id: String(b.id) }),
    );
    const { song } = await renamed.json();
    expect(song.titleNormalized).toBe("oleo mk2");

    const dup = await PATCH(
      jsonRequest(`/api/songs/${b.id}`, "PATCH", { title: "Misty" }),
      routeParams({ id: String(b.id) }),
    );
    await expectApiError(dup, 409, "CONFLICT");
    expect(a.id).not.toBe(b.id);
  });

  it("存在しない id は 404、空 patch は 400", async () => {
    const { PATCH } = await songByIdRoute();
    const notFound = await PATCH(
      jsonRequest("/api/songs/9999", "PATCH", { note: "x" }),
      routeParams({ id: "9999" }),
    );
    await expectApiError(notFound, 404, "NOT_FOUND");

    const song = await createSongViaApi({ title: "Misty" });
    const empty = await PATCH(
      jsonRequest(`/api/songs/${song.id}`, "PATCH", {}),
      routeParams({ id: String(song.id) }),
    );
    await expectApiError(empty, 400, "VALIDATION_ERROR");
  });
});

describe("DELETE /api/songs/:id", () => {
  it("未参照の曲は削除できる（204）", async () => {
    const song = await createSongViaApi({ title: "Misty", genreTags: ["バラード"] });
    const { DELETE } = await songByIdRoute();
    const res = await DELETE(
      jsonRequest(`/api/songs/${song.id}`, "DELETE"),
      routeParams({ id: String(song.id) }),
    );
    expect(res.status).toBe(204);

    const { GET } = await songsRoute();
    const { songs } = await (await GET(getRequest("/api/songs"))).json();
    expect(songs).toHaveLength(0);
  });

  it("演奏記録が参照している曲は 409（履歴保全）", async () => {
    const song = await createSongViaApi({ title: "Misty" });
    // セッション + 演奏記録を投入
    const { db, schema } = await dbWithSchema();
    const venue = db
      .insert(schema.venues)
      .values({ name: "某店", isHome: true })
      .returning()
      .get();
    const session = db
      .insert(schema.sessions)
      .values({ sessionDate: "2026-07-12", venueId: venue.id })
      .returning()
      .get();
    db.insert(schema.performances)
      .values({ sessionId: session.id, songId: song.id, orderIndex: 1 })
      .run();

    const { DELETE } = await songByIdRoute();
    const res = await DELETE(
      jsonRequest(`/api/songs/${song.id}`, "DELETE"),
      routeParams({ id: String(song.id) }),
    );
    await expectApiError(res, 409, "CONFLICT");
  });

  it("存在しない id は 404、不正 id は 400", async () => {
    const { DELETE } = await songByIdRoute();
    const nf = await DELETE(
      jsonRequest("/api/songs/9999", "DELETE"),
      routeParams({ id: "9999" }),
    );
    await expectApiError(nf, 404, "NOT_FOUND");

    const bad = await DELETE(
      jsonRequest("/api/songs/abc", "DELETE"),
      routeParams({ id: "abc" }),
    );
    await expectApiError(bad, 400, "VALIDATION_ERROR");
  });
});

describe("POST /api/songs/quick（クイック登録）", () => {
  it("title のみで needs_review=true, has_played=false の曲が作成される", async () => {
    const { POST } = await quickRoute();
    const res = await POST(
      jsonRequest("/api/songs/quick", "POST", { title: "Oleo" }),
    );
    expect(res.status).toBe(201);
    const { song } = await res.json();
    expect(song).toMatchObject({
      title: "Oleo",
      titleNormalized: "oleo",
      needsReview: true,
      hasPlayed: false,
      form: "OTHER",
      season: "ALL",
      listenerLevel: 3,
      energyLevel: 3,
      genreTags: [],
    });
  });

  it("同名既存曲（正規化後完全一致）は 409 + 既存曲を返す", async () => {
    const existing = await createSongViaApi({ title: "Autumn Leaves" });
    const { POST } = await quickRoute();
    const res = await POST(
      jsonRequest("/api/songs/quick", "POST", { title: " ＡＵＴＵＭＮ　Leaves " }),
    );
    const body = await expectApiError(res, 409, "CONFLICT");
    expect(
      (body.error.details as { song: { id: number; title: string } }).song,
    ).toMatchObject({ id: existing.id, title: "Autumn Leaves" });
  });

  it("title 欠落・空文字は 400", async () => {
    const { POST } = await quickRoute();
    const missing = await POST(jsonRequest("/api/songs/quick", "POST", {}));
    await expectApiError(missing, 400, "VALIDATION_ERROR");
    const blank = await POST(
      jsonRequest("/api/songs/quick", "POST", { title: "   " }),
    );
    await expectApiError(blank, 400, "VALIDATION_ERROR");
  });
});

/** DB を schema ごと取得（テストからの直接投入用） */
async function dbWithSchema() {
  const { getDb } = await import("@/db/client");
  const schema = await import("@/db/schema");
  return { db: getDb(), schema };
}
