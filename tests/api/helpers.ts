/**
 * API 統合テスト共通ヘルパ
 *
 * 方式（tests/api/health.test.ts のパターンを踏襲）:
 * - Route Handler を「直接 import して呼ぶ」（サーバー起動なし）
 * - DATABASE_PATH を一時ファイルに stub し、vi.resetModules() で
 *   src/db/client.ts の lazy singleton をテストごとに隔離する
 * - Next.js 15 の dynamic route params は Promise なので routeParams() で包む
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, vi } from "vitest";

/**
 * 一時 DB を作成し、マイグレーション + シードを適用する。
 * 各テストの beforeEach で呼ぶこと。
 */
export async function setupTestDb(): Promise<void> {
  vi.resetModules();
  const dir = mkdtempSync(path.join(tmpdir(), "next-call-api-"));
  vi.stubEnv("DATABASE_PATH", path.join(dir, "test.db"));
  const { runMigrations } = await import("@/db/migrate");
  const { seedDatabase } = await import("@/db/seed");
  runMigrations();
  seedDatabase();
}

/** 各テストの afterEach で呼ぶこと（env と module registry を復元） */
export function teardownTestDb(): void {
  vi.unstubAllEnvs();
  vi.resetModules();
}

/** テスト内から DB を直接読むためのアクセサ（同一 module registry の singleton を返す） */
export async function testDb() {
  const { getDb } = await import("@/db/client");
  return getDb();
}

/** JSON ボディ付きリクエストを作る */
export function jsonRequest(
  url: string,
  method: string,
  body?: unknown,
): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** GET リクエスト（クエリは url に含める） */
export function getRequest(url: string): Request {
  return new Request(`http://localhost${url}`);
}

/** Next.js 15 dynamic route の第 2 引数（params は Promise） */
export function routeParams<P extends Record<string, string>>(
  params: P,
): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

/**
 * 統一エラー形式のアサーション共通ヘルパ（Success Criteria #7）。
 * error.details があれば呼び出し側で追加検証できるよう body を返す。
 */
export async function expectApiError(
  res: Response,
  status: number,
  code: string,
): Promise<{ error: { code: string; message: string; details?: unknown } }> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body).toMatchObject({
    error: { code, message: expect.any(String) },
  });
  return body;
}
