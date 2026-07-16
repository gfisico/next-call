/**
 * 統計集計のデータアクセス（unit-04 要件6・読み取り専用）
 *
 * すべての指標を SQL の GROUP BY / 集約で求める（アプリ側ループ集計・N+1 を作らない）。
 * 共通フィルタ（venue / season / from-to）を performances × sessions × venues の JOIN に
 * WHERE として合成し、各指標クエリで再利用する。
 *
 * 季節（season）の意味論: セッション日付の月境界（JST）で判定する。曲マスターの songs.season
 * ではなく、settings.engine.season_months（既定 3-5/6-8/9-11/12-2）を seasonForDate で解決する。
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  genreTags,
  performances,
  sessions,
  songGenreTags,
  songs,
  venues,
} from "@/db/schema";
import type { Season } from "@/engine/types";
import type {
  StatsBucket,
  StatsMonthlyPoint,
  StatsResponse,
  StatsSeasonTrend,
  StatsSongStat,
  StatsVenueTrend,
} from "@/lib/api/types";
import { seasonForDate } from "@/server/recommendation/season";
import { getAllSettings } from "./settings";
import type { DbOrTx } from "./songs";
import type { StatsQuery } from "@/server/validation/stats";

const SEASON_ORDER: Season[] = ["SPRING", "SUMMER", "AUTUMN", "WINTER"];

/** 未設定キーの表示バケット名（byKey の songKey=null 用） */
const UNSET_KEY = "(未設定)";

/** session_date の月（1-12）を整数で取り出す SQL 式 */
const monthNumberExpr = sql<number>`cast(substr(${sessions.sessionDate}, 6, 2) as integer)`;

/**
 * 月（1-12）→ 季節のマップを settings.engine.season_months から構築する。
 * seasonForDate を各月の代表日で呼ぶことで既存の季節解決ロジックを再利用する。
 */
function buildMonthSeasonMap(seasonMonthsSetting: unknown): Record<number, Season> {
  const map: Record<number, Season> = {};
  for (let m = 1; m <= 12; m++) {
    const date = `2001-${String(m).padStart(2, "0")}-15`;
    map[m] = seasonForDate(date, seasonMonthsSetting);
  }
  return map;
}

/** 共通フィルタ条件（venue / season / from-to）を SQL[] で組む */
function buildConds(
  filter: StatsQuery,
  monthSeasonMap: Record<number, Season>,
): SQL[] {
  const conds: SQL[] = [];
  if (filter.venue === "home") {
    conds.push(eq(venues.isHome, true));
  } else if (filter.venue === "non_home") {
    conds.push(eq(venues.isHome, false));
  } else if (typeof filter.venue === "number") {
    conds.push(eq(sessions.venueId, filter.venue));
  }
  if (filter.season && filter.season !== "ALL") {
    const target = filter.season;
    const months = Object.entries(monthSeasonMap)
      .filter(([, s]) => s === target)
      .map(([m]) => Number(m));
    conds.push(inArray(monthNumberExpr, months));
  }
  if (filter.from) conds.push(gte(sessions.sessionDate, filter.from));
  if (filter.to) conds.push(lte(sessions.sessionDate, filter.to));
  return conds;
}

/**
 * 統計を集計して返す（全指標を数クエリで完結・N+1 なし）。
 * フィルタ下で 1 度も登場しない曲・分布キーは結果に含めない。
 */
