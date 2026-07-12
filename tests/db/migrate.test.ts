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
  it("空の DB に全テーブルを作成する（import_jobs 含む）", () => {
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
        "import_jobs",
      ].sort(),
    );
  });

  it("2回適用してもエラーにならない（適用済みはスキップ）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "next-call-migrate2-"));
    const handle = openDatabase(path.join(dir, "empty.db"));
    runMigrations(handle.db);
    expect(() => runMigrations(handle.db)).not.toThrow();
  });

  it("0001（additive）: seed 列と集計用インデックスが作成される", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "next-call-migrate3-"));
    const handle = openDatabase(path.join(dir, "empty.db"));
    runMigrations(handle.db);

    // recommendation_requests.seed 列（NOT NULL DEFAULT 0）
    const cols = handle.sqlite
      .prepare("PRAGMA table_info(recommendation_requests)")
      .all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
    const seedCol = cols.find((c) => c.name === "seed");
    expect(seedCol).toBeDefined();
    expect(seedCol?.notnull).toBe(1);

    // unit-04 で追加した集計用インデックス
    const indexNames = (
      handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'",
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        "idx_performances_song",
        "idx_performances_session_order",
        "idx_reco_requests_requested_at",
        "idx_reco_requests_signature_requested",
      ]),
    );
  });
});
