/**
 * 冪等シード（ジャンルタグ9種・楽器12種・engine.* 設定初期値）
 *
 * 初期値の唯一の情報源: .ai-dlc/next-call-mvp/discovery.md「Provisional Values」
 * 冪等性: INSERT ... ON CONFLICT DO NOTHING。
 * 特に settings は既存値を上書きしない（設定画面でのユーザー調整値を保護する）。
 */
import { genreTags, instruments, settings } from "./schema";
import { getDb, type Db } from "./client";

/** ジャンル・特徴タグ 固定9種（仕様§7.2） */
export const GENRE_TAG_NAMES = [
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

/** フロント楽器 初期12種（Domain Model Review Decision 1） */
export const INSTRUMENT_SEEDS: ReadonlyArray<{
  code: string;
  label: string;
  sortOrder: number;
}> = [
  { code: "vo", label: "ヴォーカル", sortOrder: 1 },
  { code: "ss", label: "ソプラノサックス", sortOrder: 2 },
  { code: "as", label: "アルトサックス", sortOrder: 3 },
  { code: "ts", label: "テナーサックス", sortOrder: 4 },
  { code: "bs", label: "バリトンサックス", sortOrder: 5 },
  { code: "tp", label: "トランペット", sortOrder: 6 },
  { code: "fl", label: "フルート", sortOrder: 7 },
  { code: "fh", label: "フリューゲルホルン", sortOrder: 8 },
  { code: "harm", label: "ハーモニカ", sortOrder: 9 },
  { code: "tb", label: "トロンボーン", sortOrder: 10 },
  { code: "cl", label: "クラリネット", sortOrder: 11 },
  { code: "g", label: "ギター", sortOrder: 12 },
];

/**
 * 設定初期値（discovery.md「Provisional Values」の表を転記。値は JSON シリアライズして保存）
 */
export const SETTING_SEEDS: Readonly<Record<string, unknown>> = {
  // #1 セットリスト登場回数の集計期間（直近2年）
  "engine.appearance_window_days": 730,
  // #2 直前曲と同じ黒本キーの減点（F/Bb は緩和）
  "engine.same_key_penalty": 15,
  "engine.same_key_penalty_overrides": { F: 8, Bb: 8 },
  // #3 特殊ジャンル連続時の扱い（全8種とも強い減点。ジャンル別に penalty/exclude 切替可）
  "engine.consecutive_genre": { default: { mode: "penalty", value: 15 } },
  // #4 管楽器複数時の歌もの減点
  "engine.multi_horn_vocal_penalty": 15,
  // #5 安全性スコアの計算式
  //   safety_score(0-10) = 2*超定番 + 3*譜面なし対応可 + 2*構成単純
  //     + min(演奏回数,5)*0.4 + min(コール回数,3)*(1/3)
  //   寄与 = (-s) * 1.2 * (safety_score - 5)
  "engine.safety_weights": {
    is_standard: 2,
    no_chart_ok: 3,
    simple_form: 2,
    play_count_coef: 0.4,
    play_count_cap: 5,
    call_count_coef: 0.3333,
    call_count_cap: 3,
    slider_coef: 1.2,
    midpoint: 5,
  },
  // #6 リスナー向け度・盛り上がり度の既定値
  "master.default_level": 3,
  // #8 候補集団の作り方（点差バンド + 最低スコア床）
  "engine.pool_band": 10,
  "engine.pool_band_relaxed": 15,
  "engine.score_floor": 30,
  // #9 重み付きランダム抽出の温度（softmax tau）
  "engine.random_temperature": 5,
  // #10 推薦履歴による繰り返し減点
  "engine.repeat_penalties": {
    last_request: 12,
    recent: { count: 5, penalty: 6 },
    same_condition: { min_times: 3, penalty: 6 },
  },
  "engine.repeat_window_days": 30,
  "engine.relax_pool_threshold": 8,
  // #11 通常候補の表示数
  "engine.candidate_count": 3,
  // #12 保留曲コール時の自動解除
  "pending.auto_release_on_call": true,
  // #15 ジャンル上書きの加点値（フィルタでなく強い加点）
  "engine.genre_override_bonus": 15,
  // #16 直前曲ヴォーカル（フロント編成に vo）後の歌もの減点
  "engine.after_vocal_vocal_penalty": 15,
  // #14 低頻度ジャンルの扱い
  "engine.low_freq_threshold": 0.05,
  "engine.low_freq_penalty": 8,
  "engine.low_freq_waiver_bonus": 10,
  // --- 追加の暫定値（§21外だが実装に必要） ---
  "engine.base_score": 50,
  "engine.slider_weights": {
    rare: 6,
    long_unplayed: 6,
    mood: 6,
    ballad: 8,
    safety: 1.2,
  },
  "engine.seasonal_bonus": 10,
  "engine.listener_weight": 4,
  "engine.season_months": {
    SPRING: [3, 4, 5],
    SUMMER: [6, 7, 8],
    AUTUMN: [9, 10, 11],
    WINTER: [12, 1, 2],
  },
  "engine.long_unplayed_days": 365,
  "engine.blues_penalty": 10,
  "engine.same_composer_penalty": 5,
  "engine.top_called_n": 10,
  "engine.top_called_penalty": 12,
  "engine.first_song_seasonal_default": true,
};

/** シードを投入する（何度実行しても件数・既存値は変わらない） */
export function seedDatabase(db: Db = getDb()): void {
  db.insert(genreTags)
    .values(GENRE_TAG_NAMES.map((name) => ({ name })))
    .onConflictDoNothing()
    .run();

  db.insert(instruments)
    .values(INSTRUMENT_SEEDS.map((s) => ({ ...s })))
    .onConflictDoNothing()
    .run();

  db.insert(settings)
    .values(
      Object.entries(SETTING_SEEDS).map(([key, value]) => ({
        key,
        value: JSON.stringify(value),
      })),
    )
    .onConflictDoNothing()
    .run();
}
