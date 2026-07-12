/**
 * 設定画面（engine.*）の編集メタ情報。
 *
 * 表示名・説明・グループ・既定値の UI 側の唯一の情報源。値は src/db/seed.ts の
 * SETTING_SEEDS（discovery.md「Provisional Values」）から転記する（seed.ts は
 * server-only 依存を含むためクライアントに import できない → ここへ手動転記）。
 * seed を変更したらここも追従させること。
 */
import type { SettingsMap } from "@/lib/api/types";

export type SettingType = "number" | "boolean";

export interface SettingMeta {
  /** 一意 id（key + path 連結） */
  id: string;
  /** 親設定キー（PUT はこのキー単位で送る） */
  key: string;
  /** ネストオブジェクトの葉パス（無ければトップレベル値） */
  path?: string[];
  label: string;
  desc: string;
  type: SettingType;
  min?: number;
  max?: number;
  step?: number;
  /** seed 由来の既定値 */
  default: number | boolean;
}

export interface SettingGroup {
  id: string;
  label: string;
  /** 初期折りたたみ（項目過多対策） */
  collapsed?: boolean;
  items: SettingMeta[];
}

const n = (
  partial: Omit<SettingMeta, "type" | "id"> & { id?: string },
): SettingMeta => ({
  id: partial.id ?? partial.key + (partial.path ? "." + partial.path.join(".") : ""),
  type: "number",
  ...partial,
});

const b = (
  partial: Omit<SettingMeta, "type" | "id"> & { id?: string },
): SettingMeta => ({
  id: partial.id ?? partial.key + (partial.path ? "." + partial.path.join(".") : ""),
  type: "boolean",
  ...partial,
});

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "exclude",
    label: "除外・減点",
    items: [
      n({
        key: "engine.appearance_window_days",
        label: "集計期間（日）",
        desc: "演奏頻度の集計に使う期間。既定: 730",
        min: 1,
        step: 1,
        default: 730,
      }),
      n({
        key: "engine.same_key_penalty",
        label: "同一キー減点",
        desc: "直前の曲と同じ黒本キーの場合の減点。既定: 15",
        min: 0,
        step: 1,
        default: 15,
      }),
      n({
        key: "engine.same_key_penalty_overrides",
        path: ["F"],
        label: "同一キー減点の緩和（F）",
        desc: "F キーはこの値まで減点を緩和。既定: 8",
        min: 0,
        step: 1,
        default: 8,
      }),
      n({
        key: "engine.same_key_penalty_overrides",
        path: ["Bb"],
        label: "同一キー減点の緩和（Bb）",
        desc: "Bb キーはこの値まで減点を緩和。既定: 8",
        min: 0,
        step: 1,
        default: 8,
      }),
      n({
        key: "engine.multi_horn_vocal_penalty",
        label: "管楽器複数時の歌もの減点",
        desc: "管楽器が複数のとき歌ものを減点。既定: 15",
        min: 0,
        step: 1,
        default: 15,
      }),
      n({
        key: "engine.after_vocal_vocal_penalty",
        label: "直前ヴォーカル後の歌もの減点",
        desc: "直前曲がヴォーカル入りのとき歌ものを減点。既定: 15",
        min: 0,
        step: 1,
        default: 15,
      }),
      n({
        key: "engine.blues_penalty",
        label: "ブルース連続の減点",
        desc: "ブルースが続く場合の減点。既定: 10",
        min: 0,
        step: 1,
        default: 10,
      }),
      n({
        key: "engine.same_composer_penalty",
        label: "同一作曲者の減点",
        desc: "直前と同じ作曲者の場合の減点。既定: 5",
        min: 0,
        step: 1,
        default: 5,
      }),
    ],
  },
  {
    id: "intent",
    label: "意図の重み",
    items: [
      n({
        key: "engine.base_score",
        label: "基準スコア",
        desc: "全候補の起点となるスコア。既定: 50",
        min: 0,
        step: 1,
        default: 50,
      }),
      n({
        key: "engine.slider_weights",
        path: ["rare"],
        label: "珍しい曲の重み",
        desc: "スライダー1段階あたりの加減点。既定: 6",
        min: 0,
        step: 1,
        default: 6,
      }),
      n({
        key: "engine.slider_weights",
        path: ["long_unplayed"],
        label: "長期未演奏の重み",
        desc: "スライダー1段階あたりの加減点。既定: 6",
        min: 0,
        step: 1,
        default: 6,
      }),
      n({
        key: "engine.slider_weights",
        path: ["mood"],
        label: "ムードの重み",
        desc: "スライダー1段階あたりの加減点。既定: 6",
        min: 0,
        step: 1,
        default: 6,
      }),
      n({
        key: "engine.slider_weights",
        path: ["ballad"],
        label: "バラードの重み",
        desc: "スライダー1段階あたりの加減点。既定: 8",
        min: 0,
        step: 1,
        default: 8,
      }),
      n({
        key: "engine.slider_weights",
        path: ["safety"],
        label: "安全性の重み",
        desc: "スライダー1段階あたりの加減点係数。既定: 1.2",
        min: 0,
        step: 0.1,
        default: 1.2,
      }),
      n({
        key: "engine.genre_override_bonus",
        label: "ジャンル指定の加点",
        desc: "ジャンル上書き時の加点（フィルタでなく強い加点）。既定: 15",
        min: 0,
        step: 1,
        default: 15,
      }),
      n({
        key: "engine.seasonal_bonus",
        label: "季節感の加点",
        desc: "季節に合う曲への加点。既定: 10",
        min: 0,
        step: 1,
        default: 10,
      }),
      n({
        key: "engine.listener_weight",
        label: "リスナー受け度の重み",
        desc: "リスナー向け度の寄与。既定: 4",
        min: 0,
        step: 1,
        default: 4,
      }),
    ],
  },
  {
    id: "repeat",
    label: "繰り返し減点",
    collapsed: true,
    items: [
      n({
        key: "engine.repeat_penalties",
        path: ["last_request"],
        label: "直前リクエストと同じ曲の減点",
        desc: "直前に提案した曲の減点。既定: 12",
        min: 0,
        step: 1,
        default: 12,
      }),
      n({
        key: "engine.repeat_penalties",
        path: ["recent", "penalty"],
        label: "直近提案済みの減点",
        desc: "直近の推薦に含まれた曲の減点。既定: 6",
        min: 0,
        step: 1,
        default: 6,
      }),
      n({
        key: "engine.repeat_penalties",
        path: ["same_condition", "penalty"],
        label: "同条件繰り返しの減点",
        desc: "同じ条件で繰り返し出た曲の減点。既定: 6",
        min: 0,
        step: 1,
        default: 6,
      }),
      n({
        key: "engine.repeat_window_days",
        label: "繰り返し集計期間（日）",
        desc: "繰り返し判定に使う期間。既定: 30",
        min: 1,
        step: 1,
        default: 30,
      }),
    ],
  },
  {
    id: "lottery",
    label: "抽選",
    collapsed: true,
    items: [
      n({
        key: "engine.random_temperature",
        label: "乱数温度（tau）",
        desc: "重み付きランダム抽出の温度。大きいほどランダム性が増す。既定: 5",
        min: 0,
        step: 0.1,
        default: 5,
      }),
      n({
        key: "engine.score_floor",
        label: "最低スコア床",
        desc: "候補プールに入る最低スコア。既定: 30",
        min: 0,
        step: 1,
        default: 30,
      }),
      n({
        key: "engine.pool_band",
        label: "点差バンド",
        desc: "首位からの許容点差。既定: 10",
        min: 0,
        step: 1,
        default: 10,
      }),
      n({
        key: "engine.pool_band_relaxed",
        label: "点差バンド（緩和時）",
        desc: "候補が少ない時に緩和する点差。既定: 15",
        min: 0,
        step: 1,
        default: 15,
      }),
      n({
        key: "engine.relax_pool_threshold",
        label: "プール緩和の閾値",
        desc: "候補数がこの値を下回ると緩和する。既定: 8",
        min: 0,
        step: 1,
        default: 8,
      }),
    ],
  },
  {
    id: "candidates",
    label: "候補数",
    collapsed: true,
    items: [
      n({
        key: "engine.candidate_count",
        label: "通常候補の表示数",
        desc: "画面に出す通常候補の数。既定: 3",
        min: 1,
        max: 10,
        step: 1,
        default: 3,
      }),
      b({
        key: "pending.auto_release_on_call",
        label: "保留曲コール時の自動解除",
        desc: "保留曲をコールしたら自動で保留を解除する。既定: 有効",
        default: true,
      }),
    ],
  },
];

