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
  /** リスナー客数（未設定は null。unit-02） */
  listenerCount: number | null;
  /** ホストパートの楽器コード（未設定は null。unit-02） */
  hostInstrumentCode: string | null;
  createdAt: string;
}

/** session_participants 1 行（instrument_code 昇順。リスナーは含まない） */
export interface SessionParticipant {
  instrumentCode: string;
  count: number;
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
  /** パート別参加者数（instrument_code 昇順。リスナーは含まない。unit-02） */
  participants: SessionParticipant[];
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
  /** @deprecated difficulty へ移行中。読み取り契約としては当面残置 */
  simpleForm: boolean;
  inKurobon1: boolean;
  season: Season;
  listenerLevel: number;
  energyLevel: number;
  /** 難易度 1–5（simple_form の後継）。未設定は null */
  difficulty: number | null;
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

/**
 * PATCH /api/sessions/:id の部分更新ボディ（sessionUpdateSchema と一致・camelCase）。
 * 少なくとも 1 キーを送る（サーバ側 nonEmptyObject で担保）。
 */
export type SessionPatchPayload = Partial<{
  hasListeners: boolean;
  note: string | null;
  status: "ENDED";
  sessionDate: string;
  venueId: number;
}>;

/** PUT /api/sessions/:id/participants のボディ（sessionParticipantsSchema と一致） */
export interface SessionParticipantsPayload {
  participants: SessionParticipant[];
  /** 省略で据え置き / null で明示クリア */
  listenerCount?: number | null;
  /** 省略で据え置き / null で明示クリア */
  hostInstrumentCode?: string | null;
}

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

// --- 推薦（unit-04 API・unit-06 選曲支援画面） ------------------------------

/** ジャンル・特徴 全9種（src/engine/types.ts ALL_GENRES と一致） */
export type Genre =
  | "バラード"
  | "ボサノバ"
  | "3拍子"
  | "モード"
  | "ファンク"
  | "ブルース"
  | "歌もの"
  | "循環"
  | "キメが多い曲";

export type HornsCondition = "ONE" | "MULTI" | "UNKNOWN";
export type BeginnerCondition = "NONE" | "PRESENT" | "UNKNOWN";

/**
 * 選曲意図（API 契約形。fresh = エンジンの longUnplayed）。
 * スライダー rare/fresh/safety/mood/ballad は -2..+2 の整数。
 */
export interface RecommendationIntent {
  rare: number;
  fresh: number;
  safety: number;
  mood: number;
  ballad: number;
  seasonal: boolean;
  listener: boolean;
}

/** 編成条件 + 制約（画面 state。POST では conditions/constraints に分割して送る） */
export interface RecommendationConditions {
  horns: HornsCondition;
  beginner: BeginnerCondition;
  kurobon1Only: boolean;
  genreOverride: Genre[];
}

/** GET .../recommendations/defaults のレスポンス */
export interface RecommendationDefaults {
  intent: RecommendationIntent;
  conditions: RecommendationConditions;
  /** 1曲目の季節感 ON 初期化フラグ（適用は UI 側で行う。仕様§9.7） */
  suggestSeasonalOn: boolean;
}

/** 推奨理由（API 文字列そのまま表示） */
export interface ReasonView {
  code: string;
  text: string;
}

/** 通常候補 */
export interface RecommendationCandidateView {
  song: Song;
  score: number;
  reasons: ReasonView[];
  isPending: boolean;
}

export type ConditionalBranch =
  | "HORNS_ONE"
  | "HORNS_MULTI"
  | "BEGINNER_NONE"
  | "BEGINNER_PRESENT";

/** 条件別候補（存在時のみ・conditionLabel は API 提供文字列） */
export interface ConditionalCandidateView {
  song: Song;
  score: number;
  reasons: ReasonView[];
  branch: ConditionalBranch;
  conditionLabel: string;
}

/** 保留曲の警告（現在条件で再評価済み） */
export type PendingWarning =
  | "PLAYED_TODAY"
  | "SAME_FORM"
  | "KUROBON1_MISMATCH"
  | "FORMATION_MISMATCH";

export interface PendingSongView {
  song: Song;
  warnings: PendingWarning[];
}

/** POST .../recommendations のレスポンス本体 */
export interface RecommendationResult {
  requestId: number | null;
  seed: number;
  isSparse: boolean;
  poolSize: number;
  candidates: RecommendationCandidateView[];
  conditionalCandidates: ConditionalCandidateView[];
  pendingSongs: PendingSongView[];
}

/** POST .../recommendations のリクエストボディ */
export interface RecommendationRequestPayload {
  conditions: { horns: HornsCondition; beginner: BeginnerCondition };
  constraints: { kurobon1Only: boolean; genreOverride?: Genre[] };
  intent: RecommendationIntent;
}

/** GET/POST /api/pending-songs の 1 行（曲情報込み・追加順） */
export interface PendingSongEntry {
  song: Song;
  createdAt: string;
}

// --- 曲マスター編集（unit-07） ----------------------------------------------

/** 曲の編集可能属性（POST/PATCH で送る形。server songFields と一致） */
export interface SongAttributes {
  title: string;
  songKey: string | null;
  form: SongForm;
  composer: string | null;
  hasPlayed: boolean;
  noChartOk: boolean;
  isStandard: boolean;
  /** @deprecated difficulty へ移行中。読み取り契約としては当面残置 */
  simpleForm: boolean;
  inKurobon1: boolean;
  season: Season;
  listenerLevel: number;
  energyLevel: number;
  /** 難易度 1–5（simple_form の後継）。未設定は null */
  difficulty: number | null;
  needsReview: boolean;
  note: string | null;
  genreTags: string[];
}

/**
 * POST /api/songs・PATCH /api/songs/:id のボディ（部分更新）。
 * POST は title 必須（server 側 zod で担保）・PATCH は任意の部分集合。
 */
export type SongUpsertPayload = Partial<SongAttributes>;

/** GET /api/songs のクエリ（サーバ側パラメータ。inKurobon1 はクライアント側フィルタ） */
export interface SongListQuery {
  q?: string;
  needsReview?: boolean;
  genre?: Genre;
  season?: Season;
  hasPlayed?: boolean;
  sort?: "title" | "updated";
}

// --- 設定・楽器・店舗（unit-07） --------------------------------------------

/** GET/PUT /api/settings の本体（key→値。値はシード型 number/boolean/object） */
export type SettingsMap = Record<string, unknown>;

/** POST /api/instruments のボディ */
export interface InstrumentCreatePayload {
  code: string;
  label: string;
  sortOrder?: number;
}

/** PATCH /api/venues/:id のボディ（部分更新） */
export interface VenueUpdatePayload {
  name?: string;
  isHome?: boolean;
}

/** GET /api/genre-tags の 1 行 */
export interface GenreTag {
  id: number;
  name: string;
}

// --- CSV インポート4段階（unit-08 API の UI 契約） --------------------------

export type ImportType = "songs" | "setlists";

/** バリデーションエラー行（Step2 のエラー行テーブル） */
export interface ErrorRow {
  line: number;
  reason: string;
  raw: Record<string, string>;
}

/** マスター未一致 title の近似候補 */
export interface TitleCandidate {
  songId: number;
  title: string;
  matchType: "exact" | "normalized" | "partial";
}

/** setlists のプレビューで人間の解決が必要な未知要素 */
export interface SetlistUnknowns {
  venues: string[];
  titles: Array<{ csvTitle: string; candidates: TitleCandidate[] }>;
}

/** unknowns: songs は空オブジェクト・setlists は SetlistUnknowns */
export type ImportUnknowns = Record<string, never> | SetlistUnknowns;

/** ImportJob の識別情報（プレビュー応答・resolutions 応答が返す） */
export interface ImportJobRef {
  id: number;
  type: ImportType;
  status: string;
}

/** POST /api/import/:type（201）の本体 */
export interface PreviewResult {
  job: ImportJobRef;
  totalRows: number;
  validRows: number;
  errors: ErrorRow[];
  unknowns: ImportUnknowns;
}

/** 曲名解決の 1 件 */
export interface TitleResolution {
  action: "match" | "create_stub" | "skip";
  songId?: number;
}

/** POST /api/import/jobs/:jobId/resolutions のボディ */
export interface ResolutionsPayload {
  /** { venue_name: isHome } */
  venues: Record<string, boolean>;
  /** { csvTitle: { action, songId? } } */
  titles: Record<string, TitleResolution>;
}

/** GET /api/import/jobs/:jobId/dry-run の summary */
export interface DryRunSummary {
  type: ImportType;
  songsToCreate: number;
  songsToUpdate: number;
  venuesToCreate: number;
  unresolvedVenues: number;
  sessionsToCreate: number;
  duplicateSessions: number;
  performancesToCreate: number;
  skippedRows: number;
  stubsToCreate: number;
}

/** POST /api/import/jobs/:jobId/commit の summary */
export interface CommitSummary {
  type: ImportType;
  songsCreated: number;
  songsUpdated: number;
  venuesCreated: number;
  sessionsCreated: number;
  performancesCreated: number;
  stubsCreated: number;
  skippedRows: number;
  hasPlayedRecalculated: number;
}

/** POST /api/import/jobs/:jobId/commit のボディ（任意） */
export interface CommitPayload {
  recalcHasPlayed?: boolean;
}

// --- メモ一括移行（unit-02 API・要件7） -------------------------------------
// 型は src/server/import/memo-preview.ts / src/server/validation/import-memo.ts と一致。

/** プレビュー: 参加者 1 行（known=false は要確認 / クイック追加候補） */
export interface MemoPreviewInstrument {
  code: string;
  count: number;
  known: boolean;
}

/** プレビュー: フロント編成 1 コード */
export interface MemoPreviewFront {
  code: string;
  known: boolean;
}

/** プレビュー: 曲名突合結果（existing=マスタ一致 / new=未一致） */
export type MemoSongMatch =
  | {
      kind: "existing";
      id: number;
      title: string;
      matchType: TitleCandidate["matchType"];
    }
  | { kind: "new" };

/** プレビュー: 店舗突合結果 */
export type MemoVenueMatch =
  | { kind: "existing"; id: number }
  | { kind: "new" };

/** プレビュー: 1 曲 */
export interface MemoPreviewSong {
  order: number;
  title: string;
  front: MemoPreviewFront[];
  played: boolean;
  instrument: ParticipationInstrument;
  calledByMe: boolean;
  beginnerFirst: boolean;
  note: string | null;
  songMatch: MemoSongMatch;
  candidates: TitleCandidate[];
}

/** プレビュー: 1 セッション */
export interface MemoPreviewSession {
  date: string | null;
  venueName: string | null;
  venueMatch: MemoVenueMatch;
  participants: MemoPreviewInstrument[];
  host: { code: string; known: boolean } | null;
  songs: MemoPreviewSong[];
  overallNote: string | null;
  /** 人間の確定が必要な事項（要確認） */
  needsReview: string[];
  /** 情報提示（母店フラグ要確認・日付欠落 等） */
  warnings: string[];
}

/** POST /api/sessions/import-memo/preview のレスポンス（**エンベロープ無し**） */
export interface MemoPreviewResult {
  sessions: MemoPreviewSession[];
  /** 全セッションで未知だった楽器コード（クイック登録候補） */
  unknownInstrumentCodes: string[];
  /** パーサ由来の警告 */
  warnings: string[];
}

/** commit: 店舗参照（既存 id / 新規 name+isHome） */
export type MemoCommitVenueRef =
  | { kind: "existing"; id: number }
  | { kind: "new"; name: string; isHome: boolean };

/** commit: 曲参照（既存 id / 新規 title+needsReview） */
export type MemoCommitSongRef =
  | { kind: "existing"; id: number }
  | { kind: "new"; title: string; needsReview: boolean };

/** commit: 1 演奏（order 昇順で 1..N 採番される） */
export interface MemoCommitPerformance {
  order: number;
  songRef: MemoCommitSongRef;
  frontInstruments: string[];
  participated: boolean;
  instrument: ParticipationInstrument;
  calledByMe: boolean;
  noChart: boolean;
  note?: string | null;
}

/** commit: 1 セッション（status=ENDED で作成される） */
export interface MemoCommitSession {
  sessionDate: string;
  venue: MemoCommitVenueRef;
  listenerCount?: number | null;
  hostInstrumentCode?: string | null;
  participants: SessionParticipant[];
  performances: MemoCommitPerformance[];
}

/** POST /api/sessions/import-memo/commit のボディ（補正済み確定ペイロード・テキストは送らない） */
export interface MemoCommitPayload {
  sessions: MemoCommitSession[];
}

/** POST /api/sessions/import-memo/commit の summary */
export interface MemoCommitSummary {
  sessionsCreated: number;
  performancesCreated: number;
  frontInstrumentsCreated: number;
  participantsCreated: number;
  venuesCreated: number;
  stubsCreated: number;
  sessionIds: number[];
}
