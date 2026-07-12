"use client";

/**
 * SWR による GET キャッシュフック。ミューテーションは client.ts を直呼びし、
 * 成功後に mutate(SWR_KEYS.*) で再検証する運用（SWRConfig は必須にしない）。
 */
import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  ApiClientError,
  buildSongsQuery,
  fetchActiveSession,
  fetchGenreTags,
  fetchInstruments,
  fetchRecommendationDefaults,
  fetchSession,
  fetchSessions,
  fetchVenues,
  getSettings,
  listSongs,
  searchSongs,
} from "./client";
import type {
  GenreTag,
  Instrument,
  RecommendationDefaults,
  SessionDetail,
  SessionSummary,
  SettingsMap,
  Song,
  SongListQuery,
  Venue,
} from "./types";

/** mutate() で参照する SWR キー（ミューテーション後の再検証に使う） */
export const SWR_KEYS = {
  activeSession: "/api/sessions/active",
  sessions: "/api/sessions",
  venues: "/api/venues",
  instruments: "/api/instruments",
  settings: "/api/settings",
  genreTags: "/api/genre-tags",
  session: (id: number) => `/api/sessions/${id}`,
  /** 曲一覧はクエリごとにキーを分ける（フィルタ変更で再取得） */
  songs: (query: SongListQuery = {}) => `/api/songs${buildSongsQuery(query)}`,
  recommendationDefaults: (id: number) =>
    `/api/sessions/${id}/recommendations/defaults`,
} as const;

/** 進行中セッション。無い場合（404）は null を正常値として返す */
export function useActiveSession() {
  const { data, error, isLoading, mutate } = useSWR<SessionDetail | null>(
    SWR_KEYS.activeSession,
    async () => {
      try {
        return await fetchActiveSession();
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
  );
  return { session: data ?? null, error, isLoading, mutate };
}

export function useSessions() {
  const { data, error, isLoading, mutate } = useSWR<SessionSummary[]>(
    SWR_KEYS.sessions,
    fetchSessions,
  );
  return { sessions: data ?? [], error, isLoading, mutate };
}

export function useSession(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<SessionDetail>(
    id === null ? null : SWR_KEYS.session(id),
    () => fetchSession(id as number),
  );
  return { session: data ?? null, error, isLoading, mutate };
}

export function useVenues() {
  const { data, error, isLoading, mutate } = useSWR<Venue[]>(
    SWR_KEYS.venues,
    fetchVenues,
  );
  return { venues: data ?? [], error, isLoading, mutate };
}

/** 選曲支援画面の初期値（前回意図値・条件既定・季節感推奨フラグ）。GET のみ */
export function useRecommendationDefaults(sessionId: number | null) {
  const { data, error, isLoading } = useSWR<RecommendationDefaults>(
    sessionId === null ? null : SWR_KEYS.recommendationDefaults(sessionId),
    () => fetchRecommendationDefaults(sessionId as number),
  );
  return { defaults: data ?? null, error, isLoading };
}

export function useInstruments() {
  const { data, error, isLoading, mutate } = useSWR<Instrument[]>(
    SWR_KEYS.instruments,
    fetchInstruments,
  );
  return { instruments: data ?? [], error, isLoading, mutate };
}

/**
 * 曲マスター一覧（検索 q + サーバ側フィルタ）。
 * クエリを直列化した文字列を key にし、フィルタ変更で自動再取得する。
 * keepPreviousData で検索中のちらつきを防ぐ。
 */
export function useSongs(query: SongListQuery = {}) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<Song[]>(
    SWR_KEYS.songs(query),
    () => listSongs(query),
    { keepPreviousData: true },
  );
  return {
    songs: data ?? [],
    error,
    isLoading,
    isValidating,
    mutate,
  };
}

/** 全設定（engine.* ほか）。ミューテーション後は mutate で再検証 */
export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<SettingsMap>(
    SWR_KEYS.settings,
    getSettings,
  );
  return { settings: data ?? null, error, isLoading, mutate };
}

/** ジャンル・特徴タグ（固定9種） */
export function useGenreTags() {
  const { data, error, isLoading } = useSWR<GenreTag[]>(
    SWR_KEYS.genreTags,
    fetchGenreTags,
  );
  return { genreTags: data ?? [], error, isLoading };
}

/**
 * 曲名インクリメンタル検索。
 * - debounce 250ms（Risks: 検索のもたつき対策）
 * - 空文字は fetch しない（key=null）
 * - keepPreviousData で直近結果を保持（入力中のちらつき防止＝「直近結果キャッシュ」）
 */
export function useSongSearch(term: string, debounceMs = 250) {
  const [debounced, setDebounced] = useState(term.trim());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [term, debounceMs]);

  const { data, error, isLoading, isValidating } = useSWR<Song[]>(
    debounced ? ["/api/songs", debounced] : null,
    () => searchSongs(debounced),
    { keepPreviousData: true },
  );

  return {
    songs: data ?? [],
    /** debounce 後の実効検索語（呼び出し側の「ヒットなし」判定に使う） */
    query: debounced,
    error,
    isLoading,
    isValidating,
  };
}