// --- 値の取得・更新ヘルパ（ネスト葉は親オブジェクトへマージ） ---------------

/** meta が指す現在値を返す（未設定は default にフォールバック） */
export function getSettingValue(
  settings: SettingsMap,
  meta: SettingMeta,
): number | boolean {
  const raw = settings[meta.key];
  if (!meta.path) {
    return raw === undefined || raw === null
      ? meta.default
      : (raw as number | boolean);
  }
  let cur: unknown = raw;
  for (const p of meta.path) {
    if (cur == null || typeof cur !== "object") return meta.default;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur === undefined || cur === null
    ? meta.default
    : (cur as number | boolean);
}

/** base オブジェクトに path で葉値を設定する（in place） */
function setLeafInPlace(
  base: Record<string, unknown>,
  path: string[],
  value: number | boolean,
): void {
  let cur = base;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * 単一項目を更新した PUT ペイロード（{ key: value } または { key: 親オブジェクト }）。
 * ネスト葉は現在の親オブジェクトを複製し、他の葉を保持したまま該当葉のみ差し替える。
 */
export function buildUpdatePayload(
  settings: SettingsMap,
  meta: SettingMeta,
  value: number | boolean,
): SettingsMap {
  if (!meta.path) return { [meta.key]: value };
  const base = structuredClone(
    (settings[meta.key] as Record<string, unknown>) ?? {},
  );
  setLeafInPlace(base, meta.path, value);
  return { [meta.key]: base };
}

/**
 * グループ内の全項目を既定値へ戻す PUT ペイロード。
 * 同一親キーの葉はまとめて 1 オブジェクトへマージする（他の葉は現状維持）。
 */
export function buildResetPayload(
  settings: SettingsMap,
  group: SettingGroup,
): SettingsMap {
  const working: SettingsMap = {};
  for (const item of group.items) {
    if (!item.path) {
      working[item.key] = item.default;
    } else {
      const base =
        (working[item.key] as Record<string, unknown> | undefined) ??
        structuredClone(
          (settings[item.key] as Record<string, unknown>) ?? {},
        );
      setLeafInPlace(base, item.path, item.default);
      working[item.key] = base;
    }
  }
  return working;
}
