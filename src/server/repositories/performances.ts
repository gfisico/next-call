/**
 * 演奏記録のデータアクセス（仕様§5）
 *
 * - order_index は同一セッション内で max+1 採番、削除時に 1..N へ詰め直す
 *   （欠番/重複を防ぐため必ず同期トランザクション内で実施）
 * - participated=true の登録/更新で songs.has_played を true に自動更新する
 *   （アライメントゲート確定事項）
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  instruments,
  performanceFrontInstruments,
  performances,
  sessions,
  songs,
} from "@/db/schema";
import { conflict, notFound, validationError } from "@/server/http/errors";
import type {
  PerformanceCreateInput,
  PerformanceUpdateInput,
} from "@/server/validation/performances";
import {
  listPerformancesForSession,
  type PerformanceWithFront,
} from "./sessions";
import { quickCreateSong, type DbOrTx, type Tx } from "./songs";

type FrontInput = { code: string; position: number };

/** フロント編成の code が楽器マスターに存在することを検証する（無ければ 400） */
function assertInstrumentCodes(dbx: DbOrTx, entries: FrontInput[]): void {
  if (entries.length === 0) return;
  const codes = [...new Set(entries.map((e) => e.code))];
  const found = dbx
    .select({ code: instruments.code })
    .from(instruments)
    .where(inArray(instruments.code, codes))
    .all();
  const known = new Set(found.map((r) => r.code));
  const unknown = codes.filter((c) => !known.has(c));
  if (unknown.length > 0) {
    throw validationError(
      `未知の楽器コードです: ${unknown.join(", ")}`,
      { unknownCodes: unknown },
    );
  }
}

/**
 * フロント編成を position 0.. で挿入する。
 * 入力の position 順にソートしたうえで 0 始まりに振り直す（順序・同一楽器の重複を保持）。
 */
function insertFrontInstruments(
  tx: Tx,
  performanceId: number,
  entries: FrontInput[],
): void {
  if (entries.length === 0) return;
  const ordered = [...entries].sort((a, b) => a.position - b.position);
  tx.insert(performanceFrontInstruments)
    .values(
      ordered.map((e, i) => ({
        performanceId,
        instrumentCode: e.code,
        position: i,
      })),
    )
    .run();
}

/** participated=true の演奏で対象曲の has_played を true にする（false→true のみ） */
function markSongPlayed(tx: Tx, songId: number): void {
  tx.update(songs)
    .set({ hasPlayed: true, updatedAt: new Date().toISOString() })
    .where(eq(songs.id, songId))
    .run();
}

function getPerformanceOrThrow(dbx: DbOrTx, id: number) {
  const row = dbx
    .select()
    .from(performances)
    .where(eq(performances.id, id))
    .get();
  if (!row) throw notFound(`演奏記録が見つかりません: id=${id}`);
  return row;
}

function toWithFront(dbx: DbOrTx, perfId: number, sessionId: number) {
  const found = listPerformancesForSession(dbx, sessionId).find(
    (p) => p.id === perfId,
  );
  // 直前に挿入/更新した行なので必ず存在する
  return found as PerformanceWithFront;
}

/**
 * 演奏記録の追加（単一トランザクション）:
 * (a) quickTitle 指定時は quickCreateSong を内部呼び出し
 *     （正規化後同名の既存曲があれば 409 にせず既存曲へ紐付ける）
 * (b) order_index = COALESCE(MAX(order_index), 0) + 1
 * (c) performances 挿入
 * (d) フロント編成を position 0.. で挿入
 * (e) participated=true なら songs.has_played = true に更新
 * ENDED セッションへの追加は 409。
 */
export function addPerformance(
  sessionId: number,
  input: PerformanceCreateInput,
  db: Db = getDb(),
): PerformanceWithFront {
  return db.transaction((tx) => {
    const session = tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    if (!session) {
      throw notFound(`セッションが見つかりません: id=${sessionId}`);
    }
    if (session.status === "ENDED") {
      throw conflict("終了したセッションには演奏記録を追加できません");
    }

    let songId: number;
    if (input.quickTitle !== undefined) {
      songId = quickCreateSong(input.quickTitle, tx).song.id;
    } else {
      const song = tx
        .select({ id: songs.id })
        .from(songs)
        .where(eq(songs.id, input.songId as number))
        .get();
      if (!song) {
        throw validationError(`曲が存在しません: songId=${input.songId}`);
      }
      songId = song.id;
    }

    const fronts = input.frontInstruments ?? [];
    assertInstrumentCodes(tx, fronts);

    const maxIndex =
      tx
        .select({ n: sql<number>`coalesce(max(${performances.orderIndex}), 0)` })
        .from(performances)
        .where(eq(performances.sessionId, sessionId))
        .get()?.n ?? 0;

    const created = tx
      .insert(performances)
      .values({
        sessionId,
        songId,
        orderIndex: maxIndex + 1,
        participated: input.participated ?? false,
        instrument: input.instrument ?? "NONE",
        calledByMe: input.calledByMe ?? false,
        noChart: input.noChart ?? false,
        note: input.note ?? null,
      })
      .returning()
      .get();

    insertFrontInstruments(tx, created.id, fronts);

    if (created.participated) {
      markSongPlayed(tx, songId);
    }

    return toWithFront(tx, created.id, sessionId);
  });
}

/**
 * 演奏記録の部分更新。
 * - frontInstruments 指定時はトランザクション内で全削除→再挿入（順序・重複を保持）
 * - participated が false→true になる場合も has_played 更新を発火する
 */
export function updatePerformance(
  id: number,
  patch: PerformanceUpdateInput,
  db: Db = getDb(),
): PerformanceWithFront {
  return db.transaction((tx) => {
    const existing = getPerformanceOrThrow(tx, id);
    const { frontInstruments: fronts, ...fields } = patch;

    if (fronts !== undefined) {
      assertInstrumentCodes(tx, fronts);
      tx.delete(performanceFrontInstruments)
        .where(eq(performanceFrontInstruments.performanceId, id))
        .run();
      insertFrontInstruments(tx, id, fronts);
    }

    const updated =
      Object.values(fields).some((v) => v !== undefined)
        ? tx
            .update(performances)
            .set(fields)
            .where(eq(performances.id, id))
            .returning()
            .get()
        : existing;

    if (updated.participated) {
      markSongPlayed(tx, updated.songId);
    }

    return toWithFront(tx, id, updated.sessionId);
  });
}

/**
 * 演奏記録の削除。トランザクション内でフロント編成→本体を削除し、
 * 同一セッション内の order_index を 1..N に詰め直す。
 *
 * 注意（仕様）: 演奏記録を削除しても songs.has_played は false に巻き戻さない
 * （履歴と「コール可能」という能力は別物。Success Criteria / Risks に明記）。
 */
export function deletePerformance(id: number, db: Db = getDb()): void {
  db.transaction((tx) => {
    const existing = getPerformanceOrThrow(tx, id);
    tx.delete(performanceFrontInstruments)
      .where(eq(performanceFrontInstruments.performanceId, id))
      .run();
    tx.delete(performances).where(eq(performances.id, id)).run();

    // 残りを order_index 昇順で 1..N に採番し直す
    const rest = tx
      .select({ id: performances.id, orderIndex: performances.orderIndex })
      .from(performances)
      .where(eq(performances.sessionId, existing.sessionId))
      .orderBy(asc(performances.orderIndex))
      .all();
    rest.forEach((row, i) => {
      const next = i + 1;
      if (row.orderIndex !== next) {
        tx.update(performances)
          .set({ orderIndex: next })
          .where(eq(performances.id, row.id))
          .run();
      }
    });
  });
}
