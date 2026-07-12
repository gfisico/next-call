/**
 * 推薦エンジンの型定義（unit-02-recommendation-engine）
 *
 * エンジンは DB 非依存の純関数パイプライン:
 *   (曲+事前集計, 編成条件, 選曲意図, 設定, 乱数seed) → (通常候補+条件別候補+理由)
 *
 * DB・fetch・Date.now()・Math.random() を直接使わない。
 * 乱数は seed 注入、現在季節は引数（EngineInput.currentSeason）で受け取る。
 * 全係数は EngineConfig 経由（discovery.md「Provisional Values」が唯一の情報源）。
 */

/** 構成（仕様§7.1）。needs_review 等で未設定の場合は null */
export type Form = "AABA" | "ABAC" | "BLUES12" | "OTHER";

/** 現在の季節（セッション日付から事前判定して渡す） */
export type Season = "SPRING" | "SUMMER" | "AUTUMN" | "WINTER";

/** 曲の季節属性（仕様§7.1。ALL=通年） */
export type SongSeason = Season | "ALL";

/** 管楽器条件（仕様§8.1） */
export type HornsCondition = "ONE" | "MULTI" | "UNKNOWN";

/** 初心者条件（仕様§8.2） */
export type BeginnerCondition = "NONE" | "PRESENT" | "UNKNOWN";

/** ジャンル・特徴 全9種（仕様§7.2） */
export const ALL_GENRES = [
  "バラード",
  "ボサノバ",
  "3拍子",
  "モード",
  "ファンク",
  "ブルース",
  "歌もの",
  "循環",
  "キメが多い曲",
] as const;

/**
 * §12.3 特殊ジャンル連続回避の対象は以下の 8 種のみ。
 * 「循環」は対象外（仕様§12.3 のリストに含まれない。誤実装注意）。
 */
export const SPECIAL_CONSECUTIVE_GENRES = [
  "バラード",
  "ボサノバ",
  "モード",
  "3拍子",
  "ファンク",
  "キメが多い曲",
  "ブルース",
  "歌もの",
] as const;

/**
 * エンジン専用の曲入力型（DB 行ではない。詰め替えは unit-04）。
 * needs_review 曲では各属性が null になり得る → 安全側（評価不能な除外はしない・
 * 初心者 AND は満たさない扱い・寄与は中立 0）で処理する。
 */
export interface EngineSong {
  id: number;
  title: string;
  /** 黒本キー（例: C, F, Bb）。未設定 null */
  songKey: string | null;
  form: Form | null;
  composer: string | null;
  /** コール可能判定の唯一の材料（仕様§6） */
  hasPlayed: boolean;
  noChartOk: boolean | null;
  isStandard: boolean | null;
  simpleForm: boolean | null;
  inKurobon1: boolean | null;
  season: SongSeason | null;
  /** リスナー向け度 1–5。未設定 null は中立（3 相当）扱い */
  listenerLevel: number | null;
  /** 盛り上がり度 1–5。未設定 null は中立（3 相当）扱い */
  energyLevel: number | null;
  needsReview: boolean;
  /** ジャンル名集合（ALL_GENRES のサブセット） */
  genres: string[];
}

/** 曲ごとの事前集計（unit-04 が SQL で組み立てる） */
export interface SongStats {
  /** 店舗区分別登場回数（engine.appearance_window_days 内）→ m_rare */
  appearanceCount: number;
  /** 自分の最終演奏からの日数。null = 演奏履歴なし（m_old = 1.0 扱い） */
  daysSinceLastPlayed: number | null;
  /** 自分の演奏回数（safety_score 用） */
  myPlayCount: number;
  /** 自分の累計コール回数（safety_score 用） */
  myCallCount: number;
}

/**
 * 直前の演奏（当日セットリスト最後の曲）。
 * セッション 1 曲目では null → 直前曲参照ルールはすべてスキップ。
 */
export interface PreviousPerformance {
  songKey: string | null;
  form: Form | null;
  composer: string | null;
  genres: string[];
  inKurobon1: boolean | null;
  season: SongSeason | null;
  /**
   * フロント編成（楽器コードの配列。ヴォーカルは "vo"）。
   * null = 未入力 → §12.5（直前曲 vo → 歌もの減点）はスキップ。
   */
  frontInstruments: string[] | null;
}

/** 推薦履歴由来の事前集計（Stage 5 繰り返し減点の入力） */
export interface RecommendationHistoryInput {
  /** 前回リクエストで提示した曲（−12） */
  lastRequestSongIds: number[];
  /** 直近5リクエスト（30日以内、セッション横断）で提示した曲（−6） */
  recentSongIds: number[];
  /** songId → 現在の condition_signature での30日以内提示回数（3回以上で追加 −6） */
  sameSignatureCounts: Record<number, number>;
  /** 前回リクエストの候補が持っていた特殊ジャンル（該当曲 −3） */
  lastRequestGenres: string[];
}

