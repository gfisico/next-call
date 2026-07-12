/**
 * API クライアント（unit-03 規約準拠）:
 * - リソース名エンベロープ（{ session } / { songs } 等）を剥がして返す
 * - 204 は void
 * - エラー時は統一形式 { error: { code, message, details? } } を ApiClientError に変換して throw
 *
 * これが唯一の fetch 集約点。SWR フェッチャ・ミューテーションはすべてここを通す
 * （criterion 5 の fetch モックテストを容易にする）。
 */
import type {
  Instrument,
  PerformanceCreatePayload,
  PerformanceUpdatePayload,
  PerformanceWithFront,
  SessionDetail,
  SessionPatchPayload,
  SessionStartPayload,
  SessionSummary,
  Song,
  Venue,
  VenueCreatePayload,
} from "./types";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

/** サーバの統一エラー形式に対応するクライアント例外 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: ApiErrorCode | string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * fetch ラッパー。JSON ボディをそのまま（エンベロープ込みで）返す。
 * エンベロープの key 剥がしは各リソースヘルパで行う。
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      // 同一オリジン Cookie 認証（next-auth）を確実に送る
      credentials: "same-origin",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // ネットワーク断（オフライン耐性: criterion 5）
    throw new ApiClientError(0, "NETWORK_ERROR", "通信エラーが発生しました");
  }

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: { code?: string; message?: string; details?: unknown } })
            .error
        : undefined;
    throw new ApiClientError(
      res.status,
      err?.code ?? "INTERNAL_ERROR",
      err?.message ?? "サーバーエラーが発生しました",
      err?.details,
    );
  }

  return body as T;
}

const jsonBody = (payload: unknown): RequestInit => ({
  body: JSON.stringify(payload),
});

// --- 読み取り（SWR フェッチャとしても利用） --------------------------------

export const fetchActiveSession = () =>
  apiFetch<{ session: SessionDetail }>("/api/sessions/active").then(
    (b) => b.session,
  );

export const fetchSessions = () =>
  apiFetch<{ sessions: SessionSummary[] }>("/api/sessions").then(
    (b) => b.sessions,
  );

export const fetchSession = (id: number) =>
  apiFetch<{ session: SessionDetail }>(`/api/sessions/${id}`).then(
    (b) => b.session,
  );

export const fetchVenues = () =>
  apiFetch<{ venues: Venue[] }>("/api/venues").then((b) => b.venues);

export const fetchInstruments = () =>
  apiFetch<{ instruments: Instrument[] }>("/api/instruments").then(
    (b) => b.instruments,
  );

export const searchSongs = (q: string) =>
  apiFetch<{ songs: Song[] }>(
    `/api/songs?q=${encodeURIComponent(q)}`,
  ).then((b) => b.songs);

// --- ミューテーション ------------------------------------------------------

export const createVenue = (payload: VenueCreatePayload) =>
  apiFetch<{ venue: Venue }>("/api/venues", {
    method: "POST",
    ...jsonBody(payload),
  }).then((b) => b.venue);

export const createSession = (payload: SessionStartPayload) =>
  apiFetch<{ session: SessionDetail }>("/api/sessions", {
    method: "POST",
    ...jsonBody(payload),
  }).then((b) => b.session);

export const patchSession = (id: number, payload: SessionPatchPayload) =>
  apiFetch<{ session: SessionDetail }>(`/api/sessions/${id}`, {
    method: "PATCH",
    ...jsonBody(payload),
  }).then((b) => b.session);

export const addPerformance = (
  sessionId: number,
  payload: PerformanceCreatePayload,
) =>
  apiFetch<{ performance: PerformanceWithFront }>(
    `/api/sessions/${sessionId}/performances`,
    { method: "POST", ...jsonBody(payload) },
  ).then((b) => b.performance);

export const updatePerformance = (
  id: number,
  payload: PerformanceUpdatePayload,
) =>
  apiFetch<{ performance: PerformanceWithFront }>(`/api/performances/${id}`, {
    method: "PATCH",
    ...jsonBody(payload),
  }).then((b) => b.performance);

export const deletePerformance = (id: number) =>
  apiFetch<void>(`/api/performances/${id}`, { method: "DELETE" });

export const quickCreateSong = (title: string) =>
  apiFetch<{ song: Song }>("/api/songs/quick", {
    method: "POST",
    ...jsonBody({ title }),
  }).then((b) => b.song);
