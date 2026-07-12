/**
 * Success Criteria #1（楽器・ジャンル・店舗マスターの正常系+異常系）:
 * - シード12楽器の取得・追加・code 重複 409・使用中楽器の削除 409
 * - genre-tags 固定9種（読み取りのみ）
 * - venues の isHome 必須 400・name 重複 409・更新
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GENRE_TAG_NAMES, INSTRUMENT_SEEDS } from "@/db/seed";
import {
  expectApiError,
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

describe("GET/POST /api/instruments", () => {
  it("シード12種が sort_order 順で返る", async () => {
    const { GET } = await import("@/app/api/instruments/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const { instruments } = await res.json();
    expect(instruments).toHaveLength(12);
    expect(instruments.map((i: { code: string }) => i.code)).toEqual(
      INSTRUMENT_SEEDS.map((s) => s.code),
    );
  });

  it("追加できる（sortOrder 省略時は末尾）", async () => {
    const { GET, POST } = await import("@/app/api/instruments/route");
    const res = await POST(
      jsonRequest("/api/instruments", "POST", { code: "vib", label: "ヴィブラフォン" }),
    );
    expect(res.status).toBe(201);
    const { instrument } = await res.json();
    expect(instrument).toMatchObject({ code: "vib", sortOrder: 13 });

    const list = await (await GET()).json();
    expect(list.instruments).toHaveLength(13);
    expect(list.instruments[12].code).toBe("vib");
  });

  it("code 重複は 409、label 欠落は 400", async () => {
    const { POST } = await import("@/app/api/instruments/route");
    const dup = await POST(
      jsonRequest("/api/instruments", "POST", { code: "vo", label: "ヴォーカル2" }),
    );
    await expectApiError(dup, 409, "CONFLICT");

    const invalid = await POST(
      jsonRequest("/api/instruments", "POST", { code: "vib" }),
    );
    await expectApiError(invalid, 400, "VALIDATION_ERROR");
  });
});

describe("DELETE /api/instruments/:code", () => {
  it("未使用の楽器は削除できる（204）", async () => {
    const { DELETE } = await import("@/app/api/instruments/[code]/route");
    const res = await DELETE(
      jsonRequest("/api/instruments/g", "DELETE"),
      routeParams({ code: "g" }),
    );
    expect(res.status).toBe(204);
  });

  it("フロント編成が使用中の楽器は 409", async () => {
    // 曲・セッション・演奏記録・編成を直接投入
    const { getDb } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const db = getDb();
    const song = db
      .insert(schema.songs)
      .values({ title: "Misty", titleNormalized: "misty" })
      .returning()
      .get();
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
    const perf = db
      .insert(schema.performances)
      .values({ sessionId: session.id, songId: song.id, orderIndex: 1 })
      .returning()
      .get();
    db.insert(schema.performanceFrontInstruments)
      .values({ performanceId: perf.id, instrumentCode: "vo", position: 0 })
      .run();

    const { DELETE } = await import("@/app/api/instruments/[code]/route");
    const res = await DELETE(
      jsonRequest("/api/instruments/vo", "DELETE"),
      routeParams({ code: "vo" }),
    );
    await expectApiError(res, 409, "CONFLICT");
  });

  it("存在しない code は 404", async () => {
    const { DELETE } = await import("@/app/api/instruments/[code]/route");
    const res = await DELETE(
      jsonRequest("/api/instruments/xxx", "DELETE"),
      routeParams({ code: "xxx" }),
    );
    await expectApiError(res, 404, "NOT_FOUND");
  });
});

describe("GET /api/genre-tags", () => {
  it("固定9種がシード順で返る", async () => {
    const { GET } = await import("@/app/api/genre-tags/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const { genreTags } = await res.json();
    expect(genreTags.map((t: { name: string }) => t.name)).toEqual([
      ...GENRE_TAG_NAMES,
    ]);
  });
});

describe("GET/POST /api/venues", () => {
  it("isHome 必須で作成でき、一覧に反映される", async () => {
    const { GET, POST } = await import("@/app/api/venues/route");
    const res = await POST(
      jsonRequest("/api/venues", "POST", { name: "某店", isHome: true }),
    );
    expect(res.status).toBe(201);
    const { venue } = await res.json();
    expect(venue).toMatchObject({ name: "某店", isHome: true });

    const list = await (await GET()).json();
    expect(list.venues).toHaveLength(1);
  });

  it("isHome 欠落は 400（required boolean）", async () => {
    const { POST } = await import("@/app/api/venues/route");
    const res = await POST(jsonRequest("/api/venues", "POST", { name: "某店" }));
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("name 重複は 409", async () => {
    const { POST } = await import("@/app/api/venues/route");
    await POST(jsonRequest("/api/venues", "POST", { name: "某店", isHome: true }));
    const res = await POST(
      jsonRequest("/api/venues", "POST", { name: "某店", isHome: false }),
    );
    await expectApiError(res, 409, "CONFLICT");
  });
});

describe("PATCH /api/venues/:id", () => {
  it("name / isHome を更新できる", async () => {
    const { POST } = await import("@/app/api/venues/route");
    const { venue } = await (
      await POST(jsonRequest("/api/venues", "POST", { name: "旧店名", isHome: false }))
    ).json();

    const { PATCH } = await import("@/app/api/venues/[id]/route");
    const res = await PATCH(
      jsonRequest(`/api/venues/${venue.id}`, "PATCH", {
        name: "新店名",
        isHome: true,
      }),
      routeParams({ id: String(venue.id) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.venue).toMatchObject({ name: "新店名", isHome: true });
  });

  it("存在しない id は 404、他店舗と同名は 409", async () => {
    const { POST } = await import("@/app/api/venues/route");
    await POST(jsonRequest("/api/venues", "POST", { name: "A", isHome: true }));
    const { venue: b } = await (
      await POST(jsonRequest("/api/venues", "POST", { name: "B", isHome: false }))
    ).json();

    const { PATCH } = await import("@/app/api/venues/[id]/route");
    const nf = await PATCH(
      jsonRequest("/api/venues/9999", "PATCH", { name: "C" }),
      routeParams({ id: "9999" }),
    );
    await expectApiError(nf, 404, "NOT_FOUND");

    const dup = await PATCH(
      jsonRequest(`/api/venues/${b.id}`, "PATCH", { name: "A" }),
      routeParams({ id: String(b.id) }),
    );
    await expectApiError(dup, 409, "CONFLICT");
  });
});