/** 選曲意図（仕様§9）。スライダーは −2..+2 */
export interface SelectionIntent {
  /** 珍しい曲 */
  rare: number;
  /** 久しぶりの曲 */
  longUnplayed: number;
  /** 安全性（左 −2 = 安全 / 右 +2 = 攻め） */
  safety: number;
  /** 雰囲気（盛り上げる/落ち着かせる） */
  mood: number;
  /** バラード */
  ballad: number;
  /** 季節感チェック（仕様§9.7） */
  seasonal: boolean;
  /** リスナー向けチェック（仕様§9.8） */
  listener: boolean;
}

/** 次の曲の条件（仕様§8/§10/§11） */
export interface EngineConditions {
  horns: HornsCondition;
  beginner: BeginnerCondition;
  /** 黒本1掲載曲のみ（仕様§11） */
  kurobon1Only: boolean;
  /** ジャンル上書き（仕様§10）。フィルタではなく +15 加点。空 = 指定なし */
  genreOverride: string[];
}

/** エンジンへの入力一式 */
export interface EngineInput {
  songs: EngineSong[];
  /** songId → 事前集計 */
  stats: Record<number, SongStats>;
  /** 当日すでに演奏済みの songId 集合 */
  playedTodaySongIds: number[];
  previousPerformance: PreviousPerformance | null;
  history: RecommendationHistoryInput;
  /** 自分の累計コール回数 上位 N 曲（事前集計。§12.7） */
  topCalledSongIds: number[];
  /** ジャンル名 → 自分のコール比率（低頻度ジャンル判定。§10.3） */
  genreCallRatios: Record<string, number>;
  currentSeason: Season;
  conditions: EngineConditions;
  intent: SelectionIntent;
  /** 保留曲の songId（仕様§16。スコア不干渉・無条件表示） */
  pendingSongIds: number[];
}

/** §12.3 特殊ジャンル連続時の扱い（ジャンル別に penalty/exclude 切替可） */
export interface ConsecutiveGenreRule {
  mode: "penalty" | "exclude";
  value: number;
}

/**
 * エンジン設定。既定値は discovery.md「Provisional Values」参照。
 * 減点系は正値で保持し、減点として適用する。
 */
export interface EngineConfig {
  /** engine.base_score = 50 */
  baseScore: number;
  /** engine.appearance_window_days = 730 */
  appearanceWindowDays: number;
  /** スライダー重み: 珍しさ/久しぶり/雰囲気 6、バラード 8、安全性 1.2 */
  sliderWeights: {
    rare: number;
    longUnplayed: number;
    safety: number;
    mood: number;
    ballad: number;
  };
  /** engine.seasonal_bonus = 10 */
  seasonalBonus: number;
  /** engine.listener_weight = 4 */
  listenerWeight: number;
  /** engine.same_key_penalty = 15 */
  sameKeyPenalty: number;
  /** engine.same_key_penalty_overrides = {"F":8,"Bb":8} */
  sameKeyPenaltyOverrides: Record<string, number>;
  /** engine.consecutive_genre（既定: 全8種 penalty 15） */
  consecutiveGenre: {
    default: ConsecutiveGenreRule;
    overrides?: Record<string, ConsecutiveGenreRule>;
  };
  /** engine.blues_penalty = 10 */
  bluesPenalty: number;
  /** engine.same_composer_penalty = 5 */
  sameComposerPenalty: number;
  /** engine.top_called_n = 10 */
  topCalledN: number;
  /** engine.top_called_penalty = 12（初心者対応 or safety≤−1 で半減） */
  topCalledPenalty: number;
  /** engine.low_freq_threshold = 0.05 */
  lowFreqThreshold: number;
  /** engine.low_freq_penalty = 8 */
  lowFreqPenalty: number;
  /** engine.low_freq_waiver_bonus = 10（意図由来プラス寄与合計がこの値以上で免除） */
  lowFreqWaiverBonus: number;
  /** engine.multi_horn_vocal_penalty = 15 */
  multiHornVocalPenalty: number;
  /** engine.after_vocal_vocal_penalty = 15（§12.5。フロント編成未入力時スキップ） */
  afterVocalVocalPenalty: number;
  /** engine.genre_override_bonus = 15（フィルタではなく加点） */
  genreOverrideBonus: number;
  /** engine.repeat_penalties: 前回12 / 直近6 / 同署名追加6 / ジャンル3 */
  repeatPenalties: {
    lastRequest: number;
    recentRequests: number;
    sameSignature: number;
    genreRepeat: number;
  };
  /** engine.repeat_window_days = 30 */
  repeatWindowDays: number;
  /** engine.relax_pool_threshold = 8（通過曲数がこれ未満で繰り返し減点を半減） */
  relaxPoolThreshold: number;
  /** engine.pool_band = 10 */
  poolBand: number;
  /** engine.pool_band_relaxed = 15（一度だけ拡大） */
  poolBandRelaxed: number;
  /** engine.score_floor = 30 */
  scoreFloor: number;
  /** engine.random_temperature = 5（softmax τ） */
  randomTemperature: number;
  /** engine.candidate_count = 3 */
  candidateCount: number;
  /** 抽出ごとの同一特殊ジャンル残余 weight 減衰 = 0.5 */
  genreDrawDecay: number;
  /** engine.long_unplayed_days = 365（理由文の閾値） */
  longUnplayedDays: number;
}

