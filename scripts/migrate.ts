/**
 * CLI: npm run db:migrate
 * DATABASE_PATH（既定 ./data/next-call.db）へマイグレーションを適用する。
 */
import { getDatabasePath } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

runMigrations();
console.log(`[db:migrate] applied migrations to ${getDatabasePath()}`);
