/**
 * Completion Criteria #1:
 * migrate + seed 後、全テーブルが作成され、ジャンルタグ9種・楽器12種・engine.* 設定が
 * 投入されていること。シードは冪等で、既存の設定値を上書きしないこと。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type DatabaseHandle } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import {
  GENRE_TAG_NAMES,
  INSTRUMENT_SEEDS,
  SETTING_SEEDS,
  seedDatabase,
} from "@/db/seed";

const EXPECTED_TABLES = [
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
];

function tableNames(handle: DatabaseHandle): string[] {
  return (
    handle.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("db:migrate + db:seed", () => {
  let handle: DatabaseHandle;

  beforeAll(() => {
    const dir = mkdtempSync(path.join(tmpdir(), "next-call-seed-"));
    handle = openDatabase(path.join(dir, "test.db"));
    runMigrations(handle.db);
    seedDatabase(handle.db);
  });

  it("全12テーブルが作成される", () => {
    const names = tableNames(handle);
    for (const table of EXPECTED_TABLES) {
      expect(names, `missing table: ${table}`).toContain(table);
    }
  });

  it("ジャンルタグ9種が投入される（名称一致）", () => {
    const rows = handle.sqlite
      .prepare("SELECT name FROM genre_tags ORDER BY id")
      .all() as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual([...GENRE_TAG_NAMES]);
    expect(rows).toHaveLength(9);
  });

  it("楽器12種が投入される（コード一致）", () => {
    const rows = handle.sqlite
      .prepare("SELECT code FROM instruments ORDER BY sort_order")
      .all() as Array<{ code: string }>;
    expect(rows.map((r) => r.code)).toEqual(
      INSTRUMENT_SEEDS.map((s) => s.code),
    );
    expect(rows).toHaveLength(12);
  });

  it("engine.* 設定が Provisional Values どおり投入される", () => {
    const rows = handle.sqlite
      .prepare("SELECT key, value FROM settings")
      .all() as Array<{ key: string; value: string }>;
    const actual = Object.fromEntries(
      rows.map((r) => [r.key, JSON.parse(r.value)]),
    );
    expect(actual).toEqual(SETTING_SEEDS);
    // 代表値の明示チェック（discovery.md「Provisional Values」）
    expect(actual["engine.appearance_window_days"]).toBe(730);
    expect(actual["engine.same_key_penalty"]).toBe(15);
    expect(actual["engine.same_key_penalty_overrides"]).toEqual({
      F: 8,
      Bb: 8,
    });
    expect(actual["engine.candidate_count"]).toBe(3);
    expect(actual["engine.random_temperature"]).toBe(5);
    expect(actual["engine.base_score"]).toBe(50);
    expect(actual["pending.auto_release_on_call"]).toBe(true);
    expect(actual["master.default_level"]).toBe(3);
  });

  it("2回実行しても件数が変わらない（冪等）", () => {
    const counts = () => ({
      genres: handle.sqlite
        .prepare("SELECT count(*) AS c FROM genre_tags")
        .get() as { c: number },
      instruments: handle.sqlite
        .prepare("SELECT count(*) AS c FROM instruments")
        .get() as { c: number },
      settings: handle.sqlite
        .prepare("SELECT count(*) AS c FROM settings")
        .get() as { c: number },
    });
    const before = counts();
    seedDatabase(handle.db);
    expect(counts()).toEqual(before);
  });

  it("再シードは既存の設定値を上書きしない（ユーザー調整値の保護）", () => {
    handle.sqlite
      .prepare("UPDATE settings SET value = '99' WHERE key = 'engine.base_score'")
      .run();
    seedDatabase(handle.db);
    const row = handle.sqlite
      .prepare("SELECT value FROM settings WHERE key = 'engine.base_score'")
      .get() as { value: string };
    expect(JSON.parse(row.value)).toBe(99);
  });
});
