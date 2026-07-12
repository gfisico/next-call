/**
 * unit-04 統合テスト:
 * - 基準2: 推薦実行のたび requests/candidates が保存され、直後の再実行で繰り返し減点が効く
 * - 基準3: 意図値が保存され defaults が前回値を返す（初回は中央値 + seasonal 推奨フラグ）
 * - 基準6: seed が保存され、同一 request の結果を再現できる（as-of 履歴再構築）
 * - 基準8: 統一エラー形式（404 / 非ACTIVE 409 / zod 400）
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectApiError,
  getRequest,
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

const NEUTRAL_INTENT = {
  rare: 0,
  fresh: 0,
  safety: 0,
  mood: 0,
  ballad: 0,
  seasonal: false,
  listener: false,
};

function recoBody(overrides: Record<string, unknown> = {}) {
  return {
    conditions: { horns: "ONE", beginner: "NONE" },
    constraints: { kurobon1Only: false },
    intent: { ...NEUTRAL_INTENT },
    ...overrides,
  };
}

async function postRecommendation(sessionId: number, body: unknown) {
  const { POST } = await import(
    "@/app/api/sessions/[id]/recommendations/route"
  );
  return POST(
    jsonRequest(`/api/sessions/${sessionId}/recommendations`, "POST", body),
    routeParams({ id: String(sessionId) }),
  );
}

async function getDefaults(sessionId: number) {
  const { GET } = await import(
    "@/app/api/sessions/[id]/recommendations/defaults/route"
  );
  return GET(
    getRequest(`/api/sessions/${sessionId}/recommendations/defaults`),
    routeParams({ id: String(sessionId) }),
  );
}

/**
 * 中立な曲 N 曲 + 店舗 + ACTIVE セッションを API 経由で用意する。
 * 中立曲（スライダー0・コール履歴なし・直前曲なし）のスコアは base_score=50 になる。
 */
async function fixture(songCount: number) {
  const { POST: postSong } = await import("@/app/api/songs/route");
  const songIds: number[] = [];
  for (let i = 0; i < songCount; i++) {
    const res = await postSong(
      jsonRequest("/api/songs", "POST", {
        title: `Neutral Song ${String(i + 1).padStart(2, "0")}`,
        hasPlayed: true,
        songKey: "C",
        form: "AABA",
      }),
    );
    songIds.push((await res.json()).song.id);
  }

  const { POST: postVenue } = await import("@/app/api/venues/route");
  const { venue } = await (
    await postVenue(
      jsonRequest("/api/venues", "POST", { name: "某店", isHome: true }),
    )
  ).json();

  const { POST: postSession } = await import("@/app/api/sessions/route");
  const { session } = await (
    await postSession(
      jsonRequest("/api/sessions", "POST", {
        venueId: venue.id,
        sessionDate: "2026-07-12",
      }),
    )
  ).json();

  return { songIds, venue, session };
}

async function readRequests() {
  const db = await testDb();
  const { recommendationRequests } = await import("@/db/schema");
  return db.select().from(recommendationRequests).all();
}

async function readCandidates(requestId: number) {
  const db = await testDb();
  const { recommendationCandidates } = await import("@/db/schema");
  return db
    .select()
    .from(recommendationCandidates)
    .where(eq(recommendationCandidates.requestId, requestId))
    .all();
}

