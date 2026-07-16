/**
 * 曲別集計の中立ユーティリティ（unit-04）
 *
 * 推薦入力（src/server/recommendation/build-input.ts）と統計（src/server/repositories/stats.ts）が
 * 共有する曲別集計の骨格を、推薦にも統計にも依存しない純粋な集計 util として切り出したもの。
 *
 * 設計線引き:
 * - `aggregatePerSongStats` は「現在セッション基準・店舗区分別・期間付き appearanceCount」という
 *   推薦固有の意味論を持つ集計（旧 build-input.ts L117-154 の逐語移設）。推薦専用だが、集計の
 *   骨格（GROUP BY performances × sessions × venues）と日付ヘルパはここに集約して汎用化する。
 * - 統計側（stats.ts）は「フィルタ可能な素のコール/演奏/最終演奏日」を必要とし条件が異なるため、
 *   同じ骨格を独自に組む（ジャンル比率のような推薦専用ロジックはここには入れない）。
 * - この分離により推薦の挙動は不変に保たれる（tests/api/recommendation-input.test.ts が回帰担保）。
 */
import { eq, sql } from "drizzle-orm";
import { performances, sessions, venues } from "@/db/schema";
import type { SongStats } from "@/engine/types";
import type { DbOrTx } from "@/server/repositories/songs";

/** YYYY-MM-DD の days 日前（日付は JST 解釈だが差分計算は暦日ベースで TZ 非依存） */
export function dateDaysBefore(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime();
  return new Date(t - days * 86_400_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 同士の日数差（from → to。to が新しいとき正） */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export interface AggregatePerSongStatsParams {
  /** ゼロ埋め対象の曲 id（演奏履歴が無い曲を {0,null,0,0} で埋める） */
  songIds: number[];
  /** 店舗区分（appearanceCount の CASE 条件。§13 登場頻度は店舗区分別に数える） */
  isHome: boolean;
  /** appearanceCount の集計期間下限（session_date >= windowStart） */
  windowStart: string;
  /** daysSinceLastPlayed の基準日（= session.sessionDate） */
  asOfDate: string;
}

/**
 * 曲別統計（単一 GROUP BY クエリ）:
 *   appearanceCount = 店舗区分別 × 期間内の登場回数
 *   daysSinceLastPlayed = participated=true の最終演奏日から asOfDate までの日数（0 未満は 0 に clamp）
 *   myPlayCount = participated 合計（期間無制限）
 *   myCallCount = called_by_me 合計（期間無制限）
 * 統計に現れない曲（songIds のうち履歴なし）は {0, null, 0, 0} でゼロ埋めする。
 */
export function aggregatePerSongStats(
  dbx: DbOrTx,
  params: AggregatePerSongStatsParams,
): Record<number, SongStats> {
  const { isHome, windowStart, asOfDate } = params;
  const statsRows = dbx
    .select({
      songId: performances.songId,
      appearanceCount: sql<number>`sum(case when ${venues.isHome} = ${isHome ? 1 : 0} and ${sessions.sessionDate} >= ${windowStart} then 1 else 0 end)`,
      lastPlayedDate: sql<string | null>`max(case when ${performances.participated} = 1 then ${sessions.sessionDate} end)`,
      myPlayCount: sql<number>`sum(case when ${performances.participated} = 1 then 1 else 0 end)`,
      myCallCount: sql<number>`sum(case when ${performances.calledByMe} = 1 then 1 else 0 end)`,
    })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .groupBy(performances.songId)
    .all();
  const stats: Record<number, SongStats> = {};
  for (const row of statsRows) {
    stats[row.songId] = {
      appearanceCount: row.appearanceCount,
      daysSinceLastPlayed:
        row.lastPlayedDate === null
          ? null
          : Math.max(daysBetween(row.lastPlayedDate, asOfDate), 0),
      myPlayCount: row.myPlayCount,
      myCallCount: row.myCallCount,
    };
  }
  // 統計に現れない曲は {0, null, 0, 0}（演奏履歴なし）
  for (const songId of params.songIds) {
    if (!(songId in stats)) {
      stats[songId] = {
        appearanceCount: 0,
        daysSinceLastPlayed: null,
        myPlayCount: 0,
        myCallCount: 0,
      };
    }
  }
  return stats;
}
