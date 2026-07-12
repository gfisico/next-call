/**
 * コンテナ起動時のマイグレーション適用（entrypoint から実行）。
 *
 * standalone ランナーには tsx / TypeScript が無いため、アプリの
 * src/db/migrate.ts（TS）を直接は実行できない。ここでは runtime 依存の
 * better-sqlite3 と drizzle-orm/better-sqlite3/migrator を直接使い、
 * 生成済み SQL（./src/db/migrations）を適用する純 JS ランナーを提供する。
 *
 * - DATABASE_PATH 未設定時は /data/next-call.db（compose の volume マウント先）。
 * - マイグレーションフォルダは cwd 基準（/app/src/db/migrations）。Dockerfile が
 *   COPY --from=builder /app/src/db/migrations ./src/db/migrations で同梱する。
 * - drizzle の migrator は適用済み分をスキップするため冪等。アプリ本体の
 *   instrumentation.ts でも同じ適用が走るが二重適用は無害。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dbPath = process.env.DATABASE_PATH || "/data/next-call.db";
const migrationsFolder = path.join(process.cwd(), "src", "db", "migrations");

if (dbPath !== ":memory:") {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);
migrate(db, { migrationsFolder });
sqlite.close();

console.log(`[docker-migrate] applied migrations to ${dbPath}`);
