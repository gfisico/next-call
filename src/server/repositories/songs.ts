/**
 * 曲マスターのデータアクセス（Route は薄く保ち、業務ロジックはここに置く）
 *
 * better-sqlite3 のため drizzle の同期 API（.all() / .get() / .run()）と
 * 同期トランザクション db.transaction((tx) => { ... }) を使う。
 */
import { and, asc, desc, eq, inArray, like, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  genreTags,
  pendingSongs,
  performances,
  recommendationCandidates,
  songGenreTags,
  songs,
} from "@/db/schema";
import { normalizeTitle } from "@/lib/normalize-title";
import { conflict, notFound, validationError } from "@/server/http/errors";
import type {
  SongCreateInput,
  SongListQuery,
  SongUpdateInput,
} from "@/server/validation/songs";

/** drizzle 同期トランザクションのコールバック引数型（Db と同じクエリ API を持つ） */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export type SongRow = typeof songs.$inferSelect;
export type SongWithTags = SongRow & { genreTags: string[] };

const nowIso = () => new Date().toISOString();

/** 曲配列にジャンルタグ名（シード順）を付与する */
function attachGenreTags(dbx: DbOrTx, rows: SongRow[]): SongWithTags[] {
  if (rows.length === 0) return [];
  const links = dbx
    .select({
      songId: songGenreTags.songId,
      tagId: genreTags.id,
      name: genreTags.name,
    })
    .from(songGenreTags)
    .innerJoin(genreTags, eq(songGenreTags.genreTagId, genreTags.id))
    .where(
      inArray(
        songGenreTags.songId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(genreTags.id))
    .all();
  const bySong = new Map<number, string[]>();
  for (const l of links) {
    const list = bySong.get(l.songId) ?? [];
    list.push(l.name);
    bySong.set(l.songId, list);
  }
  return rows.map((r) => ({ ...r, genreTags: bySong.get(r.id) ?? [] }));
}

/** タグ名 → id を解決する（未知タグは 400。zod enum 通過後なので通常発生しない） */
function resolveTagIds(dbx: DbOrTx, names: string[]): number[] {
  if (names.length === 0) return [];
  const unique = [...new Set(names)];
  const rows = dbx
    .select({ id: genreTags.id, name: genreTags.name })
    .from(genreTags)
    .where(inArray(genreTags.name, unique))
    .all();
  const byName = new Map(rows.map((r) => [r.name, r.id]));
  return unique.map((name) => {
    const id = byName.get(name);
    if (id === undefined) {
      throw validationError(`未知のジャンルタグです: ${name}`);
    }
    return id;
  });
}

function getSongOrThrow(dbx: DbOrTx, id: number): SongRow {
  const row = dbx.select().from(songs).where(eq(songs.id, id)).get();
  if (!row) throw notFound(`曲が見つかりません: id=${id}`);
  return row;
}

/** 一覧+検索（title 部分一致）・フィルタ・ソート。ジャンルタグを含めて返す */
export function listSongs(
  query: SongListQuery,
  dbx: DbOrTx = getDb(),
): SongWithTags[] {
  const conds: SQL[] = [];
  if (query.q) conds.push(like(songs.title, `%${query.q}%`));
  if (query.needsReview !== undefined) {
    conds.push(eq(songs.needsReview, query.needsReview));
  }
  if (query.hasPlayed !== undefined) {
    conds.push(eq(songs.hasPlayed, query.hasPlayed));
  }
  if (query.season) conds.push(eq(songs.season, query.season));
  if (query.genre) {
    conds.push(
      inArray(
        songs.id,
        dbx
          .select({ songId: songGenreTags.songId })
          .from(songGenreTags)
          .innerJoin(genreTags, eq(songGenreTags.genreTagId, genreTags.id))
          .where(eq(genreTags.name, query.genre)),
      ),
    );
  }
  const order =
    query.sort === "updated"
      ? [desc(songs.updatedAt), desc(songs.id)]
      : [asc(songs.title)];
  const rows = dbx
    .select()
    .from(songs)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(...order)
    .all();
  return attachGenreTags(dbx, rows);
}

export function getSong(id: number, dbx: DbOrTx = getDb()): SongWithTags {
  const row = getSongOrThrow(dbx, id);
  return attachGenreTags(dbx, [row])[0];
}

/** 全属性+ジャンルタグ配列で作成。title 重複は 409 */
export function createSong(
  input: SongCreateInput,
  db: Db = getDb(),
): SongWithTags {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(songs)
      .where(eq(songs.title, input.title))
      .get();
    if (existing) {
      throw conflict(`同名の曲が既に存在します: ${input.title}`, {
        song: attachGenreTags(tx, [existing])[0],
      });
    }
    const { genreTags: tagNames, ...fields } = input;
    const tagIds = resolveTagIds(tx, tagNames ?? []);
    const created = tx
      .insert(songs)
      .values({ ...fields, titleNormalized: normalizeTitle(input.title) })
      .returning()
      .get();
    if (tagIds.length > 0) {
      tx.insert(songGenreTags)
        .values(tagIds.map((genreTagId) => ({ songId: created.id, genreTagId })))
        .run();
    }
    return attachGenreTags(tx, [created])[0];
  });
}

