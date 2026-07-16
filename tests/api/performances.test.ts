/**
 * Success Criteria #1, #3（has_played 自動更新）, #4（フロント編成 順序・重複保持）:
 * - order_index の max+1 採番と削除時の 1..N 詰め直し
 * - participated=true → has_played false→true（DB 直接検証）。削除でも巻き戻さない
 * - フロント編成 vo, as, as, ts の順序・重複保持
 * - quick_title 経由の追加、songId と quickTitle の排他 400
 */
import { desc, eq } from "drizzle-orm";
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

const addRoute = () => import("@/app/api/sessions/[id]/performances/route");
const perfByIdRoute = () => import("@/app/api/performances/[id]/route");
const reorderRoute = () =>
  import("@/app/api/sessions/[id]/performances/order/route");

/** 曲・店舗・ACTIVE セッションを用意する共通セットアップ */
async function fixture() {
  const { POST: postSong } = await import("@/app/api/songs/route");
  const songRes = await postSong(
    jsonRequest("/api/songs", "POST", { title: "Misty" }),
  );
  const { song } = await songRes.json();

  const { POST: postVenue } = await import("@/app/api/venues/route");
  const { venue } = await (
    await postVenue(jsonRequest("/api/venues", "POST", { name: "某店", isHome: true }))
  ).json();

  const { POST: postSession } = await import("@/app/api/sessions/route");
  const { session } = await (
    await postSession(jsonRequest("/api/sessions", "POST", { venueId: venue.id }))
  ).json();

  return { song, venue, session };
}

async function addPerformanceViaApi(
  sessionId: number,
  body: Record<string, unknown>,
) {
  const { POST } = await addRoute();
  return POST(
    jsonRequest(`/api/sessions/${sessionId}/performances`, "POST", body),
    routeParams({ id: String(sessionId) }),
  );
}

async function readSongFromDb(songId: number) {
  const { getDb } = await import("@/db/client");
  const { songs } = await import("@/db/schema");
  return getDb().select().from(songs).where(eq(songs.id, songId)).get();
}

describe("POST /api/sessions/:id/performances", () => {
  it("order_index が max+1 で採番される", async () => {
    const { song, session } = await fixture();
    const r1 = await addPerformanceViaApi(session.id, { songId: song.id });
    expect(r1.status).toBe(201);
    const p1 = (await r1.json()).performance;
    const p2 = (await (
      await addPerformanceViaApi(session.id, { songId: song.id })
    ).json()).performance;
    const p3 = (await (
      await addPerformanceViaApi(session.id, { songId: song.id })
    ).json()).performance;
    expect([p1.orderIndex, p2.orderIndex, p3.orderIndex]).toEqual([1, 2, 3]);
  });

  it("participated=true で has_played が false→true になる（DB 直接検証）", async () => {
    const { song, session } = await fixture();
    expect((await readSongFromDb(song.id))?.hasPlayed).toBe(false);

    await addPerformanceViaApi(session.id, {
      songId: song.id,
      participated: true,
      instrument: "SAX",
    });
    expect((await readSongFromDb(song.id))?.hasPlayed).toBe(true);
  });

  it("participated=false では has_played は変わらない", async () => {
    const { song, session } = await fixture();
    await addPerformanceViaApi(session.id, {
      songId: song.id,
      participated: false,
    });
    expect((await readSongFromDb(song.id))?.hasPlayed).toBe(false);
  });

  it("フロント編成 vo, as, as, ts が順序・重複を保持して保存され、GET で同順で返る", async () => {
    const { song, session } = await fixture();
    const res = await addPerformanceViaApi(session.id, {
      songId: song.id,
      frontInstruments: [
        { code: "vo", position: 0 },
        { code: "as", position: 1 },
        { code: "as", position: 2 },
        { code: "ts", position: 3 },
      ],
    });
    expect(res.status).toBe(201);
    const { performance } = await res.json();
    expect(
      performance.frontInstruments.map((f: { code: string }) => f.code),
    ).toEqual(["vo", "as", "as", "ts"]);

    // GET /api/sessions/active でも同順で返る
    const { GET } = await import("@/app/api/sessions/active/route");
    const active = await (await GET()).json();
    expect(
      active.session.performances[0].frontInstruments.map(
        (f: { code: string }) => f.code,
      ),
    ).toEqual(["vo", "as", "as", "ts"]);
    expect(
      active.session.performances[0].frontInstruments.map(
        (f: { position: number }) => f.position,
      ),
    ).toEqual([0, 1, 2, 3]);
  });

  it("quickTitle 経由で needs_review の曲が作られ紐付く", async () => {
    const { session } = await fixture();
    const res = await addPerformanceViaApi(session.id, {
      quickTitle: "Oleo",
      participated: true,
    });
    expect(res.status).toBe(201);
    const { performance } = await res.json();
    expect(performance.songTitle).toBe("Oleo");

    const created = await readSongFromDb(performance.songId);
    expect(created).toMatchObject({
      title: "Oleo",
      needsReview: true,
      hasPlayed: true, // participated=true なので自動更新
    });
  });

  it("quickTitle が既存曲と同名（正規化後一致）なら 409 にせず既存曲へ紐付ける", async () => {
    const { song, session } = await fixture();
    const res = await addPerformanceViaApi(session.id, {
      quickTitle: " ＭＩＳＴＹ ",
    });
    expect(res.status).toBe(201);
    const { performance } = await res.json();
    expect(performance.songId).toBe(song.id);

    // 新しい曲は作られていない
    const { getDb } = await import("@/db/client");
    const { songs } = await import("@/db/schema");
    expect(getDb().select().from(songs).all()).toHaveLength(1);
  });

  it("songId と quickTitle の両指定・両欠落は 400", async () => {
    const { song, session } = await fixture();
    const both = await addPerformanceViaApi(session.id, {
      songId: song.id,
      quickTitle: "Oleo",
    });
    await expectApiError(both, 400, "VALIDATION_ERROR");

    const neither = await addPerformanceViaApi(session.id, {
      participated: true,
    });
    await expectApiError(neither, 400, "VALIDATION_ERROR");
  });

  it("存在しない songId は 400、未知の楽器コードは 400", async () => {
    const { session } = await fixture();
    const badSong = await addPerformanceViaApi(session.id, { songId: 9999 });
    await expectApiError(badSong, 400, "VALIDATION_ERROR");

    const { POST: postSong } = await import("@/app/api/songs/route");
    const { song: s2 } = await (
      await postSong(jsonRequest("/api/songs", "POST", { title: "Oleo" }))
    ).json();
    const badCode = await addPerformanceViaApi(session.id, {
      songId: s2.id,
      frontInstruments: [{ code: "xxx", position: 0 }],
    });
    await expectApiError(badCode, 400, "VALIDATION_ERROR");
  });

  it("ENDED セッションへの追加は 409、存在しないセッションは 404", async () => {
    const { song, session } = await fixture();
    const { PATCH } = await import("@/app/api/sessions/[id]/route");
    await PATCH(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", { status: "ENDED" }),
      routeParams({ id: String(session.id) }),
    );
    const ended = await addPerformanceViaApi(session.id, { songId: song.id });
    await expectApiError(ended, 409, "CONFLICT");

    const nf = await addPerformanceViaApi(9999, { songId: song.id });
    await expectApiError(nf, 404, "NOT_FOUND");
  });
});