export function getStats(
  filter: StatsQuery,
  dbx: DbOrTx = getDb(),
): StatsResponse {
  const seasonMonthsSetting = getAllSettings(dbx)["engine.season_months"];
  const monthSeasonMap = buildMonthSeasonMap(seasonMonthsSetting);
  const conds = buildConds(filter, monthSeasonMap);
  const where = conds.length > 0 ? and(...conds) : undefined;

  const callCountExpr = sql<number>`sum(case when ${performances.calledByMe} = 1 then 1 else 0 end)`;
  const playCountExpr = sql<number>`sum(case when ${performances.participated} = 1 then 1 else 0 end)`;
  const lastPlayedExpr = sql<string | null>`max(case when ${performances.participated} = 1 then ${sessions.sessionDate} end)`;
  const countExpr = sql<number>`count(*)`;

  // --- 曲別（3-A） ---------------------------------------------------------
  const songRows = dbx
    .select({
      songId: performances.songId,
      title: songs.title,
      callCount: callCountExpr,
      playCount: playCountExpr,
      lastPlayedDate: lastPlayedExpr,
    })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .innerJoin(songs, eq(performances.songId, songs.id))
    .where(where)
    .groupBy(performances.songId, songs.title)
    .orderBy(desc(callCountExpr), asc(performances.songId))
    .all();
  const songStats: StatsSongStat[] = songRows.map((r) => ({
    songId: r.songId,
    title: r.title,
    callCount: r.callCount,
    playCount: r.playCount,
    lastPlayedDate: r.lastPlayedDate,
  }));

  // --- 分布（3-B）: フィルタ下の演奏件数カウント --------------------------
  // byGenre（1曲複数ジャンルは各ジャンルで加算）
  const byGenre: StatsBucket[] = dbx
    .select({ key: genreTags.name, count: countExpr })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .innerJoin(songGenreTags, eq(songGenreTags.songId, performances.songId))
    .innerJoin(genreTags, eq(genreTags.id, songGenreTags.genreTagId))
    .where(where)
    .groupBy(genreTags.name)
    .orderBy(desc(countExpr), asc(genreTags.name))
    .all();

  // byKey（songKey=null は "(未設定)" バケットへ）
  const keyBucketExpr = sql<string>`coalesce(${songs.songKey}, ${UNSET_KEY})`;
  const byKey: StatsBucket[] = dbx
    .select({ key: keyBucketExpr, count: countExpr })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .innerJoin(songs, eq(performances.songId, songs.id))
    .where(where)
    .groupBy(keyBucketExpr)
    .orderBy(desc(countExpr), asc(keyBucketExpr))
    .all();

  // byForm（4 値固定）
  const byForm: StatsBucket[] = dbx
    .select({ key: songs.form, count: countExpr })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .innerJoin(songs, eq(performances.songId, songs.id))
    .where(where)
    .groupBy(songs.form)
    .orderBy(desc(countExpr), asc(songs.form))
    .all();

  // --- 傾向（3-C） ---------------------------------------------------------
  // byVenue
  const byVenue: StatsVenueTrend[] = dbx
    .select({
      venueId: sessions.venueId,
      venueName: venues.name,
      count: countExpr,
    })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .where(where)
    .groupBy(sessions.venueId, venues.name)
    .orderBy(desc(countExpr), asc(sessions.venueId))
    .all();

  // byHome（is_home 2 行 → { home, nonHome }）
  const homeRows = dbx
    .select({ isHome: venues.isHome, count: countExpr })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .where(where)
    .groupBy(venues.isHome)
    .all();
  const byHome = { home: 0, nonHome: 0 };
  for (const r of homeRows) {
    if (r.isHome) byHome.home += r.count;
    else byHome.nonHome += r.count;
  }

  // bySeason（月別に集計 → 月→季節マップで 4 季節へ畳み込み）
  const seasonMonthRows = dbx
    .select({ month: monthNumberExpr, count: countExpr })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .where(where)
    .groupBy(monthNumberExpr)
    .all();
  const seasonCounts: Record<Season, number> = {
    SPRING: 0,
    SUMMER: 0,
    AUTUMN: 0,
    WINTER: 0,
  };
  for (const r of seasonMonthRows) {
    seasonCounts[monthSeasonMap[r.month]] += r.count;
  }
  const bySeason: StatsSeasonTrend[] = SEASON_ORDER.map((season) => ({
    season,
    count: seasonCounts[season],
  }));

  // --- 月別推移（3-D） -----------------------------------------------------
  // 月別の演奏総数・異なる曲数
  const monthKeyExpr = sql<string>`substr(${sessions.sessionDate}, 1, 7)`;
  const monthlyRows = dbx
    .select({
      month: monthKeyExpr,
      plays: countExpr,
      distinctSongs: sql<number>`count(distinct ${performances.songId})`,
    })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .where(where)
    .groupBy(monthKeyExpr)
    .orderBy(asc(monthKeyExpr))
    .all();
  // 曲ごとのフィルタ後集合内 初登場月（min(session_date) の月）→ 月別の新曲数
  const firstSeenRows = dbx
    .select({
      songId: performances.songId,
      firstMonth: sql<string>`substr(min(${sessions.sessionDate}), 1, 7)`,
    })
    .from(performances)
    .innerJoin(sessions, eq(performances.sessionId, sessions.id))
    .innerJoin(venues, eq(sessions.venueId, venues.id))
    .where(where)
    .groupBy(performances.songId)
    .all();
  const newSongsByMonth: Record<string, number> = {};
  for (const r of firstSeenRows) {
    newSongsByMonth[r.firstMonth] = (newSongsByMonth[r.firstMonth] ?? 0) + 1;
  }
  const monthly: StatsMonthlyPoint[] = monthlyRows.map((r) => {
    const newSongs = newSongsByMonth[r.month] ?? 0;
    return {
      month: r.month,
      songsPlayed: r.distinctSongs,
      // 新曲率 = 当月初登場曲数 / 当月の異なる曲数（0 除算は 0）
      newSongRate: r.distinctSongs > 0 ? newSongs / r.distinctSongs : 0,
      // 多様性 = 異なる曲数 / 演奏総数（0–1・高いほど反復が少ない。0 除算は 0）
      diversity: r.plays > 0 ? r.distinctSongs / r.plays : 0,
    };
  });

  return {
    songs: songStats,
    distributions: { byGenre, byKey, byForm },
    trends: { bySeason, byVenue, byHome },
    monthly,
  };
}
