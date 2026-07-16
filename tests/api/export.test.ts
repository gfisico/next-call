/**
 * Success Criteria #6:
 * GET /api/export が全テーブルを含む JSON を返し、曲数・演奏記録数が DB と一致する。
 * Content-Disposition: attachment ヘッダも検証する。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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

/** 全12テーブル + メタ2キー */
const EXPORT_TABLE_KEYS = [
  "songs",
  "genre_tags",
  "song_genre_tags",
  "instruments",
  "venues",
  "sessions",
  "session_participants",
  "performances",
  "performance_front_instruments",
  "recommendation_requests",
  "recommendation_candidates",
  "pending_songs",
  "settings",
] as const;

describe("GET /api/export", () => {
  it("全テーブルキー + exported_at / schema_version を含む", async () => {
    const { GET } = await import("@/app/api/export/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const key of EXPORT_TABLE_KEYS) {
      expect(Array.isArray(body[key]), `missing table key: ${key}`).toBe(true);
    }
    expect(body.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof body.schema_version).toBe("string");
    expect(body.schema_version).not.toBe("unknown");
    // シード分
    expect(body.genre_tags).toHaveLength(9);
    expect(body.instruments).toHaveLength(15); // フロント12 + リズム隊3（unit-02）
    expect(body.settings.length).toBeGreaterThan(0);
  });

  it("attachment ヘッダ（JST 日付入りファイル名）が付く", async () => {
    const { GET } = await import("@/app/api/export/route");
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="next-call-export-\d{8}\.json"$/,
    );
  });

  it("曲・演奏記録を投入後、件数が DB の COUNT と一致する", async () => {
    // 曲2・店舗1・セッション1・演奏記録2（うち1件は編成付き）を API 経由で投入
    const { POST: postSong } = await import("@/app/api/songs/route");
    const { song: s1 } = await (
      await postSong(
        jsonRequest("/api/songs", "POST", { title: "Misty", genreTags: ["バラード"] }),
      )
    ).json();
    const { song: s2 } = await (
      await postSong(jsonRequest("/api/songs", "POST", { title: "Oleo" }))
    ).json();

    const { POST: postVenue } = await import("@/app/api/venues/route");
    const { venue } = await (
      await postVenue(jsonRequest("/api/venues", "POST", { name: "某店", isHome: true }))
    ).json();

    const { POST: postSession } = await import("@/app/api/sessions/route");
    const { session } = await (
      await postSession(
        jsonRequest("/api/sessions", "POST", { venueId: venue.id }),
      )
    ).json();

    const { POST: postPerf } = await import(
      "@/app/api/sessions/[id]/performances/route"
    );
    await postPerf(
      jsonRequest(`/api/sessions/${session.id}/performances`, "POST", {
        songId: s1.id,
        participated: true,
        frontInstruments: [
          { code: "vo", position: 0 },
          { code: "as", position: 1 },
        ],
      }),
      routeParams({ id: String(session.id) }),
    );
    await postPerf(
      jsonRequest(`/api/sessions/${session.id}/performances`, "POST", {
        songId: s2.id,
      }),
      routeParams({ id: String(session.id) }),
    );

    const { GET } = await import("@/app/api/export/route");
    const body = await (await GET()).json();

    // DB の COUNT と突き合わせ
    const { getSqlite } = await import("@/db/client");
    const sqlite = getSqlite();
    for (const key of EXPORT_TABLE_KEYS) {
      const { n } = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM ${key}`)
        .get() as { n: number };
      expect(body[key], `count mismatch: ${key}`).toHaveLength(n);
    }
    expect(body.songs).toHaveLength(2);
    expect(body.performances).toHaveLength(2);
    expect(body.performance_front_instruments).toHaveLength(2);
    expect(body.song_genre_tags).toHaveLength(1);
  });
});
