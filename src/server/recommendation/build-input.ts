/**
 * EngineInput の組み立て（unit-04 の中核。仕様 Data Sources の集計クエリ群）
 *
 * 方針: 集計は「曲単位に GROUP BY した単一クエリ」+ 少数の補助クエリで N+1 を作らない。
 * スコア計算はここでは一切行わない（境界: src/engine/ のみがスコアを持つ）。
 *
 * 集計の内訳:
 * 1. 曲+ジャンル（listSongs = 2クエリ）
 * 2. 曲別統計（単一 GROUP BY: 店舗区分別登場回数 / 最終演奏日 / 演奏回数 / コール回数）
 * 3. 累計コール上位N曲（count DESC, song_id ASC の決定的タイブレーク）
 * 4. ジャンル別コール比率（全ジャンルを 0 初期化。総コール 0 のときは空 Record = 減点スキップ）
 * 5. 当日演奏済み集合
 * 6. 直前 Performance（order_index 最大）+ フロント編成（0件なら null = §12.5 スキップ）
 * 7. 保留曲
 * 8. 推薦履歴（repositories/recommendations.ts。beforeRequestId で as-of 再構築可）
 */
import { desc, eq, sql } from "drizzle-orm";
import {
  genreTags,
  pendingSongs,
  performanceFrontInstruments,
  performances,
  sessions,
  songGenreTags,
  venues,
} from "@/db/schema";
import type {
  EngineConditions,
  EngineInput,
  EngineSong,
  PreviousPerformance,
  Season,
  SelectionIntent,
  SongStats,
} from "@/engine/types";
import { getRecommendationHistory } from "@/server/repositories/recommendations";
import type { SessionRow } from "@/server/repositories/sessions";
import { listSongs, type DbOrTx, type SongWithTags } from "@/server/repositories/songs";
import type { RepeatReadParams } from "./config";

