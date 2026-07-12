/**
 * Success Criteria #1（設定 API の正常系+異常系）:
 * - engine.* 全キー取得、個別/一括更新
 * - 未知キー 400、型不一致 400
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SETTING_SEEDS } from "@/db/seed";
import {
  expectApiError,
  jsonRequest,
  setupTestDb,
  teardownTestDb,
} from "./helpers";

beforeEach(async () => {
  await setupTestDb();
});

afterEach(() => {
  teardownTestDb();
});

const route = () => import("@/app/api/settings/route");

describe("GET /api/settings", () => {
  it("シードした全キーが JSON 値（パース済み）で返る", async () => {
    const { GET } = await route();
    const res = await GET();
    expect(res.status).toBe(200);
    const { settings } = await res.json();
    expect(Object.keys(settings).sort()).toEqual(
      Object.keys(SETTING_SEEDS).sort(),
    );
    expect(settings["engine.appearance_window_days"]).toBe(730);
    expect(settings["pending.auto_release_on_call"]).toBe(true);
    expect(settings["engine.same_key_penalty_overrides"]).toEqual({
      F: 8,
      Bb: 8,
    });
  });
});

describe("PUT /api/settings", () => {
  it("個別キーを更新できる（他キーは不変）", async () => {
    const { PUT, GET } = await route();
    const res = await PUT(
      jsonRequest("/api/settings", "PUT", {
        "engine.candidate_count": 5,
      }),
    );
    expect(res.status).toBe(200);
    const { settings } = await res.json();
    expect(settings["engine.candidate_count"]).toBe(5);
    expect(settings["engine.base_score"]).toBe(50);

    const after = await (await GET()).json();
    expect(after.settings["engine.candidate_count"]).toBe(5);
  });

  it("複数キーを一括更新できる（boolean / object も型どおり）", async () => {
    const { PUT } = await route();
    const res = await PUT(
      jsonRequest("/api/settings", "PUT", {
        "pending.auto_release_on_call": false,
        "engine.same_key_penalty_overrides": { F: 5 },
        "engine.pool_band": 12,
      }),
    );
    expect(res.status).toBe(200);
    const { settings } = await res.json();
    expect(settings["pending.auto_release_on_call"]).toBe(false);
    expect(settings["engine.same_key_penalty_overrides"]).toEqual({ F: 5 });
    expect(settings["engine.pool_band"]).toBe(12);
  });

  it("未知キーは 400", async () => {
    const { PUT } = await route();
    const res = await PUT(
      jsonRequest("/api/settings", "PUT", { "engine.unknown_key": 1 }),
    );
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("型不一致（number キーに string）は 400", async () => {
    const { PUT } = await route();
    const res = await PUT(
      jsonRequest("/api/settings", "PUT", { "engine.pool_band": "wide" }),
    );
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  it("型不一致（object キーに number）・空ボディは 400", async () => {
    const { PUT } = await route();
    const bad = await PUT(
      jsonRequest("/api/settings", "PUT", { "engine.safety_weights": 3 }),
    );
    await expectApiError(bad, 400, "VALIDATION_ERROR");

    const empty = await PUT(jsonRequest("/api/settings", "PUT", {}));
    await expectApiError(empty, 400, "VALIDATION_ERROR");
  });
});
