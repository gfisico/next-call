/**
 * メモ一括移行 preview / commit の統合テスト（unit-02 SC#5/#6/#7）。
 * - preview は DB 未書込・照合結果（要確認/警告）を返す
 * - 未知 venue の母店フラグ要確認注記 / 未一致曲の候補 / 未知 instrument の要確認分類
 * - commit は補正済みペイロード（テキストなし）から Session(status=ENDED)/Performance/
 *   FrontInstrument/SessionParticipant を tx 生成。new venue is_home=false。date+venue 重複は 409
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectApiError,
  jsonRequest,
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

const MEMO = `2026/5/9 池袋
tp1, as1, g4, pf2, b3, ds3
・ホストはpf
1. Stella By Starlight (tp, g, g) ※pfなし
2. Giant Steps (as, g) 🎷🔰 ※Key=C
`;

async function preview(text: string) {
  const { POST } = await import(
    "@/app/api/sessions/import-memo/preview/route"
  );
  return POST(jsonRequest("/api/sessions/import-memo/preview", "POST", { text }));
}

async function commit(payload: unknown) {
  const { POST } = await import("@/app/api/sessions/import-memo/commit/route");
  return POST(
    jsonRequest("/api/sessions/import-memo/commit", "POST", payload),
  );
}

describe("POST /api/sessions/import-memo/preview", () => {
  it("DB を書き込まず解析結果を返す（sessions/venues/songs 件数不変）", async () => {
    const db = await testDb();
    const { sessions, venues, songs } = await import("@/db/schema");
    const before = {
      sessions: db.select().from(sessions).all().length,
      venues: db.select().from(venues).all().length,
      songs: db.select().from(songs).all().length,
    };

    const res = await preview(MEMO);
    expect(res.status).toBe(200);
    const result = await res.json();

    // DB 未変更
    expect(db.select().from(sessions).all()).toHaveLength(before.sessions);
    expect(db.select().from(venues).all()).toHaveLength(before.venues);
    expect(db.select().from(songs).all()).toHaveLength(before.songs);

    // 構造
    expect(result.sessions).toHaveLength(1);
    const s = result.sessions[0];
    expect(s.date).toBe("2026-05-09");
    expect(s.venueName).toBe("池袋");
    expect(s.host).toEqual({ code: "pf", known: true }); // pf は seed 済み
  });

  it("新規 venue は母店フラグ要確認の warning を出す", async () => {
    const res = await preview(MEMO);
    const s = (await res.json()).sessions[0];
    expect(s.venueMatch).toEqual({ kind: "new" });
    expect(s.warnings.some((w: string) => w.includes("母店フラグ要確認"))).toBe(
      true,
    );
  });

  it("マスタ未一致曲は new + クイック登録候補、既存曲は existing に解決", async () => {
    // "Stella By Starlight" をマスタに登録 → 突合される
    const { POST } = await import("@/app/api/songs/route");
    await POST(
      jsonRequest("/api/songs", "POST", { title: "Stella By Starlight" }),
    );
    const res = await preview(MEMO);
    const s = (await res.json()).sessions[0];
    const stella = s.songs.find(
      (x: { title: string }) => x.title === "Stella By Starlight",
    );
    const giant = s.songs.find(
      (x: { title: string }) => x.title === "Giant Steps",
    );
    expect(stella.songMatch.kind).toBe("existing");
    expect(giant.songMatch.kind).toBe("new");
    expect(Array.isArray(giant.candidates)).toBe(true);
    expect(s.needsReview.some((r: string) => r.includes("Giant Steps"))).toBe(
      true,
    );
  });

  it("未知の楽器コードは要確認に分類し unknownInstrumentCodes に集約", async () => {
    const memo = `2026/5/9 池袋
zzz2
1. Misty (xyz)
`;
    const res = await preview(memo);
    const result = await res.json();
    expect(result.unknownInstrumentCodes).toEqual(
      expect.arrayContaining(["zzz", "xyz"]),
    );
    expect(
      result.sessions[0].needsReview.some((r: string) => r.includes("zzz")),
    ).toBe(true);
  });
});

describe("POST /api/sessions/import-memo/commit", () => {
  const basePayload = {
    sessions: [
      {
        sessionDate: "2026-05-09",
        venue: { kind: "new", name: "池袋", isHome: false },
        listenerCount: 4,
        hostInstrumentCode: "pf",
        participants: [
          { instrumentCode: "tp", count: 1 },
          { instrumentCode: "pf", count: 2 },
        ],
        performances: [
          {
            order: 1,
            songRef: { kind: "new", title: "Stella By Starlight", needsReview: true },
            frontInstruments: ["tp", "g", "g"],
            participated: false,
            instrument: "NONE",
            calledByMe: false,
            note: "pfなし",
          },
          {
            order: 2,
            songRef: { kind: "new", title: "Giant Steps", needsReview: true },
            frontInstruments: ["as", "g"],
            participated: true,
            instrument: "SAX",
            calledByMe: false,
            note: "Key=C",
          },
        ],
      },
    ],
  };

  it("補正済みペイロードから ENDED セッション一式を tx 生成する", async () => {
    const res = await commit(basePayload);
    expect(res.status).toBe(200);
    const { summary } = await res.json();
    expect(summary).toMatchObject({
      sessionsCreated: 1,
      performancesCreated: 2,
      frontInstrumentsCreated: 5,
      participantsCreated: 2,
      venuesCreated: 1,
      stubsCreated: 2,
    });

    const db = await testDb();
    const {
      sessions,
      venues,
      performances,
      performanceFrontInstruments,
      sessionParticipants,
    } = await import("@/db/schema");
    const sessionId = summary.sessionIds[0];

    // status=ENDED（SC#6）
    const session = db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    expect(session?.status).toBe("ENDED");
    expect(session?.listenerCount).toBe(4);
    expect(session?.hasListeners).toBe(true);
    expect(session?.hostInstrumentCode).toBe("pf");

    // new venue は is_home=false（SC#7）
    const venue = db
      .select()
      .from(venues)
      .where(eq(venues.id, session!.venueId))
      .get();
    expect(venue?.name).toBe("池袋");
    expect(venue?.isHome).toBe(false);

    // performances は 1..N 採番、front は position 付き
    expect(
      db
        .select()
        .from(performances)
        .where(eq(performances.sessionId, sessionId))
        .all(),
    ).toHaveLength(2);
    expect(
      db.select().from(performanceFrontInstruments).all().length,
    ).toBe(5);
    expect(
      db
        .select()
        .from(sessionParticipants)
        .where(eq(sessionParticipants.sessionId, sessionId))
        .all(),
    ).toHaveLength(2);
  });

  it("同一 date+venue の二重取込は 409", async () => {
    await commit(basePayload);
    const res = await commit(basePayload);
    await expectApiError(res, 409, "CONFLICT");
  });

  it("未知の楽器コードは 400（部分取込を残さない）", async () => {
    const bad = {
      sessions: [
        {
          ...basePayload.sessions[0],
          sessionDate: "2026-06-01",
          participants: [{ instrumentCode: "zzz", count: 1 }],
        },
      ],
    };
    const res = await commit(bad);
    await expectApiError(res, 400, "VALIDATION_ERROR");

    // ロールバック確認: 該当日付のセッションが作られていない
    const db = await testDb();
    const { sessions } = await import("@/db/schema");
    expect(
      db
        .select()
        .from(sessions)
        .where(eq(sessions.sessionDate, "2026-06-01"))
        .all(),
    ).toHaveLength(0);
  });

  it("existing venue と existing song を参照できる", async () => {
    // 事前に venue と song を作る
    const { POST: venuePost } = await import("@/app/api/venues/route");
    const { venue } = await (
      await venuePost(
        jsonRequest("/api/venues", "POST", { name: "新宿", isHome: true }),
      )
    ).json();
    const { POST: songPost } = await import("@/app/api/songs/route");
    const { song } = await (
      await songPost(jsonRequest("/api/songs", "POST", { title: "Misty" }))
    ).json();

    const res = await commit({
      sessions: [
        {
          sessionDate: "2026-07-01",
          venue: { kind: "existing", id: venue.id },
          participants: [],
          performances: [
            {
              order: 1,
              songRef: { kind: "existing", id: song.id },
              frontInstruments: ["as"],
              participated: true,
              instrument: "SAX",
              calledByMe: true,
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const { summary } = await res.json();
    expect(summary.venuesCreated).toBe(0);
    expect(summary.stubsCreated).toBe(0);

    const db = await testDb();
    const { performances } = await import("@/db/schema");
    const perf = db
      .select()
      .from(performances)
      .where(and(eq(performances.songId, song.id)))
      .get();
    expect(perf?.calledByMe).toBe(true);
  });
});