describe("POST /api/sessions/:id/recommendations（基準2: 履歴保存 + 繰り返し減点）", () => {
  it("実行のたび requests/candidates が保存され、再実行で提示曲の保存スコアが下がる", async () => {
    // 中立曲 3 曲: 全曲スコア 50 → candidate_count=3 で全曲提示される。
    // 通過数 3 < relax_pool_threshold=8 → 減点半減 (12+6)*0.5=9 → 2回目は全曲 41。
    const { session } = await fixture(3);

    const res1 = await postRecommendation(session.id, recoBody());
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()).recommendation;
    expect(body1.candidates).toHaveLength(3);
    expect(body1.isSparse).toBe(false);
    expect(body1.poolSize).toBe(3);
    for (const c of body1.candidates) expect(c.score).toBe(50);

    const res2 = await postRecommendation(session.id, recoBody());
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()).recommendation;

    // 履歴が 2 組保存されている
    const requests = await readRequests();
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.poolSize)).toEqual([3, 3]);
    const cands1 = await readCandidates(body1.requestId);
    const cands2 = await readCandidates(body2.requestId);
    expect(cands1).toHaveLength(3);
    expect(cands2).toHaveLength(3);

    // 繰り返し減点: 1回目 50 → 2回目 41（前回提示 −12・直近 −6 の半減適用）
    for (const c of cands1) expect(c.score).toBe(50);
    for (const c of cands2) expect(c.score).toBe(41);
    expect(cands2.map((c) => c.score < 50).every(Boolean)).toBe(true);
  });

  it("保存内容: 条件・意図スナップショット・condition_signature・display_order", async () => {
    const { session } = await fixture(3);
    const body = recoBody({
      conditions: { horns: "MULTI", beginner: "NONE" },
      constraints: { kurobon1Only: true, genreOverride: ["バラード", "バラード"] },
      intent: { ...NEUTRAL_INTENT, rare: 2, fresh: -1, seasonal: true },
    });
    const res = await postRecommendation(session.id, body);
    const { requestId } = (await res.json()).recommendation;

    const [request] = await readRequests();
    expect(request).toMatchObject({
      sessionId: session.id,
      horns: "MULTI",
      beginner: "NONE",
      kurobon1Only: true,
      rare: 2,
      longUnplayed: -1, // fresh はエンジン/DB の long_unplayed に対応
      seasonal: true,
      listenerFocus: false,
    });
    // genreOverride は重複除去のうえ JSON で保存
    expect(JSON.parse(request.genreOverride ?? "[]")).toEqual(["バラード"]);
    // condition_signature は unit-02 の実装で生成（横断的な形式チェック）
    expect(request.conditionSignature).toBe(
      "h=MULTI|b=NONE|k1=1|g=バラード|s=+-000",
    );

    const cands = await readCandidates(requestId);
    expect(cands.map((c) => c.displayOrder)).toEqual(
      [...Array(cands.length).keys()].map((i) => i + 1),
    );
    for (const c of cands) {
      expect(c.candidateType).toBe("NORMAL");
      expect(Array.isArray(JSON.parse(c.reasons))).toBe(true);
    }
  });

  it("horns/beginner が UNKNOWN のとき条件別候補も保存・返却される", async () => {
    // 初心者向き曲（超定番+譜面なし+単純）と通常曲を混ぜ、BEGINNER ブランチで差が出るようにする
    const { session, songIds } = await fixture(4);
    const { PATCH } = await import("@/app/api/songs/[id]/route");
    await PATCH(
      jsonRequest(`/api/songs/${songIds[0]}`, "PATCH", {
        isStandard: true,
        noChartOk: true,
        simpleForm: true,
      }),
      routeParams({ id: String(songIds[0]) }),
    );

    const res = await postRecommendation(
      session.id,
      recoBody({ conditions: { horns: "UNKNOWN", beginner: "UNKNOWN" } }),
    );
    const reco = (await res.json()).recommendation;
    const { requestId, conditionalCandidates } = reco;

    const cands = await readCandidates(requestId);
    const conditional = cands.filter((c) => c.isConditional);
    expect(conditional.length).toBe(conditionalCandidates.length);
    for (const c of conditional) {
      expect(["ONE_HORN", "MULTI_HORN", "BEGINNER"]).toContain(c.candidateType);
      expect(c.conditionLabel).toBeTruthy();
    }
  });
});

describe("seed 再現（基準6）", () => {
  it("保存された seed + beforeRequestId で同一 request の候補を完全再現できる", async () => {
    // 属性を分散させた曲群でスコアに幅を持たせ、抽選が seed に依存する状況を作る
    const { session } = await fixture(12);
    const intent = { ...NEUTRAL_INTENT, rare: 1, safety: 1 };
    const body = recoBody({
      conditions: { horns: "UNKNOWN", beginner: "NONE" },
      intent,
    });

    // 1回目（履歴を作る）→ 2回目（繰り返し減点あり）を再現対象にする
    await postRecommendation(session.id, body);
    const res2 = await postRecommendation(session.id, body);
    const reco2 = (await res2.json()).recommendation;

    const requests = await readRequests();
    const target = requests.find((r) => r.id === reco2.requestId);
    expect(target).toBeDefined();
    expect(target?.seed).toBe(reco2.seed);

    // as-of 再構築 + persist:false で再実行
    const { executeRecommendation } = await import(
      "@/server/recommendation/service"
    );
    const replay = executeRecommendation(session.id, {
      conditions: { horns: "UNKNOWN", beginner: "NONE" },
      constraints: { kurobon1Only: false },
      intent,
    }, {
      seed: target?.seed,
      beforeRequestId: target?.id,
      persist: false,
    });

    // 保存済み candidates 行（song_id・score・display_order・candidate_type）と完全一致
    const stored = await readCandidates(reco2.requestId);
    const storedNormal = stored
      .filter((c) => c.candidateType === "NORMAL")
      .sort((a, b) => a.displayOrder - b.displayOrder);
    expect(
      replay.candidates.map((c, i) => ({
        songId: c.song.id,
        score: c.score,
        displayOrder: i + 1,
        candidateType: "NORMAL",
      })),
    ).toEqual(
      storedNormal.map((c) => ({
        songId: c.songId,
        score: c.score,
        displayOrder: c.displayOrder,
        candidateType: c.candidateType,
      })),
    );
    const storedConditional = stored
      .filter((c) => c.isConditional)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    expect(
      replay.conditionalCandidates.map((c) => ({
        songId: c.song.id,
        score: c.score,
        conditionLabel: c.conditionLabel,
      })),
    ).toEqual(
      storedConditional.map((c) => ({
        songId: c.songId,
        score: c.score,
        conditionLabel: c.conditionLabel,
      })),
    );

    // persist:false: requests が増えず requestId は null
    expect(replay.requestId).toBeNull();
    expect(await readRequests()).toHaveLength(2);
  });
});

