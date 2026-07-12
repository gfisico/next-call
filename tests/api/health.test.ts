/**
 * Completion Criteria #5:
 * GET /api/health が認証なしで 200 と DB 接続状態を返す。
 * （認証を経由しないハンドラ直接呼び出し。DB は一時ファイル）
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules(); // DB シングルトンを破棄して次のテストで再初期化させる
  });

  it("DB 接続 OK のとき 200 { status: ok, db: ok }", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "next-call-health-"));
    vi.stubEnv("DATABASE_PATH", path.join(dir, "health.db"));

    const { GET } = await import("@/app/api/health/route");
    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", db: "ok" });
  });

  it("DB を開けないとき 503 { status: error, db: error }", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "next-call-health-err-"));
    // DB パスにディレクトリを置いて open を失敗させる
    const bogus = path.join(dir, "not-a-file.db");
    mkdirSync(bogus);
    vi.stubEnv("DATABASE_PATH", bogus);

    const { GET } = await import("@/app/api/health/route");
    const res = GET();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      status: "error",
      db: "error",
    });
  });
});