/** 部分更新（needs_review 解除・ジャンルタグ差し替え含む）。updated_at を更新する */
export function updateSong(
  id: number,
  patch: SongUpdateInput,
  db: Db = getDb(),
): SongWithTags {
  return db.transaction((tx) => {
    getSongOrThrow(tx, id);
    const { genreTags: tagNames, ...fields } = patch;
    const values: Partial<typeof songs.$inferInsert> = {
      ...fields,
      updatedAt: nowIso(),
    };
    if (patch.title !== undefined) {
      const dup = tx
        .select({ id: songs.id })
        .from(songs)
        .where(eq(songs.title, patch.title))
        .get();
      if (dup && dup.id !== id) {
        throw conflict(`同名の曲が既に存在します: ${patch.title}`);
      }
      values.titleNormalized = normalizeTitle(patch.title);
    }
    const updated = tx
      .update(songs)
      .set(values)
      .where(eq(songs.id, id))
      .returning()
      .get();
    if (tagNames !== undefined) {
      tx.delete(songGenreTags).where(eq(songGenreTags.songId, id)).run();
      const tagIds = resolveTagIds(tx, tagNames);
      if (tagIds.length > 0) {
        tx.insert(songGenreTags)
          .values(tagIds.map((genreTagId) => ({ songId: id, genreTagId })))
          .run();
      }
    }
    return attachGenreTags(tx, [updated])[0];
  });
}

/**
 * 削除。演奏記録・推薦候補履歴が参照している場合は 409（履歴保全）。
 * 参照が無ければ song_genre_tags・pending_songs を先に消してから本体を削除する。
 */
export function deleteSong(id: number, db: Db = getDb()): void {
  db.transaction((tx) => {
    getSongOrThrow(tx, id);
    const perfCount = tx
      .select({ n: sql<number>`count(*)` })
      .from(performances)
      .where(eq(performances.songId, id))
      .get();
    if (perfCount && perfCount.n > 0) {
      throw conflict(
        "演奏記録が参照しているため削除できません（履歴保全）",
        { performanceCount: perfCount.n },
      );
    }
    const candCount = tx
      .select({ n: sql<number>`count(*)` })
      .from(recommendationCandidates)
      .where(eq(recommendationCandidates.songId, id))
      .get();
    if (candCount && candCount.n > 0) {
      throw conflict(
        "推薦履歴が参照しているため削除できません（履歴保全）",
        { candidateCount: candCount.n },
      );
    }
    tx.delete(songGenreTags).where(eq(songGenreTags.songId, id)).run();
    tx.delete(pendingSongs).where(eq(pendingSongs.songId, id)).run();
    tx.delete(songs).where(eq(songs.id, id)).run();
  });
}

export type QuickCreateResult =
  | { created: true; song: SongWithTags }
  | { created: false; song: SongWithTags };

/**
 * クイック登録（仕様: セッション中のマスタ未登録曲）。
 * - 正規化後 title（normalizeTitle）完全一致の既存曲があれば { created: false, song: 既存曲 }
 *   （Route /api/songs/quick では 409 + 既存曲返却、演奏記録追加の内部呼び出しでは既存曲に紐付け）
 * - 無ければ needs_review=true, has_played=false, 他は既定値で作成
 */
export function quickCreateSong(
  title: string,
  dbx: DbOrTx = getDb(),
): QuickCreateResult {
  const normalized = normalizeTitle(title);
  const existing = dbx
    .select()
    .from(songs)
    .where(eq(songs.titleNormalized, normalized))
    .get();
  if (existing) {
    return { created: false, song: attachGenreTags(dbx, [existing])[0] };
  }
  const created = dbx
    .insert(songs)
    .values({
      title,
      titleNormalized: normalized,
      needsReview: true,
      hasPlayed: false,
    })
    .returning()
    .get();
  return { created: true, song: { ...created, genreTags: [] } };
}
