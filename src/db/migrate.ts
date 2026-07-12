/**
 * マイグレーション適用（drizzle-kit generate で生成した SQL を適用する）
 *
 * - アプリ起動時（src/instrumentation.ts）と CLI（scripts/migrate.ts）の両方から呼ばれる共通関数。
 * - マイグレーションパスは実行時解決。standalone 出力への同梱調整は unit-09 スコープ。
 */
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb, type Db } from "./client";

export function migrationsFolder(): string {
  return path.join(process.cwd(), "src", "db", "migrations");
}

/** 指定 DB（省略時はアプリ共有接続）へマイグレーションを適用する。適用済み分はスキップされる */
export function runMigrations(db: Db = getDb(), folder = migrationsFolder()): void {
  migrate(db, { migrationsFolder: folder });
}
