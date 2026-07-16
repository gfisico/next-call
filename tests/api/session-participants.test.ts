/**
 * PUT /api/sessions/:id/participants の統合テスト（unit-02 Success Criteria #2）。
 * - 参加者を置換保存（全消し→再挿入）
 * - listenerCount / hostInstrumentCode の更新
 * - 未知 instrumentCode / 重複 instrumentCode / count 負値 → 400
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectApiError,
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

async function createVenue(name = "某店") {
  const { POST } = await import("@/app/api/venues/route");
  const { venue } = await (
    await POST(jsonRequest("/api/venues", "POST", { name, isHome: true }))
  ).json();
  return venue as { id: number };
}

async function startSession() {
  const venue = await createVenue();
  const { POST } = await import("@/app/api/sessions/route");
  const { session } = await (
    await POST(jsonRequest("/api/sessions", "POST", { venueId: venue.id }))
  ).json();
  return session as { id: number };
}

async function putParticipants(id: number, body: unknown) {
  const { PUT } = await import("@/app/api/sessions/[id]/participants/route");
  return PUT(
    jsonRequest(`/api/sessions/${id}/participants`, "PUT", body),
    routeParams({ id: String(id) }),
  );
}

describe("PUT /api/sessions/:id/participants", () => {
  it("参加者を置換保存し、listenerCount/hostInstrumentCode を更新できる", async () => {
    const session = await startSession();
    const res = await putParticipants(session.id, {
      participants: [
        { instrumentCode: "tp", count: 1 },
        { instrumentCode: "pf", count: 2 },
        { instrumentCode: "ds", count: 3 },
      ],
      listenerCount: 5,
      hostInstrumentCode: "pf",
    });
    expect(res.status).toBe(200);
    const { session: detail } = await res.json();
    expect(detail.listenerCount).toBe(5);
    expect(detail.hostInstrumentCode).toBe("pf");
    expect(detail.hasListeners).toBe(false); // PUT participants は has_listeners を触らない（既定 false 据え置き）
    expect(detail.participants).toEqual([
      { instrumentCode: "ds", count: 3 },
      { instrumentCode: "pf", count: 2 },
      { instrumentCode: "tp", count: 1 },
    ]);

    // DB 直接検証
    const db = await testDb();
    const { sessionParticipants } = await import("@/db/schema");
    expect(
      db
        .select()
        .from(sessionParticipants)
        .where(eq(sessionParticipants.sessionId, session.id))
        .all(),
    ).toHaveLength(3);
  });

  it("再 PUT で全消し→再挿入（置換）される", async () => {
    const session = await startSession();
    await putParticipants(session.id, {
      participants: [
        { instrumentCode: "tp", count: 1 },
        { instrumentCode: "as", count: 2 },
      ],
    });
    const res = await putParticipants(session.id, {
      participants: [{ instrumentCode: "g", count: 4 }],
    });
    const { session: detail } = await res.json();
    expect(detail.participants).toEqual([{ instrumentCode: "g", count: 4 }]);

    const db = await testDb();
    const { sessionParticipants } = await import("@/db/schema");
    expect(
      db
        .select()
        .from(sessionParticipants)
        .where(eq(sessionParticipants.sessionId, session.id))
        .all(),
    ).toHaveLength(1);
  });

  it("空配列で全消しでき、null で host/listener をクリアできる", async () => {
    const session = await startSession();
    await putParticipants(session.id, {
      participants: [{ instrumentCode: "tp", count: 1 }],
      listenerCount: 3,
      hostInstrumentCode: "pf",
    });
    const res = await putParticipants(session.id, {
      participants: [],
      listenerCount: null,
      hostInstrumentCode: null,
    });
    const { session: detail } = await res.json();
    expect(detail.participants).toEqual([]);
    expect(detail.listenerCount).toBeNull();
    expect(detail.hostInstrumentCode).toBeNull();
  });

  it("未知 instrumentCode（参加者）は 400", async () => {
    const session = await startSession();
    const res = await putParticipants(session.id, {
      participants: [{ instrumentCode: "zzz", count: 1 }],
    });
    const body = await expectApiError(res, 400, "VALIDATION_ERROR");
    expect((body.error.details as { unknownCodes: string[] }).unknownCodes).toContain(
      "zzz",
    );
  });

  it("未知 hostInstrumentCode は 400", async () => {
    const session = await startSession();
    const res = await putParticipants(session.id, {
      participants: [],
      hostInstrumentCode: "zzz",
    });
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("同一 instrumentCode の重複は 400", async () => {
    const session = await startSession();
    const res = await putParticipants(session.id, {
      participants: [
        { instrumentCode: "tp", count: 1 },
        { instrumentCode: "tp", count: 2 },
      ],
    });
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("count 負値は 400（zod）", async () => {
    const session = await startSession();
    const res = await putParticipants(session.id, {
      participants: [{ instrumentCode: "tp", count: -1 }],
    });
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("存在しない session は 404", async () => {
    const res = await putParticipants(9999, { participants: [] });
    await expectApiError(res, 404, "NOT_FOUND");
  });
});
