/**
 * 保留曲（pending_songs）のデータアクセス（仕様§16）
 *
 * - 曲だけを保存（理由・期限・スコアは持たない）。セッションをまたいで保持
 * - 追加は冪等（既に保留中でも成功として既存行を返す）
 * - コール時自動解除: 演奏記録が called_by_me=true で登録/更新されたとき、
 *   設定 pending.auto_release_on_call（既定 true）に従い保留を解除する
 *   （unit-03 の performances リポジトリからイベントポイントとして呼ばれる）
 */
import { asc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { pendingSongs, settings, songs } from "@/db/schema";
import { notFound, validationError } from "@/server/http/errors";
import { getPendingAutoReleaseOnCall } from "@/server/recommendation/config";
import { attachGenreTags, type DbOrTx, type SongWithTags } from "./songs";

export interface PendingSongEntry {
  song: SongWithTags;
  createdAt: string;
}

/** 保留曲一覧（曲情報込み、追加順）。セッションをまたいで保持される */
export function listPendingSongs(dbx: DbOrTx = getDb()): PendingSongEntry[] {
  const rows = dbx
    .select({ song: songs, createdAt: pendingSongs.createdAt })
    .from(pendingSongs)
    .innerJoin(songs, eq(pendingSongs.songId, songs.id))
    .orderBy(asc(pendingSongs.createdAt), asc(pendingSongs.songId))
    .all();
  const withTags = attachGenreTags(
    dbx,
    rows.map((r) => r.song),
  );
  return withTags.map((song, i) => ({ song, createdAt: rows[i].createdAt }));
}

/** 保留曲の追加。曲が存在しなければ 400。重複は冪等に成功（既存行を返す） */
export function addPendingSong(songId: number, db: Db = getDb()): PendingSongEntry {
  return db.transaction((tx) => {
    const song = tx
      .select({ id: songs.id })
      .from(songs)
      .where(eq(songs.id, songId))
      .get();
    if (!song) {
      throw validationError(`曲が存在しません: songId=${songId}`);
    }
    tx.insert(pendingSongs).values({ songId }).onConflictDoNothing().run();
    const entry = listPendingSongs(tx).find((e) => e.song.id === songId);
    // 直前に挿入（または既存）なので必ず存在する
    return entry as PendingSongEntry;
  });
}

/** 保留曲の手動解除。保留中でなければ 404 */
export function removePendingSong(songId: number, db: Db = getDb()): void {
  db.transaction((tx) => {
    const existing = tx
      .select({ songId: pendingSongs.songId })
      .from(pendingSongs)
      .where(eq(pendingSongs.songId, songId))
      .get();
    if (!existing) {
      throw notFound(`保留曲が見つかりません: songId=${songId}`);
    }
    tx.delete(pendingSongs).where(eq(pendingSongs.songId, songId)).run();
  });
}

/**
 * コール時自動解除フック（called_by_me=true の演奏登録/更新時に呼ぶ）。
 * 設定 pending.auto_release_on_call が false のときは何もしない。
 * 既存トランザクション内で完結させる（呼び出し側の tx を受け取る）。
 */
export function releasePendingSongOnCall(tx: DbOrTx, songId: number): void {
  const row = tx
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "pending.auto_release_on_call"))
    .get();
  const enabled = getPendingAutoReleaseOnCall(
    row ? { "pending.auto_release_on_call": JSON.parse(row.value) } : {},
  );
  if (!enabled) return;
  tx.delete(pendingSongs).where(eq(pendingSongs.songId, songId)).run();
}
