/**
 * セッションのデータアクセス（仕様§4）
 */
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  performanceFrontInstruments,
  performances,
  sessions,
  songs,
  venues,
} from "@/db/schema";
import { jstDateString } from "@/lib/jst-date";
import { conflict, notFound, validationError } from "@/server/http/errors";
import type {
  SessionStartInput,
  SessionUpdateInput,
} from "@/server/validation/sessions";
import type { DbOrTx } from "./songs";

export type SessionRow = typeof sessions.$inferSelect;
export type PerformanceRow = typeof performances.$inferSelect;

export type FrontInstrumentEntry = { code: string; position: number };

export type PerformanceWithFront = PerformanceRow & {
  songTitle: string;
  /** position 昇順（順序・同一楽器の重複を保持。仕様: Domain Model Review Decision 1） */
  frontInstruments: FrontInstrumentEntry[];
};

export type SessionDetail = SessionRow & {
  venueName: string;
  performances: PerformanceWithFront[];
};

function getSessionOrThrow(dbx: DbOrTx, id: number): SessionRow {
  const row = dbx.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row) throw notFound(`セッションが見つかりません: id=${id}`);
  return row;
}

/** セッションの演奏記録一覧（order_index 昇順、各行にフロント編成を position 順で付与） */
export function listPerformancesForSession(
  dbx: DbOrTx,
  sessionId: number,
): PerformanceWithFront[] {
  const rows = dbx
    .select({ performance: performances, songTitle: songs.title })
    .from(performances)
    .innerJoin(songs, eq(performances.songId, songs.id))
    .where(eq(performances.sessionId, sessionId))
    .orderBy(asc(performances.orderIndex))
    .all();
  if (rows.length === 0) return [];
  const fronts = dbx
    .select()
    .from(performanceFrontInstruments)
    .where(
      inArray(
        performanceFrontInstruments.performanceId,
        rows.map((r) => r.performance.id),
      ),
    )
    .orderBy(asc(performanceFrontInstruments.position))
    .all();
  const byPerf = new Map<number, FrontInstrumentEntry[]>();
  for (const f of fronts) {
    const list = byPerf.get(f.performanceId) ?? [];
    list.push({ code: f.instrumentCode, position: f.position });
    byPerf.set(f.performanceId, list);
  }
  return rows.map((r) => ({
    ...r.performance,
    songTitle: r.songTitle,
    frontInstruments: byPerf.get(r.performance.id) ?? [],
  }));
}

function toDetail(dbx: DbOrTx, row: SessionRow): SessionDetail {
  const venue = dbx
    .select({ name: venues.name })
    .from(venues)
    .where(eq(venues.id, row.venueId))
    .get();
  return {
    ...row,
    venueName: venue?.name ?? "",
    performances: listPerformancesForSession(dbx, row.id),
  };
}

/**
 * セッション開始。session_date 既定 = JST 当日。
 * ACTIVE セッションが既にあれば 409（トランザクション内でチェックし二重開始を防ぐ）。
 */
export function startSession(
  input: SessionStartInput,
  db: Db = getDb(),
): SessionDetail {
  return db.transaction((tx) => {
    const venue = tx
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, input.venueId))
      .get();
    if (!venue) {
      throw validationError(`店舗が存在しません: venueId=${input.venueId}`);
    }
    const active = tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.status, "ACTIVE"))
      .get();
    if (active) {
      throw conflict("進行中のセッションが既に存在します", {
        activeSessionId: active.id,
      });
    }
    const created = tx
      .insert(sessions)
      .values({
        sessionDate: input.sessionDate ?? jstDateString(),
        venueId: input.venueId,
        hasListeners: input.hasListeners ?? false,
      })
      .returning()
      .get();
    return toDetail(tx, created);
  });
}

/** 進行中セッション（演奏記録+フロント編成含む）。無ければ null */
export function getActiveSession(dbx: DbOrTx = getDb()): SessionDetail | null {
  const row = dbx
    .select()
    .from(sessions)
    .where(eq(sessions.status, "ACTIVE"))
    .get();
  return row ? toDetail(dbx, row) : null;
}

/** 履歴一覧（新しい順。venue 名含む） */
export function listSessions(dbx: DbOrTx = getDb()) {
  return dbx
    .select({
      id: sessions.id,
      sessionDate: sessions.sessionDate,
      venueId: sessions.venueId,
      venueName: venues.name,
      hasListeners: sessions.hasListeners,
      status: sessions.status,
      note: sessions.note,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .orderBy(desc(sessions.sessionDate), desc(sessions.id))
    .all();
}

/** 詳細（演奏記録+フロント編成含む）。無ければ 404 */
export function getSession(id: number, dbx: DbOrTx = getDb()): SessionDetail {
  return toDetail(dbx, getSessionOrThrow(dbx, id));
}

/** 更新（has_listeners 切替・note・status: ENDED への遷移のみ） */
export function updateSession(
  id: number,
  patch: SessionUpdateInput,
  db: Db = getDb(),
): SessionDetail {
  return db.transaction((tx) => {
    getSessionOrThrow(tx, id);
    const updated = tx
      .update(sessions)
      .set(patch)
      .where(eq(sessions.id, id))
      .returning()
      .get();
    return toDetail(tx, updated);
  });
}
