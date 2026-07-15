/**
 * インポートのコミット（unit-08 Task 6）— 単一トランザクション。
 *
 * 途中の throw で全ロールバックし部分取込を残さない（成功基準6）。既存の
 * createSong/createVenue/startSession/addPerformance は各自 db.transaction を開くため
 * ネスト回避のためここでは tx レベルで同等ロジックを直書きする（正規化・楽器コード検証
 * などの純ロジックのみ共有）。
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  genreTags,
  instruments,
  performanceFrontInstruments,
  performances,
  sessions,
  songGenreTags,
  songs,
  venues,
} from "@/db/schema";
import { normalizeTitle } from "@/lib/normalize-title";
import { conflict, validationError } from "@/server/http/errors";
import {
  assertPreview,
  getJobOrThrow,
  markStatus,
  parsedRowsOf,
  resolutionsOf,
} from "@/server/repositories/import-jobs";
import type { Tx } from "@/server/repositories/songs";
import {
  type CommitInput,
  type ResolutionsInput,
  type SetlistsCsvRow,
  type SongsCsvRow,
} from "@/server/validation/import";

export interface CommitSummary {
  type: "songs" | "setlists";
  songsCreated: number;
  songsUpdated: number;
  venuesCreated: number;
  sessionsCreated: number;
  performancesCreated: number;
  stubsCreated: number;
  skippedRows: number;
  hasPlayedRecalculated: number;
}

const emptySummary = (type: CommitSummary["type"]): CommitSummary => ({
  type,
  songsCreated: 0,
  songsUpdated: 0,
  venuesCreated: 0,
  sessionsCreated: 0,
  performancesCreated: 0,
  stubsCreated: 0,
  skippedRows: 0,
  hasPlayedRecalculated: 0,
});

const nowIso = () => new Date().toISOString();

/** ジャンル名 → id を解決する（zod enum 通過後なので通常存在する。無ければ 400） */
function resolveGenreIds(tx: Tx, names: string[]): number[] {
  if (names.length === 0) return [];
  const unique = [...new Set(names)];
  const rows = tx
    .select({ id: genreTags.id, name: genreTags.name })
    .from(genreTags)
    .where(inArray(genreTags.name, unique))
    .all();
  const byName = new Map(rows.map((r) => [r.name, r.id]));
  return unique.map((name) => {
    const id = byName.get(name);
    if (id === undefined) throw validationError(`未知のジャンルタグです: ${name}`);
    return id;
  });
}

/** フロント編成コードが楽器マスターに存在することを検証（未知は 400） */
function assertInstrumentCodes(tx: Tx, codes: string[]): void {
  if (codes.length === 0) return;
  const unique = [...new Set(codes)];
  const found = tx
    .select({ code: instruments.code })
    .from(instruments)
    .where(inArray(instruments.code, unique))
    .all();
  const known = new Set(found.map((r) => r.code));
  const unknown = unique.filter((c) => !known.has(c));
  if (unknown.length > 0) {
    throw validationError(`未知の楽器コードです: ${unknown.join(", ")}`, {
      unknownCodes: unknown,
    });
  }
}

// --- songs コミット ----------------------------------------------------------

function commitSongs(tx: Tx, rows: SongsCsvRow[]): CommitSummary {
  const summary = emptySummary("songs");
  for (const row of rows) {
    const normalized = normalizeTitle(row.title);
    const existing = tx
      .select()
      .from(songs)
      .where(eq(songs.titleNormalized, normalized))
      .get();
    const tagIds = resolveGenreIds(tx, row.genres);

    if (existing) {
      // upsert（既存曲）: 属性を更新。title（原文）は既存を保持し unique 衝突を避ける
      tx.update(songs)
        .set({
          songKey: row.songKey,
          form: row.form,
          composer: row.composer,
          hasPlayed: row.hasPlayed,
          noChartOk: row.noChartOk,
          isStandard: row.isStandard,
          difficulty: row.difficulty,
          inKurobon1: row.inKurobon1,
          season: row.season,
          listenerLevel: row.listenerLevel,
          energyLevel: row.energyLevel,
          note: row.note,
          updatedAt: nowIso(),
        })
        .where(eq(songs.id, existing.id))
        .run();
      // genres 差し替え（全削除 → 再挿入）
      tx.delete(songGenreTags)
        .where(eq(songGenreTags.songId, existing.id))
        .run();
      if (tagIds.length > 0) {
        tx.insert(songGenreTags)
          .values(tagIds.map((genreTagId) => ({ songId: existing.id, genreTagId })))
          .run();
      }
      summary.songsUpdated++;
    } else {
      const created = tx
        .insert(songs)
        .values({
          title: row.title,
          titleNormalized: normalized,
          songKey: row.songKey,
          form: row.form,
          composer: row.composer,
          hasPlayed: row.hasPlayed,
          noChartOk: row.noChartOk,
          isStandard: row.isStandard,
          difficulty: row.difficulty,
          inKurobon1: row.inKurobon1,
          season: row.season,
          listenerLevel: row.listenerLevel,
          energyLevel: row.energyLevel,
          note: row.note,
        })
        .returning({ id: songs.id })
        .get();
      if (tagIds.length > 0) {
        tx.insert(songGenreTags)
          .values(tagIds.map((genreTagId) => ({ songId: created.id, genreTagId })))
          .run();
      }
      summary.songsCreated++;
    }
  }
  return summary;
}

