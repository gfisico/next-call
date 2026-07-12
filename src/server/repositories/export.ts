/**
 * 全データエクスポート（operable: バックアップと独立したユーザー主導の復旧手段）
 *
 * 全12テーブルを単一 JSON に含める。テーブルを追加した場合はここにも追加すること
 * （tests/api/export.test.ts の EXPORT_TABLE_KEYS が網羅を検証している）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "@/db/client";
import { migrationsFolder } from "@/db/migrate";
import {
  genreTags,
  instruments,
  pendingSongs,
  performanceFrontInstruments,
  performances,
  recommendationCandidates,
  recommendationRequests,
  sessions,
  settings,
  songGenreTags,
  songs,
  venues,
} from "@/db/schema";
import type { DbOrTx } from "./songs";

/** スキーマバージョン = 適用済みマイグレーションの最新 tag（journal 由来） */
function schemaVersion(): string {
  try {
    const journal = JSON.parse(
      readFileSync(path.join(migrationsFolder(), "meta", "_journal.json"), "utf8"),
    ) as { entries?: Array<{ tag?: string }> };
    return journal.entries?.at(-1)?.tag ?? "unknown";
  } catch {
    return "unknown";
  }
}

export interface ExportPayload {
  exported_at: string;
  schema_version: string;
  songs: unknown[];
  genre_tags: unknown[];
  song_genre_tags: unknown[];
  instruments: unknown[];
  venues: unknown[];
  sessions: unknown[];
  performances: unknown[];
  performance_front_instruments: unknown[];
  recommendation_requests: unknown[];
  recommendation_candidates: unknown[];
  pending_songs: unknown[];
  settings: unknown[];
}

/** 全テーブルのデータを単一 JSON ペイロードとして返す */
export function exportAll(dbx: DbOrTx = getDb()): ExportPayload {
  return {
    exported_at: new Date().toISOString(),
    schema_version: schemaVersion(),
    songs: dbx.select().from(songs).all(),
    genre_tags: dbx.select().from(genreTags).all(),
    song_genre_tags: dbx.select().from(songGenreTags).all(),
    instruments: dbx.select().from(instruments).all(),
    venues: dbx.select().from(venues).all(),
    sessions: dbx.select().from(sessions).all(),
    performances: dbx.select().from(performances).all(),
    performance_front_instruments: dbx
      .select()
      .from(performanceFrontInstruments)
      .all(),
    recommendation_requests: dbx.select().from(recommendationRequests).all(),
    recommendation_candidates: dbx.select().from(recommendationCandidates).all(),
    pending_songs: dbx.select().from(pendingSongs).all(),
    settings: dbx.select().from(settings).all(),
  };
}
