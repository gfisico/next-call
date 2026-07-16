/**
 * Success Criteria #1（セッション API の正常系+異常系）, #5（ACTIVE 二重開始 409）:
 * - 開始（既定日付=JST当日）、二重開始 409、active 取得、has_listeners 切替、
 *   ENDED 終了、終了後の再開始、存在しない venue_id 400
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jstDateString } from "@/lib/jst-date";
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

const sessionsRoute = () => import("@/app/api/sessions/route");
const activeRoute = () => import("@/app/api/sessions/active/route");
const sessionByIdRoute = () => import("@/app/api/sessions/[id]/route");

async function createVenue(name = "某店", isHome = true) {
  const { POST } = await import("@/app/api/venues/route");
  const res = await POST(jsonRequest("/api/venues", "POST", { name, isHome }));
  const { venue } = await res.json();
  return venue as { id: number; name: string };
}

async function startSessionViaApi(body: Record<string, unknown>) {
  const { POST } = await sessionsRoute();
  return POST(jsonRequest("/api/sessions", "POST", body));
}

describe("POST /api/sessions", () => {
  it("開始できる。sessionDate 省略時は JST 当日が入る", async () => {
    const venue = await createVenue();
    const res = await startSessionViaApi({ venueId: venue.id });
    expect(res.status).toBe(201);
    const { session } = await res.json();
    expect(session).toMatchObject({
      sessionDate: jstDateString(),
      venueId: venue.id,
      hasListeners: false,
      status: "ACTIVE",
      venueName: "某店",
      performances: [],
    });
  });

  it("sessionDate・hasListeners を指定して開始できる", async () => {
    const venue = await createVenue();
    const res = await startSessionViaApi({
      venueId: venue.id,
      sessionDate: "2026-07-01",
      hasListeners: true,
    });
    const { session } = await res.json();
    expect(session).toMatchObject({
      sessionDate: "2026-07-01",
      hasListeners: true,
    });
  });

  it("ACTIVE セッションがあるとき二重開始は 409（既存 id を details に含む）", async () => {
    const venue = await createVenue();
    const first = await (await startSessionViaApi({ venueId: venue.id })).json();
    const res = await startSessionViaApi({ venueId: venue.id });
    const body = await expectApiError(res, 409, "CONFLICT");
    expect(body.error.details).toEqual({
      activeSessionId: first.session.id,
    });
  });

  it("存在しない venueId は 400、venueId 欠落も 400", async () => {
    const res = await startSessionViaApi({ venueId: 9999 });
    await expectApiError(res, 400, "VALIDATION_ERROR");

    const missing = await startSessionViaApi({});
    await expectApiError(missing, 400, "VALIDATION_ERROR");
  });

  it("不正な sessionDate 形式は 400", async () => {
    const venue = await createVenue();
    const res = await startSessionViaApi({
      venueId: venue.id,
      sessionDate: "2026/07/01",
    });
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });
});

describe("GET /api/sessions/active", () => {
  it("進行中セッションを返す（演奏記録・編成付き構造）", async () => {
    const venue = await createVenue();
    await startSessionViaApi({ venueId: venue.id });
    const { GET } = await activeRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const { session } = await res.json();
    expect(session.status).toBe("ACTIVE");
    expect(session.performances).toEqual([]);
  });

  it("進行中が無ければ 404", async () => {
    const { GET } = await activeRoute();
    const res = await GET();
    await expectApiError(res, 404, "NOT_FOUND");
  });
});

describe("PATCH /api/sessions/:id", () => {
  it("has_listeners を切り替えられる", async () => {
    const venue = await createVenue();
    const { session } = await (
      await startSessionViaApi({ venueId: venue.id })
    ).json();

    const { PATCH } = await sessionByIdRoute();
    const res = await PATCH(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", {
        hasListeners: true,
      }),
      routeParams({ id: String(session.id) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.hasListeners).toBe(true);
    expect(body.session.status).toBe("ACTIVE");
  });

  it("status: ENDED で終了でき、終了後は新規開始できる", async () => {
    const venue = await createVenue();
    const { session } = await (
      await startSessionViaApi({ venueId: venue.id })
    ).json();

    const { PATCH } = await sessionByIdRoute();
    const ended = await PATCH(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", {
        status: "ENDED",
        note: "楽しかった",
      }),
      routeParams({ id: String(session.id) }),
    );
    const endedBody = await ended.json();
    expect(endedBody.session).toMatchObject({
      status: "ENDED",
      note: "楽しかった",
    });

    // active は 404 になる
    const { GET: getActive } = await activeRoute();
    await expectApiError(await getActive(), 404, "NOT_FOUND");

    // 新しいセッションを開始できる
    const res = await startSessionViaApi({ venueId: venue.id });
    expect(res.status).toBe(201);
  });

  it("status に ACTIVE（再開）は指定できない（400）", async () => {
    const venue = await createVenue();
    const { session } = await (
      await startSessionViaApi({ venueId: venue.id })
    ).json();
    const { PATCH } = await sessionByIdRoute();
    const res = await PATCH(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", { status: "ACTIVE" }),
      routeParams({ id: String(session.id) }),
    );
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("存在しない id は 404", async () => {
    const { PATCH } = await sessionByIdRoute();
    const res = await PATCH(
      jsonRequest("/api/sessions/9999", "PATCH", { hasListeners: true }),
      routeParams({ id: "9999" }),
    );
    await expectApiError(res, 404, "NOT_FOUND");
  });

  it("sessionDate・venueId を更新できる（camelCase）", async () => {
    const venue = await createVenue();
    const venue2 = await createVenue("別の店", false);
    const { session } = await (
      await startSessionViaApi({ venueId: venue.id, sessionDate: "2026-07-01" })
    ).json();

    const { PATCH } = await sessionByIdRoute();
    const res = await PATCH(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", {
        sessionDate: "2026-07-15",
        venueId: venue2.id,
      }),
      routeParams({ id: String(session.id) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toMatchObject({
      sessionDate: "2026-07-15",
      venueId: venue2.id,
      venueName: "別の店",
    });
  });

  it("存在しない venueId は 400", async () => {
    const venue = await createVenue();
    const { session } = await (
      await startSessionViaApi({ venueId: venue.id })
    ).json();
    const { PATCH } = await sessionByIdRoute();
    const res = await PATCH(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", { venueId: 9999 }),
      routeParams({ id: String(session.id) }),
    );
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("不正な sessionDate 形式は 400", async () => {
    const venue = await createVenue();
    const { session } = await (
      await startSessionViaApi({ venueId: venue.id })
    ).json();
    const { PATCH } = await sessionByIdRoute();
    const res = await PATCH(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", {
        sessionDate: "2026/07/01",
      }),
      routeParams({ id: String(session.id) }),
    );
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });
});

describe("DELETE /api/sessions/:id", () => {
  async function createSong(title: string) {
    const { POST } = await import("@/app/api/songs/route");
    const { song } = await (
      await POST(jsonRequest("/api/songs", "POST", { title }))
    ).json();
    return song as { id: number };
  }

  it("cascade 削除し 204。pending_songs は残す（DB 直接検証）", async () => {
    const venue = await createVenue();
    const { session } = await (
      await startSessionViaApi({ venueId: venue.id })
    ).json();
    const song = await createSong("Misty");

    // performance + front_instruments
    const { POST: addPerf } = await import(
      "@/app/api/sessions/[id]/performances/route"
    );
    const { performance } = await (
      await addPerf(
        jsonRequest(`/api/sessions/${session.id}/performances`, "POST", {
          songId: song.id,
          frontInstruments: [
            { code: "vo", position: 0 },
            { code: "as", position: 1 },
          ],
        }),
        routeParams({ id: String(session.id) }),
      )
    ).json();

    // recommendation_request + candidate を直接 DB に投入
    const { getDb } = await import("@/db/client");
    const {
      sessions,
      performances,
      performanceFrontInstruments,
      recommendationRequests,
      recommendationCandidates,
      pendingSongs,
    } = await import("@/db/schema");
    const db = getDb();
    const req = db
      .insert(recommendationRequests)
      .values({
        sessionId: session.id,
        horns: "ONE",
        beginner: "NONE",
        conditionSignature: "sig-1",
      })
      .returning()
      .get();
    db.insert(recommendationCandidates)
      .values({ requestId: req.id, songId: song.id, score: 1.5 })
      .run();

    // pending_songs（セッション横断保持の対象）
    const { addPendingSong } = await import(
      "@/server/repositories/pending-songs"
    );
    addPendingSong(song.id);

    const { DELETE } = await sessionByIdRoute();
    const res = await DELETE(
      jsonRequest(`/api/sessions/${session.id}`, "DELETE"),
      routeParams({ id: String(session.id) }),
    );
    expect(res.status).toBe(204);

    // 5 テーブルの該当行が 0
    expect(
      db.select().from(sessions).where(eq(sessions.id, session.id)).all(),
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(performances)
        .where(eq(performances.sessionId, session.id))
        .all(),
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(performanceFrontInstruments)
        .where(eq(performanceFrontInstruments.performanceId, performance.id))
        .all(),
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(recommendationRequests)
        .where(eq(recommendationRequests.sessionId, session.id))
        .all(),
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(recommendationCandidates)
        .where(eq(recommendationCandidates.requestId, req.id))
        .all(),
    ).toHaveLength(0);
    // pending_songs は残る
    expect(
      db.select().from(pendingSongs).where(eq(pendingSongs.songId, song.id)).all(),
    ).toHaveLength(1);
  });

  it("session_participants を持つセッションを FK 違反なく cascade 削除できる（unit-02 SC#3）", async () => {
    const venue = await createVenue();
    const { session } = await (
      await startSessionViaApi({ venueId: venue.id })
    ).json();
    const song = await createSong("Solar");

    // pending_songs（セッション横断保持の対象。cascade で残ること）
    const { addPendingSong } = await import(
      "@/server/repositories/pending-songs"
    );
    addPendingSong(song.id);

    // 参加者を登録
    const { PUT } = await import(
      "@/app/api/sessions/[id]/participants/route"
    );
    await PUT(
      jsonRequest(`/api/sessions/${session.id}/participants`, "PUT", {
        participants: [
          { instrumentCode: "pf", count: 2 },
          { instrumentCode: "b", count: 3 },
        ],
        listenerCount: 2,
        hostInstrumentCode: "pf",
      }),
      routeParams({ id: String(session.id) }),
    );

    const { getDb } = await import("@/db/client");
    const { sessions, sessionParticipants, pendingSongs } = await import(
      "@/db/schema"
    );
    const db = getDb();
    expect(
      db
        .select()
        .from(sessionParticipants)
        .where(eq(sessionParticipants.sessionId, session.id))
        .all(),
    ).toHaveLength(2);

    const { DELETE } = await sessionByIdRoute();
    const res = await DELETE(
      jsonRequest(`/api/sessions/${session.id}`, "DELETE"),
      routeParams({ id: String(session.id) }),
    );
    expect(res.status).toBe(204);

    // participants は消え、session も消える。pending_songs は残る
    expect(
      db
        .select()
        .from(sessionParticipants)
        .where(eq(sessionParticipants.sessionId, session.id))
        .all(),
    ).toHaveLength(0);
    expect(
      db.select().from(sessions).where(eq(sessions.id, session.id)).all(),
    ).toHaveLength(0);
    expect(
      db.select().from(pendingSongs).where(eq(pendingSongs.songId, song.id)).all(),
    ).toHaveLength(1);
  });

  it("存在しない id は 404", async () => {
    const { DELETE } = await sessionByIdRoute();
    const res = await DELETE(
      jsonRequest("/api/sessions/9999", "DELETE"),
      routeParams({ id: "9999" }),
    );
    await expectApiError(res, 404, "NOT_FOUND");
  });
});

describe("GET /api/sessions・GET /api/sessions/:id", () => {
  it("履歴一覧が venue 名付き・新しい順で返る", async () => {
    const venue = await createVenue();
    const { session: s1 } = await (
      await startSessionViaApi({ venueId: venue.id, sessionDate: "2026-07-01" })
    ).json();
    const { PATCH } = await sessionByIdRoute();
    await PATCH(
      jsonRequest(`/api/sessions/${s1.id}`, "PATCH", { status: "ENDED" }),
      routeParams({ id: String(s1.id) }),
    );
    await startSessionViaApi({ venueId: venue.id, sessionDate: "2026-07-11" });

    const { GET } = await sessionsRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const { sessions } = await res.json();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      sessionDate: "2026-07-11",
      venueName: "某店",
      status: "ACTIVE",
    });
    expect(sessions[1].sessionDate).toBe("2026-07-01");
  });

  it("詳細を取得できる。存在しない id は 404", async () => {
    const venue = await createVenue();
    const { session } = await (
      await startSessionViaApi({ venueId: venue.id })
    ).json();

    const { GET } = await sessionByIdRoute();
    const res = await GET(
      getRequest(`/api/sessions/${session.id}`),
      routeParams({ id: String(session.id) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toMatchObject({
      id: session.id,
      venueName: "某店",
      performances: [],
    });

    const nf = await GET(
      getRequest("/api/sessions/9999"),
      routeParams({ id: "9999" }),
    );
    await expectApiError(nf, 404, "NOT_FOUND");
  });
});