// --- setlists コミット --------------------------------------------------------

type TitleTarget = { kind: "song"; songId: number } | { kind: "skip" };

/** normalized title → 解決先。マスター一致は自動 match、未一致は resolutions に従う */
function resolveTitles(
  tx: Tx,
  rows: SetlistsCsvRow[],
  resolutions: ResolutionsInput | null,
): { map: Map<string, TitleTarget>; stubsCreated: number } {
  // normalized → 代表 csvTitle（プレビューと同じ「初出優先」で一貫させる）
  const repByNorm = new Map<string, string>();
  for (const r of rows) {
    const n = normalizeTitle(r.title);
    if (!repByNorm.has(n)) repByNorm.set(n, r.title);
  }
  const norms = [...repByNorm.keys()];
  const master =
    norms.length === 0
      ? []
      : tx
          .select({ id: songs.id, tn: songs.titleNormalized })
          .from(songs)
          .where(inArray(songs.titleNormalized, norms))
          .all();
  const masterByNorm = new Map(master.map((m) => [m.tn, m.id]));

  const map = new Map<string, TitleTarget>();
  let stubsCreated = 0;

  for (const [norm, rep] of repByNorm) {
    const masterId = masterByNorm.get(norm);
    if (masterId !== undefined) {
      map.set(norm, { kind: "song", songId: masterId });
      continue;
    }
    const res = resolutions?.titles?.[rep];
    if (!res || res.action === "skip") {
      // 未解決 or 明示 skip → 当該行を除外
      map.set(norm, { kind: "skip" });
      continue;
    }
    if (res.action === "match") {
      const exists = tx
        .select({ id: songs.id })
        .from(songs)
        .where(eq(songs.id, res.songId as number))
        .get();
      if (!exists) {
        throw validationError(
          `曲名解決の対象曲が存在しません: songId=${res.songId}`,
        );
      }
      map.set(norm, { kind: "song", songId: res.songId as number });
    } else {
      // create_stub: needs_review=true のスタブを作成
      const created = tx
        .insert(songs)
        .values({
          title: rep,
          titleNormalized: norm,
          needsReview: true,
          hasPlayed: false,
        })
        .returning({ id: songs.id })
        .get();
      stubsCreated++;
      map.set(norm, { kind: "song", songId: created.id });
    }
  }
  return { map, stubsCreated };
}

/** venue_name → id。未知は resolutions の is_home で作成、未解決は 400 */
function resolveVenues(
  tx: Tx,
  rows: SetlistsCsvRow[],
  resolutions: ResolutionsInput | null,
): { map: Map<string, number>; created: number } {
  const names = [...new Set(rows.map((r) => r.venueName))];
  const existing =
    names.length === 0
      ? []
      : tx
          .select({ id: venues.id, name: venues.name })
          .from(venues)
          .where(inArray(venues.name, names))
          .all();
  const map = new Map(existing.map((v) => [v.name, v.id]));
  let created = 0;
  for (const name of names) {
    if (map.has(name)) continue;
    const isHome = resolutions?.venues?.[name];
    if (isHome === undefined) {
      throw validationError(
        `未解決の店舗があります: ${name}（is_home を確定してください）`,
        { venueName: name },
      );
    }
    const v = tx
      .insert(venues)
      .values({ name, isHome })
      .returning({ id: venues.id })
      .get();
    map.set(name, v.id);
    created++;
  }
  return { map, created };
}

