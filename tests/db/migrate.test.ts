/**
 * Completion Criteria #7 の共通関数検証:
 * 起動時に instrumentation が呼ぶ runMigrations() が「空 DB → 全テーブル」を成立させること。
 * （instrumentation.ts はこの関数を呼ぶだけの薄いラッパー）
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrate";

describe("runMigrations", () => {
  it("空の DB に全12テーブルを作成する", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "next-call-migrate-"));
    const handle = openDatabase(path.join(dir, "empty.db"));

    runMigrations(handle.db);

    const names = (
      handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(names.sort()).toEqual(
      [
        "songs",
        "genre_tags",
        "song_genre_tags",
        "instruments",
        "venues",
        "sessions",
        "performances",
        "performance_front_instruments",
        "recommendation_requests",
        "recommendation_candidates",
        "pending_songs",
        "settings",
      ].sort(),
    );
  });

  it("2回適用してもエラーにならない（適用済みはスキップ）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "next-call-migrate2-"));
    const handle = openDatabase(path.join(dir, "empty.db"));
    runMigrations(handle.db);
    expect(() => runMigrations(handle.db)).not.toThrow();
  });
});
