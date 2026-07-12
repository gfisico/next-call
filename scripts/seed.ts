/**
 * CLI: npm run db:seed
 * ジャンルタグ9種・楽器12種・engine.* 設定初期値を冪等投入する。
 */
import { getDatabasePath } from "../src/db/client";
import { seedDatabase } from "../src/db/seed";

seedDatabase();
console.log(`[db:seed] seeded ${getDatabasePath()}`);