/** 理由コード（Stage 8。発火型 + フォールバック2種） */
export type ReasonCode =
  | "LONG_UNPLAYED" // 「最終演奏から{n}年{m}ヶ月ぶり」（m_old ≥ 0.5）
  | "RARE_AT_VENUE" // 「この店（区分）では直近{期間}の登場{a}回と少なめ」（m_rare ≥ 0.8）
  | "CONTRAST_WITH_PREVIOUS" // 「直前曲とキー・構成・雰囲気が変わる」（すべて不一致）
  | "MOOD_MATCH" // 「今回の『{...}』に合う」（mood寄与 > 0）
  | "LISTENER_FRIENDLY" // 「リスナーが楽しみやすい曲」（listener ON かつ level ≥ 4）
  | "SEASON_MATCH" // 「いまの季節（{季節}）の曲」（seasonal ON かつ一致）
  | "BEGINNER_FRIENDLY" // 「超定番・譜面なし対応可・構成が単純で初心者向き」
  | "SAFETY_SAFE" // 「演奏経験・譜面なし対応ありで手堅い」（safety寄与 > 0・左）
  | "SAFETY_CHALLENGE" // 「最近やっていない攻めの一手」（safety寄与 > 0・右）
  | "BALLAD_MATCH" // 「バラードをやりたい意向に合致」（s ≥ +1 かつ該当）
  | "FALLBACK_KEY_FORM" // 「黒本キー{key}・{form}構成」（常時・事実）
  | "FALLBACK_PLAY_COUNT"; // 「この2年で{a}回演奏」（常時・事実）

export interface Reason {
  code: ReasonCode;
  text: string;
}

/** 通常候補 */
export interface Candidate {
  songId: number;
  score: number;
  /** 最低2件・最大4件 */
  reasons: Reason[];
  /** 保留曲と重複した場合 true（「保留中」バッジ。仕様§16.4） */
  isPending: boolean;
}

/** 条件別候補のブランチ（最大4本。組み合わせブランチは生成しない） */
export type ConditionalBranch =
  | "HORNS_ONE"
  | "HORNS_MULTI"
  | "BEGINNER_NONE"
  | "BEGINNER_PRESENT";

export interface ConditionalCandidate {
  songId: number;
  score: number;
  reasons: Reason[];
  branch: ConditionalBranch;
  /** 「1管なら」「複数管なら」「初心者が参加するなら」等 */
  label: string;
}

/** 保留曲の警告バッジ（仕様§16.3。完全除外に該当しても隠さない） */
export type PendingWarning =
  | "PLAYED_TODAY" // 当日演奏済み
  | "SAME_FORM" // 直前曲と同じ構成
  | "KUROBON1_MISMATCH" // 黒本1条件外
  | "FORMATION_MISMATCH"; // 今回の編成に合いにくい（複数管×歌もの等）

export interface PendingAnnotation {
  songId: number;
  warnings: PendingWarning[];
}

/** recommend() の出力 */
export interface EngineResult {
  candidates: Candidate[];
  conditionalCandidates: ConditionalCandidate[];
  pendingSongs: PendingAnnotation[];
  /** 候補が candidate_count 未満のとき true（無理に増やさない。仕様§14.5） */
  isSparse: boolean;
  /**
   * Stage 1 通過曲数（recommendation_requests.pool_size の記録用。unit-04 で additive 追加）。
   * スコアロジックには影響しない。
   */
  poolSize: number;
}

/** Stage 6–7 の入出力用 */
export interface ScoredSong {
  song: EngineSong;
  score: number;
}