/** YYYY-MM-DD の days 日前（日付は JST 解釈だが差分計算は暦日ベースで TZ 非依存） */
function dateDaysBefore(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime();
  return new Date(t - days * 86_400_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 同士の日数差（from → to。to が新しいとき正） */
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function toEngineSong(song: SongWithTags): EngineSong {
  return {
    id: song.id,
    title: song.title,
    songKey: song.songKey,
    form: song.form,
    composer: song.composer,
    hasPlayed: song.hasPlayed,
    noChartOk: song.noChartOk,
    isStandard: song.isStandard,
    simpleForm: song.simpleForm,
    inKurobon1: song.inKurobon1,
    season: song.season,
    listenerLevel: song.listenerLevel,
    energyLevel: song.energyLevel,
    needsReview: song.needsReview,
    genres: song.genreTags,
  };
}

export interface BuildEngineInputParams {
  dbx: DbOrTx;
  /** 推薦対象のセッション（session_date と venue_id を使用） */
  session: SessionRow;
  conditions: EngineConditions;
  /** エンジン形の意図（longUnplayed / listener） */
  intent: SelectionIntent;
  currentSeason: Season;
  /** engine.appearance_window_days（登場回数の集計期間） */
  appearanceWindowDays: number;
  /** engine.top_called_n（コール上位曲数） */
  topCalledN: number;
  /** 履歴読み取りパラメータ（recent.count / repeat_window_days） */
  repeatParams: RepeatReadParams;
  /** condition_signature（同一署名回数の読み取りに使用） */
  signature: string;
  /** このリクエスト ID 時点の履歴で as-of 再構築する（seed 再現用） */
  beforeRequestId?: number;
}

export interface BuiltEngineInput {
  input: EngineInput;
  /** レスポンス整形用（候補 songId → 曲情報） */
  songsById: Map<number, SongWithTags>;
}

export function buildEngineInput(params: BuildEngineInputParams): BuiltEngineInput {
  const { dbx, session } = params;

  // 1. 曲マスター + ジャンル
  const allSongs = listSongs({}, dbx);
  const songsById = new Map(allSongs.map((s) => [s.id, s]));
  const engineSongs = allSongs.map(toEngineSong);

  // 当該セッション店舗の店舗区分（is_home）。§13: 登場頻度は店舗区分別に数える
  const venue = dbx
    .select({ isHome: venues.isHome })
    .from(venues)
    .where(eq(venues.id, session.venueId))
    .get();
  const isHome = venue?.isHome ?? false;

  // 2. 曲別統計（単一 GROUP BY クエリ）
  const windowStart = dateDaysBefore(session.sessionDate, params.appearanceWindowDays);
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
          : Math.max(daysBetween(row.lastPlayedDate, session.sessionDate), 0),
      myPlayCount: row.myPlayCount,
      myCallCount: row.myCallCount,
    };
  }
  // 統計に現れない曲は {0, null, 0, 0}（演奏履歴なし）
  for (const song of engineSongs) {
    if (!(song.id in stats)) {
      stats[song.id] = {
        appearanceCount: 0,
        daysSinceLastPlayed: null,
        myPlayCount: 0,
        myCallCount: 0,
      };
    }
  }

  // 3. 累計コール上位N曲（決定的タイブレーク: count DESC, song_id ASC）
  const topCalledSongIds = dbx
    .select({ songId: performances.songId })
    .from(performances)
    .where(eq(performances.calledByMe, true))
    .groupBy(performances.songId)
    .orderBy(sql`count(*) desc`, sql`${performances.songId} asc`)
    .limit(params.topCalledN)
    .all()
    .map((r) => r.songId);

  // 4. ジャンル別コール比率（総コール 0 のときは空 Record = 全ジャンル減点スキップ）
  const totalCalls =
    dbx
      .select({ n: sql<number>`count(*)` })
      .from(performances)
      .where(eq(performances.calledByMe, true))
      .get()?.n ?? 0;
  let genreCallRatios: Record<string, number> = {};
  if (totalCalls > 0) {
    const allTags = dbx.select({ name: genreTags.name }).from(genreTags).all();
    genreCallRatios = Object.fromEntries(allTags.map((t) => [t.name, 0]));
    const genreCounts = dbx
      .select({ name: genreTags.name, n: sql<number>`count(*)` })
      .from(performances)
      .innerJoin(songGenreTags, eq(performances.songId, songGenreTags.songId))
      .innerJoin(genreTags, eq(songGenreTags.genreTagId, genreTags.id))
      .where(eq(performances.calledByMe, true))
      .groupBy(genreTags.name)
      .all();
    for (const row of genreCounts) {
      genreCallRatios[row.name] = row.n / totalCalls;
    }
  }

  // 5. 当日演奏済み集合
  const playedTodaySongIds = dbx
    .selectDistinct({ songId: performances.songId })
    .from(performances)
    .where(eq(performances.sessionId, session.id))
    .all()
    .map((r) => r.songId);

  // 6. 直前 Performance（セッション内 order_index 最大。無ければ null = 1曲目）
  let previousPerformance: PreviousPerformance | null = null;
  const prevRow = dbx
    .select({ id: performances.id, songId: performances.songId })
    .from(performances)
    .where(eq(performances.sessionId, session.id))
    .orderBy(desc(performances.orderIndex))
    .limit(1)
    .get();
  if (prevRow) {
    const prevSong = songsById.get(prevRow.songId);
    const fronts = dbx
      .select({ code: performanceFrontInstruments.instrumentCode })
      .from(performanceFrontInstruments)
      .where(eq(performanceFrontInstruments.performanceId, prevRow.id))
      .orderBy(performanceFrontInstruments.position)
      .all()
      .map((r) => r.code);
    previousPerformance = {
      songKey: prevSong?.songKey ?? null,
      form: prevSong?.form ?? null,
      composer: prevSong?.composer ?? null,
      genres: prevSong?.genreTags ?? [],
      inKurobon1: prevSong?.inKurobon1 ?? null,
      season: prevSong?.season ?? null,
      // フロント編成 0 件 = 未入力 → null（§12.5 の vo 判定をスキップ）
      frontInstruments: fronts.length > 0 ? fronts : null,
    };
  }

  // 7. 保留曲（セッションをまたいで保持）
  const pendingSongIds = dbx
    .select({ songId: pendingSongs.songId })
    .from(pendingSongs)
    .all()
    .map((r) => r.songId);

  // 8. 推薦履歴（Stage 5 の入力）
  const history = getRecommendationHistory(dbx, params.signature, {
    windowDays: params.repeatParams.windowDays,
    recentCount: params.repeatParams.recentCount,
    beforeRequestId: params.beforeRequestId,
  });

  return {
    input: {
      songs: engineSongs,
      stats,
      playedTodaySongIds,
      previousPerformance,
      history,
      topCalledSongIds,
      genreCallRatios,
      currentSeason: params.currentSeason,
      conditions: params.conditions,
      intent: params.intent,
      pendingSongIds,
    },
    songsById,
  };
}
