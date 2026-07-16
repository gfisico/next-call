/**
 * セッションのデータアクセス（仕様§4）
 */
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  instruments,
  performanceFrontInstruments,
  performances,
  recommendationCandidates,
  recommendationRequests,
  sessionParticipants,
  sessions,
  songs,
  venues,
} from "@/db/schema";
import { jstDateString } from "@/lib/jst-date";
import { conflict, notFound, validationError } from "@/server/http/errors";
import type {
  SessionParticipantsInput,
  SessionStartInput,
  SessionUpdateInput,
} from "@/server/validation/sessions";
import type { DbOrTx } from "./songs";

export type SessionRow = typeof sessions.$inferSelect;
export type PerformanceRow = typeof performances.$inferSelect;
export type SessionParticipantRow = typeof sessionParticipants.$inferSelect;

export type FrontInstrumentEntry = { code: string; position: number };

export type PerformanceWithFront = PerformanceRow & {
  songTitle: string;
  /** position 昇順（順序・同一楽器の重複を保持。仕様: Domain Model Review Decision 1） */
  frontInstruments: FrontInstrumentEntry[];
};

export type SessionParticipantEntry = { instrumentCode: string; count: number };

export type SessionDetail = SessionRow & {
  venueName: string;
  performances: PerformanceWithFront[];
  /** パート別参加者数（instrument_code 昇順。リスナーは含まない。unit-02） */
  participants: SessionParticipantEntry[];
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

/** セッションのパート別参加者数（instrument_code 昇順） */
export function listSessionParticipants(
  dbx: DbOrTx,
  sessionId: number,
): SessionParticipantEntry[] {
  return dbx
    .select({
      instrumentCode: sessionParticipants.instrumentCode,
      count: sessionParticipants.count,
    })
    .from(sessionParticipants)
    .where(eq(sessionParticipants.sessionId, sessionId))
    .orderBy(asc(sessionParticipants.instrumentCode))
    .all();
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
    participants: listSessionParticipants(dbx, row.id),
  };
}

/** 楽器コードが実在することを検証（未知は 400、details に unknownCodes） */
function assertInstrumentCodesExist(dbx: DbOrTx, codes: string[]): void {
  if (codes.length === 0) return;
  const unique = [...new Set(codes)];
  const found = dbx
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

/**
 * 更新（sessionDate・venueId・has_listeners 切替・note・status: ENDED への遷移）。
 * venueId 変更時は店舗の存在を検証する（無ければ 400。startSession と同一方針）。
 */
export function updateSession(
  id: number,
  patch: SessionUpdateInput,
  db: Db = getDb(),
): SessionDetail {
  return db.transaction((tx) => {
    getSessionOrThrow(tx, id);
    if (patch.venueId !== undefined) {
      const venue = tx
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.id, patch.venueId))
        .get();
      if (!venue) {
        throw validationError(`店舗が存在しません: venueId=${patch.venueId}`);
      }
    }
    const updated = tx
      .update(sessions)
      .set(patch)
      .where(eq(sessions.id, id))
      .returning()
      .get();
    return toDetail(tx, updated);
  });
}

/**
 * パート別参加者数を置換する（全消し→再挿入）。tx 内から呼ぶこと。
 * - instrumentCode の実在検証（未知は 400）
 * - 同一 instrumentCode の重複は 400（PK 衝突を明快なメッセージに変換）
 * - count は validation 層で 0 以上を担保済み
 */
function replaceSessionParticipantsTx(
  tx: DbOrTx,
  sessionId: number,
  rows: SessionParticipantEntry[],
): void {
  const codes = rows.map((r) => r.instrumentCode);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length > 0) {
    throw validationError(
      `参加者の楽器コードが重複しています: ${[...new Set(dupes)].join(", ")}`,
      { duplicateCodes: [...new Set(dupes)] },
    );
  }
  assertInstrumentCodesExist(tx, codes);
  tx.delete(sessionParticipants)
    .where(eq(sessionParticipants.sessionId, sessionId))
    .run();
  if (rows.length > 0) {
    tx.insert(sessionParticipants)
      .values(
        rows.map((r) => ({
          sessionId,
          instrumentCode: r.instrumentCode,
          count: r.count,
        })),
      )
      .run();
  }
}

