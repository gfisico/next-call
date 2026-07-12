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
  CommitPayload,
  CommitSummary,
  DryRunSummary,
  GenreTag,
  ImportJobRef,
  ImportType,
  Instrument,
  InstrumentCreatePayload,
  PendingSongEntry,
  PerformanceCreatePayload,
  PerformanceUpdatePayload,
  PerformanceWithFront,
  PreviewResult,
  RecommendationDefaults,
  RecommendationRequestPayload,
  RecommendationResult,
  ResolutionsPayload,
  SessionDetail,
  SessionPatchPayload,
  SessionStartPayload,
  SessionSummary,
  SettingsMap,
  Song,
  SongListQuery,
  SongUpsertPayload,
  Venue,
  VenueCreatePayload,
  VenueUpdatePayload,
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
  // FormData（multipart アップロード）は Content-Type を付けない
  // （ブラウザが boundary 付きで自動設定する。JSON ヘッダを付けると壊れる）
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(path, {
      // 同一オリジン Cookie 認証（next-auth）を確実に送る
      credentials: "same-origin",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
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

// --- 推薦（unit-04 API・unit-06 選曲支援画面） ------------------------------

export const fetchRecommendationDefaults = (sessionId: number) =>
  apiFetch<{ defaults: RecommendationDefaults }>(
    `/api/sessions/${sessionId}/recommendations/defaults`,
  ).then((b) => b.defaults);

export const postRecommendation = (
  sessionId: number,
  payload: RecommendationRequestPayload,
) =>
  apiFetch<{ recommendation: RecommendationResult }>(
    `/api/sessions/${sessionId}/recommendations`,
    { method: "POST", ...jsonBody(payload) },
  ).then((b) => b.recommendation);

export const fetchPendingSongs = () =>
  apiFetch<{ pendingSongs: PendingSongEntry[] }>("/api/pending-songs").then(
    (b) => b.pendingSongs,
  );

export const addPendingSong = (songId: number) =>
  apiFetch<{ pendingSong: PendingSongEntry }>("/api/pending-songs", {
    method: "POST",
    ...jsonBody({ songId }),
  }).then((b) => b.pendingSong);

export const removePendingSong = (songId: number) =>
  apiFetch<void>(`/api/pending-songs/${songId}`, { method: "DELETE" });

// --- 曲マスター（unit-07・一覧/CRUD） --------------------------------------

/** GET /api/songs のクエリ文字列を組み立てる（inKurobon1 はサーバ非対応のため含めない） */
export function buildSongsQuery(query: SongListQuery = {}): string {
  const params = new URLSearchParams();
  if (query.q && query.q.trim() !== "") params.set("q", query.q.trim());
  if (query.needsReview) params.set("needsReview", "true");
  if (query.hasPlayed) params.set("hasPlayed", "true");
  if (query.genre) params.set("genre", query.genre);
  if (query.season) params.set("season", query.season);
  if (query.sort) params.set("sort", query.sort);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const listSongs = (query: SongListQuery = {}) =>
  apiFetch<{ songs: Song[] }>(`/api/songs${buildSongsQuery(query)}`).then(
    (b) => b.songs,
  );

export const createSong = (payload: SongUpsertPayload) =>
  apiFetch<{ song: Song }>("/api/songs", {
    method: "POST",
    ...jsonBody(payload),
  }).then((b) => b.song);

export const updateSong = (id: number, payload: SongUpsertPayload) =>
  apiFetch<{ song: Song }>(`/api/songs/${id}`, {
    method: "PATCH",
    ...jsonBody(payload),
  }).then((b) => b.song);

export const deleteSong = (id: number) =>
  apiFetch<void>(`/api/songs/${id}`, { method: "DELETE" });

export const fetchGenreTags = () =>
  apiFetch<{ genreTags: GenreTag[] }>("/api/genre-tags").then(
    (b) => b.genreTags,
  );

// --- 設定・楽器・店舗（unit-07） --------------------------------------------

export const getSettings = () =>
  apiFetch<{ settings: SettingsMap }>("/api/settings").then((b) => b.settings);

/** 既知キーのみの部分更新（PUT）。ネスト葉は親オブジェクトごと送る */
export const putSettings = (entries: SettingsMap) =>
  apiFetch<{ settings: SettingsMap }>("/api/settings", {
    method: "PUT",
    ...jsonBody(entries),
  }).then((b) => b.settings);

export const createInstrument = (payload: InstrumentCreatePayload) =>
  apiFetch<{ instrument: Instrument }>("/api/instruments", {
    method: "POST",
    ...jsonBody(payload),
  }).then((b) => b.instrument);

export const updateVenue = (id: number, payload: VenueUpdatePayload) =>
  apiFetch<{ venue: Venue }>(`/api/venues/${id}`, {
    method: "PATCH",
    ...jsonBody(payload),
  }).then((b) => b.venue);

// --- CSV インポート4段階（unit-08 API） ------------------------------------

/** Step1: multipart アップロード → PREVIEW ジョブ作成 */
export const uploadImport = (type: ImportType, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<PreviewResult>(`/api/import/${type}`, {
    method: "POST",
    body: form,
  });
};

/** Step2: 解決内容の保存（PREVIEW 以外は 409） */
export const saveResolutions = (jobId: number, payload: ResolutionsPayload) =>
  apiFetch<{ job: ImportJobRef; resolutions: ResolutionsPayload }>(
    `/api/import/jobs/${jobId}/resolutions`,
    { method: "POST", ...jsonBody(payload) },
  );

/** Step3: ドライラン差分（DB 変更なし） */
export const fetchDryRun = (jobId: number) =>
  apiFetch<{ summary: DryRunSummary }>(
    `/api/import/jobs/${jobId}/dry-run`,
  ).then((b) => b.summary);

/** Step4: コミット（PREVIEW 以外は 409） */
export const commitImport = (jobId: number, payload: CommitPayload = {}) =>
  apiFetch<{ summary: CommitSummary }>(
    `/api/import/jobs/${jobId}/commit`,
    { method: "POST", ...jsonBody(payload) },
  ).then((b) => b.summary);

/** ジョブ破棄（DISCARDED） */
export const discardImport = (jobId: number) =>
  apiFetch<void>(`/api/import/jobs/${jobId}`, { method: "DELETE" });

// --- エクスポート（ファイルダウンロード。JSON パースを通さない別経路） -----

/**
 * GET /api/export をファイルとしてダウンロードする。
 * content-disposition の filename を尊重し、blob→objectURL→<a download> クリック。
 */
export async function downloadExport(): Promise<void> {
  const res = await fetch("/api/export", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      "INTERNAL_ERROR",
      "エクスポートに失敗しました",
    );
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? "next-call-export.json";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
