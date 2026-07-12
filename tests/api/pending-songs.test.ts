/**
 * unit-04 保留曲 API 統合テスト:
 * - 基準4: 追加 → 一覧（別セッションでも取得可）→ called_by_me=true の演奏登録で自動解除
 * - 基準5: 完全除外（当日演奏済み等）に該当しても一覧から消えず警告バッジが付く
 * - 冪等な重複追加 / 手動解除 / 設定 pending.auto_release_on_call=false での無効化
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

async function listPending() {
  const { GET } = await import("@/app/api/pending-songs/route");
  return GET();
}

async function addPending(songId: number) {
  const { POST } = await import("@/app/api/pending-songs/route");
  return POST(jsonRequest("/api/pending-songs", "POST", { songId }));
}

async function deletePending(songId: number) {
  const { DELETE } = await import("@/app/api/pending-songs/[songId]/route");
  return DELETE(
    getRequest(`/api/pending-songs/${songId}`),
    routeParams({ songId: String(songId) }),
  );
}

async function createSong(title: string, attrs: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/songs/route");
  const res = await POST(
    jsonRequest("/api/songs", "POST", { title, hasPlayed: true, ...attrs }),
  );
  return (await res.json()).song;
}

async function createVenue(name: string) {
  const { POST } = await import("@/app/api/venues/route");
  return (
    await (
      await POST(jsonRequest("/api/venues", "POST", { name, isHome: true }))
    ).json()
  ).venue;
}

async function startSession(venueId: number) {
  const { POST } = await import("@/app/api/sessions/route");
  return (
    await (
      await POST(jsonRequest("/api/sessions", "POST", { venueId }))
    ).json()
  ).session;
}

async function endSession(sessionId: number) {
  const { PATCH } = await import("@/app/api/sessions/[id]/route");
  return PATCH(
    jsonRequest(`/api/sessions/${sessionId}`, "PATCH", { status: "ENDED" }),
    routeParams({ id: String(sessionId) }),
  );
}

async function addPerformance(sessionId: number, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/sessions/[id]/performances/route");
  return POST(
    jsonRequest(`/api/sessions/${sessionId}/performances`, "POST", body),
    routeParams({ id: String(sessionId) }),
  );
}

describe("保留曲フロー（基準4）", () => {
  it("追加 → 一覧（曲情報込み）→ 別セッション開始後も取得可 → called_by_me=true で自動解除", async () => {
    const song = await createSong("Stella by Starlight", {
      genreTags: ["バラード"],
    });
    const venue = await createVenue("某店");

    // セッション1で保留に追加
    const session1 = await startSession(venue.id);
    const addRes = await addPending(song.id);
    expect(addRes.status).toBe(201);
    const { pendingSong } = await addRes.json();
    expect(pendingSong.song.id).toBe(song.id);
    expect(pendingSong.song.genreTags).toEqual(["バラード"]);

    // セッション1終了 → セッション2開始（セッションをまたいで保持）
    await endSession(session1.id);
    const session2 = await startSession(venue.id);
    const listRes = await listPending();
    expect(listRes.status).toBe(200);
    const { pendingSongs } = await listRes.json();
    expect(pendingSongs).toHaveLength(1);
    expect(pendingSongs[0].song.title).toBe("Stella by Starlight");

    // called_by_me=true の演奏登録で自動解除
    const perfRes = await addPerformance(session2.id, {
      songId: song.id,
      calledByMe: true,
    });
    expect(perfRes.status).toBe(201);
    expect((await (await listPending()).json()).pendingSongs).toHaveLength(0);
  });

  it("called_by_me=false の演奏登録では解除されない", async () => {
    const song = await createSong("Autumn Leaves");
    const venue = await createVenue("某店");
    const session = await startSession(venue.id);
    await addPending(song.id);

    await addPerformance(session.id, { songId: song.id, calledByMe: false });
    expect((await (await listPending()).json()).pendingSongs).toHaveLength(1);
  });

  it("演奏記録の更新で called_by_me=true になった場合も自動解除される", async () => {
    const song = await createSong("All the Things You Are");
    const venue = await createVenue("某店");
    const session = await startSession(venue.id);
    await addPending(song.id);

    const perf = (
      await (
        await addPerformance(session.id, { songId: song.id, calledByMe: false })
      ).json()
    ).performance;
    expect((await (await listPending()).json()).pendingSongs).toHaveLength(1);

    const { PATCH } = await import("@/app/api/performances/[id]/route");
    await PATCH(
      jsonRequest(`/api/performances/${perf.id}`, "PATCH", { calledByMe: true }),
      routeParams({ id: String(perf.id) }),
    );
    expect((await (await listPending()).json()).pendingSongs).toHaveLength(0);
  });

  it("設定 pending.auto_release_on_call=false なら解除されない", async () => {
    const song = await createSong("Blue Bossa");
    const venue = await createVenue("某店");
    const session = await startSession(venue.id);
    await addPending(song.id);

    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      jsonRequest("/api/settings", "PUT", {
        "pending.auto_release_on_call": false,
      }),
    );

    await addPerformance(session.id, { songId: song.id, calledByMe: true });
    expect((await (await listPending()).json()).pendingSongs).toHaveLength(1);
  });

  it("重複追加は冪等に 201 成功（行は増えない）", async () => {
    const song = await createSong("Oleo");
    expect((await addPending(song.id)).status).toBe(201);
    expect((await addPending(song.id)).status).toBe(201);
    expect((await (await listPending()).json()).pendingSongs).toHaveLength(1);
  });

  it("手動解除は 204、保留中でない曲の解除は 404、存在しない曲の追加は 400", async () => {
    const song = await createSong("Solar");
    await addPending(song.id);
    expect((await deletePending(song.id)).status).toBe(204);
    expect((await (await listPending()).json()).pendingSongs).toHaveLength(0);
    await expectApiError(await deletePending(song.id), 404, "NOT_FOUND");
    await expectApiError(await addPending(9999), 400, "VALIDATION_ERROR");
  });
});

describe("保留曲の警告バッジ（基準5）", () => {
  it("当日演奏済み（完全除外相当）でも推薦結果の一覧に残り PLAYED_TODAY が付く", async () => {
    const pendingSong = await createSong("Pending Played", { form: "ABAC" });
    const others = [];
    for (let i = 0; i < 3; i++) {
      others.push(await createSong(`Other ${i}`, { form: "AABA" }));
    }
    const venue = await createVenue("某店");
    const session = await startSession(venue.id);
    await addPending(pendingSong.id);

    // 保留曲を当日演奏済みにする（calledByMe=false なので保留は残る）
    await addPerformance(session.id, {
      songId: pendingSong.id,
      calledByMe: false,
    });

    const { POST } = await import(
      "@/app/api/sessions/[id]/recommendations/route"
    );
    const res = await POST(
      jsonRequest(`/api/sessions/${session.id}/recommendations`, "POST", {
        conditions: { horns: "ONE", beginner: "NONE" },
        constraints: { kurobon1Only: false },
        intent: {
          rare: 0,
          fresh: 0,
          safety: 0,
          mood: 0,
          ballad: 0,
          seasonal: false,
          listener: false,
        },
      }),
      routeParams({ id: String(session.id) }),
    );
    expect(res.status).toBe(201);
    const { recommendation } = await res.json();

    // 通常候補からは除外されるが、保留曲一覧には残り警告バッジ付き
    const candidateIds = recommendation.candidates.map(
      (c: { song: { id: number } }) => c.song.id,
    );
    expect(candidateIds).not.toContain(pendingSong.id);
    expect(recommendation.pendingSongs).toHaveLength(1);
    expect(recommendation.pendingSongs[0].song.id).toBe(pendingSong.id);
    expect(recommendation.pendingSongs[0].warnings).toContain("PLAYED_TODAY");

    // GET /api/pending-songs でも消えていない
    expect((await (await listPending()).json()).pendingSongs).toHaveLength(1);
  });

  it("推薦候補が保留曲と重複したら isPending=true が付く", async () => {
    // 曲を1曲だけにして必ず候補に入るようにする
    const song = await createSong("Only Song");
    const venue = await createVenue("某店");
    const session = await startSession(venue.id);
    await addPending(song.id);

    const { POST } = await import(
      "@/app/api/sessions/[id]/recommendations/route"
    );
    const res = await POST(
      jsonRequest(`/api/sessions/${session.id}/recommendations`, "POST", {
        conditions: { horns: "ONE", beginner: "NONE" },
        constraints: { kurobon1Only: false },
        intent: {
          rare: 0,
          fresh: 0,
          safety: 0,
          mood: 0,
          ballad: 0,
          seasonal: false,
          listener: false,
        },
      }),
      routeParams({ id: String(session.id) }),
    );
    const { recommendation } = await res.json();
    expect(recommendation.candidates).toHaveLength(1);
    expect(recommendation.candidates[0].isPending).toBe(true);
    expect(recommendation.isSparse).toBe(true);
  });
});
