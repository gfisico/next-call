/**
 * ドライラン差分サマリ（unit-08 Task 5）— DB は一切変更しない（成功基準5）。
 *
 * 解決内容（resolutions）を適用した場合の差分を「読み取りクエリのみ」で算出する。
 * トランザクションは開かない・INSERT/UPDATE を一切行わない。
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { sessions, songs, venues } from "@/db/schema";
import { normalizeTitle } from "@/lib/normalize-title";
import {
  assertPreview,
  getJobOrThrow,
  parsedRowsOf,
  resolutionsOf,
} from "@/server/repositories/import-jobs";
import type { DbOrTx } from "@/server/repositories/songs";
import type {
  ResolutionsInput,
  SetlistsCsvRow,
  SongsCsvRow,
} from "@/server/validation/import";

export interface DryRunSummary {
  type: "songs" | "setlists";
  /** songs: title upsert の内訳 */
  songsToCreate: number;
  songsToUpdate: number;
  /** setlists */
  venuesToCreate: number;
  /** is_home 未解決の未知 venue（コミットは失敗する） */
  unresolvedVenues: number;
  sessionsToCreate: number;
  /** 既存と重複する date+venue（コミットは 409 で失敗する） */
  duplicateSessions: number;
  performancesToCreate: number;
  skippedRows: number;
  stubsToCreate: number;
}

const emptySummary = (type: DryRunSummary["type"]): DryRunSummary => ({
  type,
  songsToCreate: 0,
  songsToUpdate: 0,
  venuesToCreate: 0,
  unresolvedVenues: 0,
  sessionsToCreate: 0,
  duplicateSessions: 0,
  performancesToCreate: 0,
  skippedRows: 0,
  stubsToCreate: 0,
});

function dryRunSongs(dbx: DbOrTx, rows: SongsCsvRow[]): DryRunSummary {
  const summary = emptySummary("songs");
  const norms = [...new Set(rows.map((r) => normalizeTitle(r.title)))];
  const master =
    norms.length === 0
      ? []
      : dbx
          .select({ tn: songs.titleNormalized })
          .from(songs)
          .where(inArray(songs.titleNormalized, norms))
          .all();
  const existing = new Set(master.map((m) => m.tn));
  for (const n of norms) {
    if (existing.has(n)) summary.songsToUpdate++;
    else summary.songsToCreate++;
  }
  return summary;
}

function dryRunSetlists(
  dbx: DbOrTx,
  rows: SetlistsCsvRow[],
  resolutions: ResolutionsInput | null,
): DryRunSummary {
  const summary = emptySummary("setlists");

  // --- title 解決（読み取りのみ） ---
  const repByNorm = new Map<string, string>();
  for (const r of rows) {
    const n = normalizeTitle(r.title);
    if (!repByNorm.has(n)) repByNorm.set(n, r.title);
  }
  const norms = [...repByNorm.keys()];
  const master =
    norms.length === 0
      ? []
      : dbx
          .select({ tn: songs.titleNormalized })
          .from(songs)
          .where(inArray(songs.titleNormalized, norms))
          .all();
  const matched = new Set(master.map((m) => m.tn));
  // normalized → 取込可否（skip なら false）
  const importable = new Map<string, boolean>();
  for (const [norm, rep] of repByNorm) {
    if (matched.has(norm)) {
      importable.set(norm, true);
      continue;
    }
    const res = resolutions?.titles?.[rep];
    if (!res || res.action === "skip") {
      importable.set(norm, false);
    } else if (res.action === "create_stub") {
      summary.stubsToCreate++;
      importable.set(norm, true);
    } else {
      importable.set(norm, true); // match
    }
  }

  // --- venue 解決（読み取りのみ） ---
  const names = [...new Set(rows.map((r) => r.venueName))];
  const existingVenues =
    names.length === 0
      ? []
      : dbx
          .select({ id: venues.id, name: venues.name })
          .from(venues)
          .where(inArray(venues.name, names))
          .all();
  const venueIdByName = new Map(existingVenues.map((v) => [v.name, v.id]));
  for (const name of names) {
    if (venueIdByName.has(name)) continue;
    const isHome = resolutions?.venues?.[name];
    if (isHome === undefined) summary.unresolvedVenues++;
    else summary.venuesToCreate++;
  }

  // --- session / performance 集約 ---
  const groups = new Map<
    string,
    { date: string; venueName: string; count: number }
  >();
  for (const r of rows) {
    const norm = normalizeTitle(r.title);
    if (!importable.get(norm)) {
      summary.skippedRows++;
      continue;
    }
    const key = `${r.date} ${r.venueName}`;
    let g = groups.get(key);
    if (!g) {
      g = { date: r.date, venueName: r.venueName, count: 0 };
      groups.set(key, g);
    }
    g.count++;
    summary.performancesToCreate++;
  }

  for (const g of groups.values()) {
    const venueId = venueIdByName.get(g.venueName);
    if (venueId !== undefined) {
      const dup = dbx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(eq(sessions.sessionDate, g.date), eq(sessions.venueId, venueId)),
        )
        .get();
      if (dup) {
        summary.duplicateSessions++;
        continue;
      }
    }
    summary.sessionsToCreate++;
  }

  return summary;
}

export function dryRunImport(jobId: number, db: Db = getDb()): DryRunSummary {
  const job = getJobOrThrow(jobId, db);
  assertPreview(job);
  const resolutions = resolutionsOf(job);
  if (job.type === "songs") {
    return dryRunSongs(
      db,
      parsedRowsOf<SongsCsvRow>(job).map((p) => p.data),
    );
  }
  return dryRunSetlists(
    db,
    parsedRowsOf<SetlistsCsvRow>(job).map((p) => p.data),
    resolutions,
  );
}