describe("PATCH /api/performances/:id", () => {
  it("participated を false→true に更新すると has_played も true になる", async () => {
    const { song, session } = await fixture();
    const { performance } = await (
      await addPerformanceViaApi(session.id, { songId: song.id })
    ).json();
    expect((await readSongFromDb(song.id))?.hasPlayed).toBe(false);

    const { PATCH } = await perfByIdRoute();
    const res = await PATCH(
      jsonRequest(`/api/performances/${performance.id}`, "PATCH", {
        participated: true,
        instrument: "PIANO",
        calledByMe: true,
      }),
      routeParams({ id: String(performance.id) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.performance).toMatchObject({
      participated: true,
      instrument: "PIANO",
      calledByMe: true,
    });
    expect((await readSongFromDb(song.id))?.hasPlayed).toBe(true);
  });

  it("フロント編成を差し替えられる（順序・重複を保持）", async () => {
    const { song, session } = await fixture();
    const { performance } = await (
      await addPerformanceViaApi(session.id, {
        songId: song.id,
        frontInstruments: [{ code: "tp", position: 0 }],
      })
    ).json();

    const { PATCH } = await perfByIdRoute();
    const res = await PATCH(
      jsonRequest(`/api/performances/${performance.id}`, "PATCH", {
        frontInstruments: [
          { code: "vo", position: 0 },
          { code: "as", position: 1 },
          { code: "as", position: 2 },
          { code: "ts", position: 3 },
        ],
      }),
      routeParams({ id: String(performance.id) }),
    );
    const body = await res.json();
    expect(
      body.performance.frontInstruments.map((f: { code: string }) => f.code),
    ).toEqual(["vo", "as", "as", "ts"]);
  });

  it("存在しない id は 404、不正 enum は 400", async () => {
    const { PATCH } = await perfByIdRoute();
    const nf = await PATCH(
      jsonRequest("/api/performances/9999", "PATCH", { participated: true }),
      routeParams({ id: "9999" }),
    );
    await expectApiError(nf, 404, "NOT_FOUND");

    const { song, session } = await fixture();
    const { performance } = await (
      await addPerformanceViaApi(session.id, { songId: song.id })
    ).json();
    const bad = await PATCH(
      jsonRequest(`/api/performances/${performance.id}`, "PATCH", {
        instrument: "DRUMS",
      }),
      routeParams({ id: String(performance.id) }),
    );
    await expectApiError(bad, 400, "VALIDATION_ERROR");
  });
});

describe("DELETE /api/performances/:id", () => {
  it("途中の記録を削除すると order_index が 1..N に詰め直される", async () => {
    const { song, session } = await fixture();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { performance } = await (
        await addPerformanceViaApi(session.id, { songId: song.id })
      ).json();
      ids.push(performance.id);
    }

    const { DELETE } = await perfByIdRoute();
    const res = await DELETE(
      jsonRequest(`/api/performances/${ids[1]}`, "DELETE"),
      routeParams({ id: String(ids[1]) }),
    );
    expect(res.status).toBe(204);

    const { GET } = await import("@/app/api/sessions/[id]/route");
    const detail = await (
      await GET(
        getRequest(`/api/sessions/${session.id}`),
        routeParams({ id: String(session.id) }),
      )
    ).json();
    expect(
      detail.session.performances.map(
        (p: { id: number; orderIndex: number }) => [p.id, p.orderIndex],
      ),
    ).toEqual([
      [ids[0], 1],
      [ids[2], 2],
    ]);
  });

  it("演奏記録を削除しても has_played は true のまま（巻き戻さない）", async () => {
    const { song, session } = await fixture();
    const { performance } = await (
      await addPerformanceViaApi(session.id, {
        songId: song.id,
        participated: true,
      })
    ).json();
    expect((await readSongFromDb(song.id))?.hasPlayed).toBe(true);

    const { DELETE } = await perfByIdRoute();
    await DELETE(
      jsonRequest(`/api/performances/${performance.id}`, "DELETE"),
      routeParams({ id: String(performance.id) }),
    );
    expect((await readSongFromDb(song.id))?.hasPlayed).toBe(true);
  });

  it("存在しない id は 404", async () => {
    const { DELETE } = await perfByIdRoute();
    const res = await DELETE(
      jsonRequest("/api/performances/9999", "DELETE"),
      routeParams({ id: "9999" }),
    );
    await expectApiError(res, 404, "NOT_FOUND");
  });
});

describe("PATCH /api/sessions/:id/performances/order", () => {
  /** ACTIVE セッションに 3 件の演奏記録（order 1,2,3）を用意する */
  async function threePerformances() {
    const { song, session } = await fixture();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { performance } = await (
        await addPerformanceViaApi(session.id, { songId: song.id })
      ).json();
      ids.push(performance.id);
    }
    return { session, ids };
  }

  async function reorderViaApi(sessionId: number, order: number[]) {
    const { PATCH } = await reorderRoute();
    return PATCH(
      jsonRequest(
        `/api/sessions/${sessionId}/performances/order`,
        "PATCH",
        { order },
      ),
      routeParams({ id: String(sessionId) }),
    );
  }

  it("受領順に order_index が 1..N へ再採番される", async () => {
    const { session, ids } = await threePerformances();
    const res = await reorderViaApi(session.id, [ids[2], ids[0], ids[1]]);
    expect(res.status).toBe(200);
    const { performances } = await res.json();
    // 返却は order_index 昇順（= 受領順）
    expect(
      performances.map((p: { id: number; orderIndex: number }) => [
        p.id,
        p.orderIndex,
      ]),
    ).toEqual([
      [ids[2], 1],
      [ids[0], 2],
      [ids[1], 3],
    ]);

    // DB 直接検証でも同じ
    const { getDb } = await import("@/db/client");
    const { performances: perfTable } = await import("@/db/schema");
    const rows = getDb()
      .select({ id: perfTable.id, orderIndex: perfTable.orderIndex })
      .from(perfTable)
      .where(eq(perfTable.sessionId, session.id))
      .all()
      .sort((a, b) => a.orderIndex - b.orderIndex);
    expect(rows).toEqual([
      { id: ids[2], orderIndex: 1 },
      { id: ids[0], orderIndex: 2 },
      { id: ids[1], orderIndex: 3 },
    ]);
  });

  it("並べ替え後も「直前の曲 = order_index 最大行」が新しい末尾を指す", async () => {
    const { session, ids } = await threePerformances();
    await reorderViaApi(session.id, [ids[2], ids[0], ids[1]]);

    // order_index 最大（DESC LIMIT 1）= 直前の曲
    const { getDb } = await import("@/db/client");
    const { performances: perfTable } = await import("@/db/schema");
    const last = getDb()
      .select({ id: perfTable.id, orderIndex: perfTable.orderIndex })
      .from(perfTable)
      .where(eq(perfTable.sessionId, session.id))
      .orderBy(desc(perfTable.orderIndex))
      .get();
    expect(last).toEqual({ id: ids[1], orderIndex: 3 });
  });

  it("id 集合不一致（欠落・余剰・重複）は 400", async () => {
    const { session, ids } = await threePerformances();

    // 欠落（2 件だけ）
    await expectApiError(
      await reorderViaApi(session.id, [ids[0], ids[1]]),
      400,
      "VALIDATION_ERROR",
    );
    // 余剰（存在しない id を含む）
    await expectApiError(
      await reorderViaApi(session.id, [ids[0], ids[1], ids[2], 9999]),
      400,
      "VALIDATION_ERROR",
    );
    // 重複
    await expectApiError(
      await reorderViaApi(session.id, [ids[0], ids[0], ids[1]]),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("存在しないセッションは 404", async () => {
    await expectApiError(
      await reorderViaApi(9999, [1, 2, 3]),
      404,
      "NOT_FOUND",
    );
  });
});
