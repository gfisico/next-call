/**
 * next-call 全スキーマ定義（Drizzle ORM / SQLite）
 *
 * 本ファイルは後続全ユニットが参照する契約。
 * マイグレーションは追加的（additive）に保つこと: 列の削除・改名は禁止。
 * 仕様用語との対応は各列コメントを参照（一次仕様書: docs/jazz_session_song_recommendation_spec_v2.md）。
 *
 * 日時の扱い: created_at 等のタイムスタンプは UTC ISO 8601 文字列で保存。
 * session_date 等「日付」の解釈は JST (Asia/Tokyo) を正とする（TZ=Asia/Tokyo 前提）。
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** UTC ISO 8601 タイムスタンプの既定値 */
const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/**
 * songs — 曲マスター（仕様§7）
 */
export const songs = sqliteTable(
  "songs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 曲名（仕様§7.1 曲名） */
    title: text("title").notNull().unique(),
    /** 照合用正規化曲名（CSVインポート時の曲名マッチ用。全半角・大小・前後空白を正規化） */
    titleNormalized: text("title_normalized").notNull(),
    /** 黒本キー（仕様§7.1 黒本キー）例: C, F, Bb, Eb, G, Fm */
    songKey: text("song_key"),
    /** 構成（仕様§7.1 構成）「直前と同構成は完全除外」に使用 */
    form: text("form", { enum: ["AABA", "ABAC", "BLUES12", "OTHER"] })
      .notNull()
      .default("OTHER"),
    /** 作曲者（仕様§7.1 作曲者） */
    composer: text("composer"),
    /** 演奏経験あり（仕様§7.1）= アプリ内「コール可能」判定の唯一の材料（仕様§6） */
    hasPlayed: integer("has_played", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 譜面なし対応可（仕様§6.1/§7.1）。演奏事実の no_chart（performances）とは別物 */
    noChartOk: integer("no_chart_ok", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 超定番（仕様§7.1） */
    isStandard: integer("is_standard", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 構成が単純（仕様§7.1） */
    simpleForm: integer("simple_form", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 黒本1掲載（仕様§7.1/§11。譜面共有環境の制約であり安全性ではない） */
    inKurobon1: integer("in_kurobon1", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 季節（仕様§7.1/§9.7。PiaScore季節セットリスト由来） */
    season: text("season", {
      enum: ["SPRING", "SUMMER", "AUTUMN", "WINTER", "ALL"],
    })
      .notNull()
      .default("ALL"),
    /** リスナー向け度 1–5（仕様§7.1。既定3 = master.default_level） */
    listenerLevel: integer("listener_level").notNull().default(3),
    /** 盛り上がり度 1–5（仕様§7.1。既定3） */
    energyLevel: integer("energy_level").notNull().default(3),
    /** 属性未整備フラグ（セッション中クイック登録の曲。Alignment Gate 決定事項） */
    needsReview: integer("needs_review", { mode: "boolean" })
      .notNull()
      .default(false),
    /** その他メモ（仕様§7.1） */
    note: text("note"),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [index("idx_songs_title_normalized").on(table.titleNormalized)],
);

/**
 * genre_tags — ジャンル・特徴タグ（仕様§7.2）
 * 固定9種をシードで投入（将来の追加に備えマスターテーブル化）
 */
export const genreTags = sqliteTable("genre_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

/**
 * song_genre_tags — 曲×ジャンルの中間テーブル（多対多）
 */
export const songGenreTags = sqliteTable(
  "song_genre_tags",
  {
    songId: integer("song_id")
      .notNull()
      .references(() => songs.id),
    genreTagId: integer("genre_tag_id")
      .notNull()
      .references(() => genreTags.id),
  },
  (table) => [primaryKey({ columns: [table.songId, table.genreTagId] })],
);

/**
 * instruments — フロント楽器マスター（Domain Model Review Decision 1）
 * 初期12種（vo, ss, as, ts, bs, tp, fl, fh, harm, tb, cl, g）。追加可能。
 */
export const instruments = sqliteTable("instruments", {
  /** 楽器コード（例: vo, as, ts） */
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * venues — 店舗マスター（仕様§4.2）
 */
export const venues = sqliteTable("venues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /** 某店=true（初回登録時に一度だけ判定して保存。§13 登場頻度の参照先切替にのみ使用） */
  isHome: integer("is_home", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(utcNow),
});

/**
 * sessions — セッション（仕様§4）
 */
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** セッション日（ISO date 文字列 YYYY-MM-DD。JST で解釈） */
  sessionDate: text("session_date").notNull(),
  venueId: integer("venue_id")
    .notNull()
    .references(() => venues.id),
  /** リスナー客あり（仕様§4.3。セッション中いつでも変更可） */
  hasListeners: integer("has_listeners", { mode: "boolean" })
    .notNull()
    .default(false),
  /** ACTIVE=記録中 / ENDED=終了（履歴） */
  status: text("status", { enum: ["ACTIVE", "ENDED"] })
    .notNull()
    .default("ACTIVE"),
  note: text("note"),
  createdAt: text("created_at").notNull().default(utcNow),
});

/**
 * performances — 演奏記録 / セットリスト行（仕様§5）
 * 自分が参加していない曲も含めて全曲登録する。
 */
export const performances = sqliteTable(
  "performances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    songId: integer("song_id")
      .notNull()
      .references(() => songs.id),
    /** 演奏順。「直前の曲」= ACTIVE セッション内 order_index 最大の行 */
    orderIndex: integer("order_index").notNull(),
    /** 自分の参加有無（仕様§5.1） */
    participated: integer("participated", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 自分の担当楽器（仕様§5.1。候補抽出は常にサックス前提、ピアノは履歴のみ§5.2） */
    instrument: text("instrument", { enum: ["SAX", "PIANO", "NONE"] })
      .notNull()
      .default("NONE"),
    /** 自分がコールした曲（仕様§10.4/§12.7 の集計に使用） */
    calledByMe: integer("called_by_me", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 譜面なしだったか（事実の記録。songs.no_chart_ok は能力フラグで別物） */
    noChart: integer("no_chart", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("idx_performances_session").on(table.sessionId),
    /** 曲別集計（登場回数・最終演奏日・コール回数）用（unit-04） */
    index("idx_performances_song").on(table.songId),
    /** 「直前の曲」= セッション内 order_index 最大の行の取得用（unit-04） */
    index("idx_performances_session_order").on(
      table.sessionId,
      table.orderIndex,
    ),
  ],
);

/**
 * performance_front_instruments — 演奏ごとのフロント編成
 * （Domain Model Review Decision 1。順序付き・同一楽器の重複可 → PK=(performance_id, position)）
 * §12.5「ヴォーカル参加曲の後は歌ものを避ける」は直前 Performance のフロント編成に vo が
 * 含まれるかで判定する。入力は任意（未入力なら判定スキップ）。
 */
export const performanceFrontInstruments = sqliteTable(
  "performance_front_instruments",
  {
    performanceId: integer("performance_id")
      .notNull()
      .references(() => performances.id),
    instrumentCode: text("instrument_code")
      .notNull()
      .references(() => instruments.code),
    /** 並び順（0始まり）。同一楽器の重複を許すため PK に含める */
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.performanceId, table.position] })],
);

/**
 * recommendation_requests — 推薦リクエスト履歴（仕様§14.3）
 * 繰り返し減点のため、編成条件+選曲意図（仕様§9 SelectionIntent）のスナップショットを保存する。
 */
export const recommendationRequests = sqliteTable(
  "recommendation_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    requestedAt: text("requested_at").notNull().default(utcNow),
    /** 管楽器の人数（仕様§8.1） */
    horns: text("horns", { enum: ["ONE", "MULTI", "UNKNOWN"] }).notNull(),
    /** 初心者の参加（仕様§8.2） */
    beginner: text("beginner", {
      enum: ["NONE", "PRESENT", "UNKNOWN"],
    }).notNull(),
    /** 黒本1縛り（仕様§11） */
    kurobon1Only: integer("kurobon1_only", { mode: "boolean" })
      .notNull()
      .default(false),
    /** ジャンル上書き（仕様§10。JSON配列: ジャンル名。フィルタではなく強い加点） */
    genreOverride: text("genre_override"),
    /** --- 以下 SelectionIntent スナップショット（仕様§9、-2..+2） --- */
    /** 珍しい曲（仕様§9.2） */
    rare: integer("rare").notNull().default(0),
    /** 久しぶりの曲（仕様§9.3） */
    longUnplayed: integer("long_unplayed").notNull().default(0),
    /** 安全に行く(-) / 攻める(+)（仕様§9.4） */
    safety: integer("safety").notNull().default(0),
    /** 落ち着かせる(-) / 盛り上げる(+)（仕様§9.5） */
    mood: integer("mood").notNull().default(0),
    /** バラード 避けたい(-) / やりたい(+)（仕様§9.6） */
    ballad: integer("ballad").notNull().default(0),
    /** 季節感チェック（仕様§9.7） */
    seasonal: integer("seasonal", { mode: "boolean" })
      .notNull()
      .default(false),
    /** リスナー向けチェック（仕様§9.8） */
    listenerFocus: integer("listener_focus", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 「同じような条件」判定用シグネチャ（仕様§14.3） */
    conditionSignature: text("condition_signature").notNull(),
    /** Stage1–3 通過曲数（緩和判定の記録。仕様§14.3） */
    poolSize: integer("pool_size").notNull().default(0),
    /** 乱数シード（同一 request の再現用。unit-04 で追加） */
    seed: integer("seed").notNull().default(0),
  },
  (table) => [
    index("idx_reco_requests_session").on(table.sessionId),
    index("idx_reco_requests_signature").on(table.conditionSignature),
    /** 30日 window での履歴読み取り用（unit-04） */
    index("idx_reco_requests_requested_at").on(table.requestedAt),
    /** 同一署名×期間の提示回数集計用（unit-04） */
    index("idx_reco_requests_signature_requested").on(
      table.conditionSignature,
      table.requestedAt,
    ),
  ],
);

/**
 * recommendation_candidates — 提示候補履歴（仕様§14.3/§15.2）
 */
export const recommendationCandidates = sqliteTable(
  "recommendation_candidates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => recommendationRequests.id),
    songId: integer("song_id")
      .notNull()
      .references(() => songs.id),
    /** NORMAL=通常候補 / ONE_HORN・MULTI_HORN・BEGINNER=条件別候補（仕様§8/§15.2） */
    candidateType: text("candidate_type", {
      enum: ["NORMAL", "ONE_HORN", "MULTI_HORN", "BEGINNER"],
    })
      .notNull()
      .default("NORMAL"),
    score: real("score").notNull(),
    /** 推薦理由（JSON配列。固定テンプレート文。仕様§15.1） */
    reasons: text("reasons").notNull().default("[]"),
    /** 条件付き候補か（「1管なら」等のラベル付き提示） */
    isConditional: integer("is_conditional", { mode: "boolean" })
      .notNull()
      .default(false),
    conditionLabel: text("condition_label"),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (table) => [index("idx_reco_candidates_request").on(table.requestId)],
);

/**
 * pending_songs — 保留曲（仕様§16）
 * 曲だけを保存（理由・期限・スコアは持たない）。セッションをまたいで保持。解除=行削除。
 */
export const pendingSongs = sqliteTable("pending_songs", {
  songId: integer("song_id")
    .primaryKey()
    .references(() => songs.id),
  createdAt: text("created_at").notNull().default(utcNow),
});

/**
 * settings — key-value 設定ストア
 * engine.* の暫定値（discovery.md「Provisional Values」が唯一の情報源）を保持し、
 * 設定画面（unit-07）から調整可能にする。value は JSON 文字列。
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(utcNow),
});
