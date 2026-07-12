/**
 * unit-03 API のレスポンス/リクエスト DTO（camelCase）。
 * サーバのリポジトリ戻り値（src/server/repositories/*）と DB schema（src/db/schema.ts）に一致させる。
 * これらは表示専用の読み取り契約であり、サーバが唯一の情報源。
 */

export type SessionStatus = "ACTIVE" | "ENDED";
export type ParticipationInstrument = "SAX" | "PIANO" | "NONE";
export type SongForm = "AABA" | "ABAC" | "BLUES12" | "OTHER";
export type Season = "SPRING" | "SUMMER" | "AUTUMN" | "WINTER" | "ALL";

/** performance_front_instruments 1 行（position 昇順で並ぶ） */
export interface FrontInstrument {
  code: string;
  position: number;
}

/** sessions 1 行 */
export interface SessionRow {
  id: number;
  sessionDate: string;
  venueId: number;
  hasListeners: boolean;
  status: SessionStatus;
  note: string | null;
  createdAt: string;
}

/** performances 1 行 + 曲名 + フロント編成（GET /api/sessions* が返す形） */
export interface PerformanceWithFront {
  id: number;
  sessionId: number;
  songId: number;
  orderIndex: number;
  participated: boolean;
  instrument: ParticipationInstrument;
  calledByMe: boolean;
  noChart: boolean;
  note: string | null;
  createdAt: string;
  songTitle: string;
  frontInstruments: FrontInstrument[];
}

/** GET /api/sessions/:id・/active・POST /api/sessions が返す詳細 */
export interface SessionDetail extends SessionRow {
  venueName: string;
  performances: PerformanceWithFront[];
}

/** GET /api/sessions（一覧・venueName 付き・新しい順） */
export interface SessionSummary {
  id: number;
  sessionDate: string;
  venueId: number;
  venueName: string;
  hasListeners: boolean;
  status: SessionStatus;
  note: string | null;
  createdAt: string;
}

/** venues 1 行 */
export interface Venue {
  id: number;
  name: string;
  isHome: boolean;
  createdAt: string;
}

/** instruments 1 行（sortOrder 順） */
export interface Instrument {
  code: string;
  label: string;
  sortOrder: number;
}

/** songs 1 行 + genreTags（GET /api/songs・quick 登録が返す形） */
export interface Song {
  id: number;
  title: string;
  titleNormalized: string;
  songKey: string | null;
  form: SongForm;
  composer: string | null;
  hasPlayed: boolean;
  noChartOk: boolean;
  isStandard: boolean;
  simpleForm: boolean;
  inKurobon1: boolean;
  season: Season;
  listenerLevel: number;
  energyLevel: number;
  needsReview: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  genreTags: string[];
}

// --- リクエストペイロード ---------------------------------------------------

export interface VenueCreatePayload {
  name: string;
  isHome: boolean;
}

export interface SessionStartPayload {
  venueId: number;
  hasListeners?: boolean;
  sessionDate?: string;
}

export type SessionPatchPayload =
  | { hasListeners: boolean }
  | { note: string | null }
  | { status: "ENDED" };

/** POST /api/sessions/:id/performances（songId か quickTitle のどちらか一方） */
export interface PerformanceCreatePayload {
  songId?: number;
  quickTitle?: string;
  participated?: boolean;
  instrument?: ParticipationInstrument;
  calledByMe?: boolean;
  noChart?: boolean;
  note?: string | null;
  frontInstruments?: FrontInstrument[];
}

/** PATCH /api/performances/:id（曲の付け替え不可・部分更新） */
export interface PerformanceUpdatePayload {
  participated?: boolean;
  instrument?: ParticipationInstrument;
  calledByMe?: boolean;
  noChart?: boolean;
  note?: string | null;
  frontInstruments?: FrontInstrument[];
}
