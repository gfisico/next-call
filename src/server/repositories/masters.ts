/**
 * 楽器・ジャンルタグ・店舗マスターのデータアクセス
 */
import { asc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  genreTags,
  instruments,
  performanceFrontInstruments,
  venues,
} from "@/db/schema";
import { conflict, notFound } from "@/server/http/errors";
import type {
  InstrumentCreateInput,
  VenueCreateInput,
  VenueUpdateInput,
} from "@/server/validation/masters";
import type { DbOrTx } from "./songs";

// --- instruments -----------------------------------------------------------

/** sort_order 順の楽器一覧 */
export function listInstruments(dbx: DbOrTx = getDb()) {
  return dbx
    .select()
    .from(instruments)
    .orderBy(asc(instruments.sortOrder), asc(instruments.code))
    .all();
}

/** 楽器追加。code 重複は 409。sortOrder 省略時は末尾（max+1） */
export function createInstrument(
  input: InstrumentCreateInput,
  db: Db = getDb(),
) {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(instruments)
      .where(eq(instruments.code, input.code))
      .get();
    if (existing) {
      throw conflict(`楽器コードが既に存在します: ${input.code}`, {
        instrument: existing,
      });
    }
    const sortOrder =
      input.sortOrder ??
      (tx
        .select({ n: sql<number>`coalesce(max(${instruments.sortOrder}), 0)` })
        .from(instruments)
        .get()?.n ?? 0) + 1;
    return tx
      .insert(instruments)
      .values({ code: input.code, label: input.label, sortOrder })
      .returning()
      .get();
  });
}

/** 楽器削除。フロント編成（performance_front_instruments）が参照中なら 409 */
export function deleteInstrument(code: string, db: Db = getDb()): void {
  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(instruments)
      .where(eq(instruments.code, code))
      .get();
    if (!existing) throw notFound(`楽器が見つかりません: ${code}`);
    const used = tx
      .select({ n: sql<number>`count(*)` })
      .from(performanceFrontInstruments)
      .where(eq(performanceFrontInstruments.instrumentCode, code))
      .get();
    if (used && used.n > 0) {
      throw conflict("フロント編成が参照しているため削除できません", {
        usageCount: used.n,
      });
    }
    tx.delete(instruments).where(eq(instruments.code, code)).run();
  });
}

// --- genre_tags（読み取り専用・固定9種） ------------------------------------

export function listGenreTags(dbx: DbOrTx = getDb()) {
  return dbx.select().from(genreTags).orderBy(asc(genreTags.id)).all();
}

// --- venues ------------------------------------------------------------------

export function listVenues(dbx: DbOrTx = getDb()) {
  return dbx.select().from(venues).orderBy(asc(venues.id)).all();
}

/** 店舗追加。is_home は必須（validation 層で担保）。name 重複は 409 */
export function createVenue(input: VenueCreateInput, db: Db = getDb()) {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(venues)
      .where(eq(venues.name, input.name))
      .get();
    if (existing) {
      throw conflict(`同名の店舗が既に存在します: ${input.name}`, {
        venue: existing,
      });
    }
    return tx.insert(venues).values(input).returning().get();
  });
}

/** 店舗更新（name / isHome）。name 重複は 409 */
export function updateVenue(
  id: number,
  patch: VenueUpdateInput,
  db: Db = getDb(),
) {
  return db.transaction((tx) => {
    const existing = tx.select().from(venues).where(eq(venues.id, id)).get();
    if (!existing) throw notFound(`店舗が見つかりません: id=${id}`);
    if (patch.name !== undefined) {
      const dup = tx
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.name, patch.name))
        .get();
      if (dup && dup.id !== id) {
        throw conflict(`同名の店舗が既に存在します: ${patch.name}`);
      }
    }
    return tx
      .update(venues)
      .set(patch)
      .where(eq(venues.id, id))
      .returning()
      .get();
  });
}