/**
 * パート別参加者数の置換 + リスナー数/ホストパートの更新を 1 トランザクションで実行する。
 *
 * participants は全消し→再挿入（body がそのままセッションの参加者になる）。
 * listenerCount / hostInstrumentCode は undefined なら据え置き、null で明示クリア。
 * 存在しない session は 404、未知 instrumentCode / hostInstrumentCode は 400。
 */
export function putSessionParticipants(
  sessionId: number,
  input: SessionParticipantsInput,
  db: Db = getDb(),
): SessionDetail {
  return db.transaction((tx) => {
    getSessionOrThrow(tx, sessionId);

    if (
      input.hostInstrumentCode !== undefined &&
      input.hostInstrumentCode !== null
    ) {
      assertInstrumentCodesExist(tx, [input.hostInstrumentCode]);
    }

    replaceSessionParticipantsTx(tx, sessionId, input.participants);

    const patch: Partial<SessionRow> = {};
    if (input.listenerCount !== undefined) {
      patch.listenerCount = input.listenerCount;
    }
    if (input.hostInstrumentCode !== undefined) {
      patch.hostInstrumentCode = input.hostInstrumentCode;
    }
    if (Object.keys(patch).length > 0) {
      tx.update(sessions).set(patch).where(eq(sessions.id, sessionId)).run();
    }

    return getSession(sessionId, tx);
  });
}

/**
 * セッションの物理削除（単一トランザクション・cascade）。
 *
 * FK 強制（src/db/client.ts foreign_keys = ON・明示 CASCADE 無し）のため、
 * sessions を参照する全テーブルを葉→根の順で手動削除する。
 * 現行 sessions 参照テーブルは performances / recommendation_requests /
 * session_participants の 3 つ（src/db/schema.ts 全走査で確認）。削除順:
 *   1. recommendation_candidates（request_id → recommendation_requests）
 *   2. recommendation_requests（session_id → sessions）
 *   3. performance_front_instruments（performance_id → performances）
 *   4. session_participants（session_id → sessions）
 *   5. performances（session_id → sessions）
 *   6. sessions
 *
 * pending_songs は songs 参照でセッション横断保持のため削除しない（仕様§16）。
 * 存在しない id は 404。削除件数（= 削除した sessions 行数）を返す。
 */
export function deleteSessionCascade(
  id: number,
  db: Db = getDb(),
): { deleted: number } {
  return db.transaction((tx) => {
    getSessionOrThrow(tx, id);

    // 子テーブルの絞り込み用に、このセッションに属する id 群を先に取得する
    const perfIds = tx
      .select({ id: performances.id })
      .from(performances)
      .where(eq(performances.sessionId, id))
      .all()
      .map((r) => r.id);
    const requestIds = tx
      .select({ id: recommendationRequests.id })
      .from(recommendationRequests)
      .where(eq(recommendationRequests.sessionId, id))
      .all()
      .map((r) => r.id);

    // 1. recommendation_candidates（request_id → recommendation_requests）
    if (requestIds.length > 0) {
      tx.delete(recommendationCandidates)
        .where(inArray(recommendationCandidates.requestId, requestIds))
        .run();
    }
    // 2. recommendation_requests（session_id → sessions）
    tx.delete(recommendationRequests)
      .where(eq(recommendationRequests.sessionId, id))
      .run();
    // 3. performance_front_instruments（performance_id → performances）
    if (perfIds.length > 0) {
      tx.delete(performanceFrontInstruments)
        .where(inArray(performanceFrontInstruments.performanceId, perfIds))
        .run();
    }
    // 4. session_participants（session_id FK・notNull → foreign_keys=ON のため必須）
    tx.delete(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, id))
      .run();
    // 5. performances（session_id → sessions）
    tx.delete(performances).where(eq(performances.sessionId, id)).run();
    // 6. sessions
    const result = tx.delete(sessions).where(eq(sessions.id, id)).run();

    return { deleted: result.changes };
  });
}
