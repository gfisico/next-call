/**
 * 設定（key-value ストア）のデータアクセス。value は JSON 文字列で保存されている。
 */
import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { settings } from "@/db/schema";
import type { DbOrTx } from "./songs";

/** 全設定を { key: JSON.parse(value) } で返す */
export function getAllSettings(dbx: DbOrTx = getDb()): Record<string, unknown> {
  const rows = dbx.select().from(settings).all();
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
}

/** 設定の一括/個別 upsert（updated_at も更新）。更新後の全設定を返す */
export function putSettings(
  entries: Record<string, unknown>,
  db: Db = getDb(),
): Record<string, unknown> {
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) continue;
      tx.insert(settings)
        .values({ key, value: JSON.stringify(value), updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: sql`excluded.value`, updatedAt: now },
        })
        .run();
    }
    return getAllSettings(tx);
  });
}