describe("GET /api/sessions/:id/recommendations/defaults（基準3）", () => {
  it("初回は中央値 + suggestSeasonalOn=true + 編成既定 UNKNOWN を返す", async () => {
    const { session } = await fixture(1);
    const res = await getDefaults(session.id);
    expect(res.status).toBe(200);
    const { defaults } = await res.json();
    expect(defaults).toEqual({
      intent: { ...NEUTRAL_INTENT },
      conditions: {
        horns: "UNKNOWN",
        beginner: "UNKNOWN",
        kurobon1Only: false,
        genreOverride: [],
      },
      suggestSeasonalOn: true,
    });
  });

  it("推薦実行後は前回意図値を返す", async () => {
    const { session } = await fixture(3);
    const intent = {
      rare: 2,
      fresh: 1,
      safety: -2,
      mood: 1,
      ballad: -1,
      seasonal: true,
      listener: true,
    };
    await postRecommendation(session.id, recoBody({ intent }));

    const { defaults } = await (await getDefaults(session.id)).json();
    expect(defaults.intent).toEqual(intent);
  });

  it("演奏記録が 1 件でもあれば suggestSeasonalOn=false", async () => {
    const { session, songIds } = await fixture(1);
    const { POST } = await import(
      "@/app/api/sessions/[id]/performances/route"
    );
    await POST(
      jsonRequest(`/api/sessions/${session.id}/performances`, "POST", {
        songId: songIds[0],
      }),
      routeParams({ id: String(session.id) }),
    );

    const { defaults } = await (await getDefaults(session.id)).json();
    expect(defaults.suggestSeasonalOn).toBe(false);
  });

  it("設定 engine.first_song_seasonal_default=false なら 1 曲目でも false", async () => {
    const { session } = await fixture(1);
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      jsonRequest("/api/settings", "PUT", {
        "engine.first_song_seasonal_default": false,
      }),
    );
    const { defaults } = await (await getDefaults(session.id)).json();
    expect(defaults.suggestSeasonalOn).toBe(false);
  });

  it("存在しないセッションは 404（統一エラー形式）", async () => {
    await fixture(1);
    await expectApiError(await getDefaults(9999), 404, "NOT_FOUND");
  });
});

describe("エラー統一形式（基準8）", () => {
  it("存在しないセッションへの POST は 404 NOT_FOUND", async () => {
    await fixture(1);
    await expectApiError(
      await postRecommendation(9999, recoBody()),
      404,
      "NOT_FOUND",
    );
  });

  it("ENDED セッションへの POST は 409 CONFLICT", async () => {
    const { session } = await fixture(3);
    const { PATCH } = await import("@/app/api/sessions/[id]/route");
    await PATCH(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", { status: "ENDED" }),
      routeParams({ id: String(session.id) }),
    );
    await expectApiError(
      await postRecommendation(session.id, recoBody()),
      409,
      "CONFLICT",
    );
  });

  it("バリデーション不正（スライダー範囲外・未知ジャンル）は 400 VALIDATION_ERROR", async () => {
    const { session } = await fixture(1);
    await expectApiError(
      await postRecommendation(
        session.id,
        recoBody({ intent: { ...NEUTRAL_INTENT, rare: 5 } }),
      ),
      400,
      "VALIDATION_ERROR",
    );
    await expectApiError(
      await postRecommendation(
        session.id,
        recoBody({
          constraints: { kurobon1Only: false, genreOverride: ["演歌"] },
        }),
      ),
      400,
      "VALIDATION_ERROR",
    );
    await expectApiError(
      await postRecommendation(session.id, { conditions: {} }),
      400,
      "VALIDATION_ERROR",
    );
  });
});