function commitSetlists(
  tx: Tx,
  parsed: Array<{ line: number; data: SetlistsCsvRow }>,
  resolutions: ResolutionsInput | null,
  recalcHasPlayed: boolean,
): CommitSummary {
  const summary = emptySummary("setlists");
  const rows = parsed.map((p) => p.data);

  const { map: titleMap, stubsCreated } = resolveTitles(tx, rows, resolutions);
  summary.stubsCreated = stubsCreated;
  const { map: venueMap, created: venuesCreated } = resolveVenues(
    tx,
    rows,
    resolutions,
  );
  summary.venuesCreated = venuesCreated;

  // 取込対象行（skip を除外）を date+venue で集約
  type Item = { line: number; row: SetlistsCsvRow; songId: number };
  const groups = new Map<string, { date: string; venueName: string; items: Item[] }>();
  for (const p of parsed) {
    const norm = normalizeTitle(p.data.title);
    const target = titleMap.get(norm);
    if (!target || target.kind === "skip") {
      summary.skippedRows++;
      continue;
    }
    const key = `${p.data.date} ${p.data.venueName}`;
    let g = groups.get(key);
    if (!g) {
      g = { date: p.data.date, venueName: p.data.venueName, items: [] };
      groups.set(key, g);
    }
    g.items.push({ line: p.line, row: p.data, songId: target.songId });
  }

  // フロント編成コードを一括検証（FK 例外前に明快な 400 を返す）
  const allCodes = rows.flatMap((r) => r.frontInstruments);
  assertInstrumentCodes(tx, allCodes);

  const participatedSongIds = new Set<number>();

  for (const g of groups.values()) {
    const venueId = venueMap.get(g.venueName) as number;
    // 二重取込防止（成功基準7）: 同一 date+venue のセッションが既にあれば conflict
    const dup = tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.sessionDate, g.date), eq(sessions.venueId, venueId)))
      .get();
    if (dup) {
      throw conflict(
        `同一 date+venue のセッションが既に存在します: ${g.date} / ${g.venueName}`,
        { date: g.date, venueName: g.venueName, sessionId: dup.id },
      );
    }
    const session = tx
      .insert(sessions)
      .values({
        sessionDate: g.date,
        venueId,
        status: "ENDED", // 履歴取込
        hasListeners: false,
      })
      .returning({ id: sessions.id })
      .get();
    summary.sessionsCreated++;

    // order 昇順（同 order は行番号でタイブレーク）→ orderIndex を 1.. に採番
    g.items.sort((a, b) => a.row.order - b.row.order || a.line - b.line);
    g.items.forEach((item, i) => {
      const perf = tx
        .insert(performances)
        .values({
          sessionId: session.id,
          songId: item.songId,
          orderIndex: i + 1,
          participated: item.row.participated,
          instrument: item.row.instrument,
          calledByMe: item.row.calledByMe,
          noChart: item.row.noChart,
          note: item.row.note,
        })
        .returning({ id: performances.id })
        .get();
      summary.performancesCreated++;

      const codes = item.row.frontInstruments;
      if (codes.length > 0) {
        tx.insert(performanceFrontInstruments)
          .values(
            codes.map((code, position) => ({
              performanceId: perf.id,
              instrumentCode: code,
              position,
            })),
          )
          .run();
      }

      if (item.row.participated) participatedSongIds.add(item.songId);
    });
  }

  // recalc_has_played: participated=1 の実績を持つ曲の has_played を ON（成功基準8）
  if (recalcHasPlayed && participatedSongIds.size > 0) {
    const ids = [...participatedSongIds];
    const before = tx
      .select({ id: songs.id })
      .from(songs)
      .where(and(inArray(songs.id, ids), eq(songs.hasPlayed, false)))
      .all();
    if (before.length > 0) {
      tx.update(songs)
        .set({ hasPlayed: true, updatedAt: nowIso() })
        .where(inArray(songs.id, before.map((r) => r.id)))
        .run();
    }
    summary.hasPlayedRecalculated = before.length;
  }

  return summary;
}

/**
 * ジョブをコミットする（PREVIEW → COMMITTED）。単一トランザクション。
 */
export function commitImport(
  jobId: number,
  input: CommitInput,
  db: Db = getDb(),
): CommitSummary {
  const job = getJobOrThrow(jobId, db);
  assertPreview(job);
  const resolutions = resolutionsOf(job);

  return db.transaction((tx) => {
    let summary: CommitSummary;
    if (job.type === "songs") {
      summary = commitSongs(tx, parsedRowsOf<SongsCsvRow>(job).map((p) => p.data));
    } else {
      summary = commitSetlists(
        tx,
        parsedRowsOf<SetlistsCsvRow>(job),
        resolutions,
        input.recalcHasPlayed,
      );
    }
    markStatus(jobId, "COMMITTED", tx);
    return summary;
  });
}
