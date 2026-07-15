/**
 * 曲マスタ一括編集ツールの中核マッピング（純関数・副作用なし・unit-06）
 *
 * 人の編集面（日本語ラベル + ドロップダウン + 9列✓ジャンル + 曲名保護）と、
 * システム取り込み面（songs.csv, snake_case ヘッダ）を相互変換する唯一の規則。
 *
 * 契約:
 * - CSV 列定義の単一真実源は `../src/server/validation/import-headers.ts` の
 *   `SONGS_CSV_HEADERS`（14列, difficulty 有り・simple_form 無し）を import する。
 * - 9ジャンル正式名の真実源は `../src/db/seed.ts` の `GENRE_TAG_NAMES`。
 * - 曲名照合の正規化は `../src/lib/normalize-title.ts` の `normalizeTitle` のみ。
 * - ラベル↔コードの写像は `../src/server/validation/import.ts`（zod）の受理トークンに
 *   厳密一致させる（ドリフトはテストで実 `songsCsvRowSchema` に通して検出する）。
 *
 * `@/` エイリアスは tsx では解決されないため、本モジュールは相対 import のみ。
 */
import { GENRE_TAG_NAMES } from "../src/db/seed";
import { normalizeTitle } from "../src/lib/normalize-title";
import { SONGS_CSV_HEADERS } from "../src/server/validation/import-headers";

// --- 共通中間型 --------------------------------------------------------------

/** DB の season コード（schema.songs.season の enum） */
export type SeasonCode = "SPRING" | "SUMMER" | "AUTUMN" | "WINTER" | "ALL";

/** DB の form コード（schema.songs.form の enum） */
export type FormCode = "AABA" | "ABAC" | "BLUES12" | "OTHER";

/**
 * 編集対象の1曲（[list] 経路・DB 経路の双方が生成する共通中間型）。
 * ここに載る項目のみを xlsx 左側（編集列）へ展開する（simple_form は対象外）。
 */
export interface EditableSong {
  title: string;
  key: string | null;
  form: FormCode;
  composer: string | null;
  hasPlayed: boolean;
  noChartOk: boolean;
  isStandard: boolean;
  difficulty: number | null;
  inKurobon1: boolean;
  season: SeasonCode;
  listenerLevel: number;
  energyLevel: number;
  genres: string[];
  note: string | null;
}

// --- 表示ラベル（snake_case → 日本語ヘッダ） ---------------------------------

/** スカラー編集列の snake_case キー → 日本語表示ヘッダ */
export const COLUMN_LABELS: Record<string, string> = {
  title: "曲名",
  key: "キー",
  form: "構成",
  composer: "作曲者",
  has_played: "演奏経験",
  no_chart_ok: "譜面なし可",
  is_standard: "超定番",
  difficulty: "難易度",
  in_kurobon1: "黒本1掲載",
  season: "季節",
  listener_level: "リスナー向け度",
  energy_level: "盛り上がり度",
  note: "メモ",
};

/** 参考列（インポート対象外）の表示ヘッダ */
export const REFERENCE_HEADERS = {
  difficulty: "演奏難易度(叩き台)",
  comment: "難易度コメント",
  level: "攻め方の目安",
} as const;

/** 曲名照合キーを保持する隠し列のヘッダ */
export const TITLE_KEY_HEADER = "__title_key";

// --- ドロップダウン選択肢 -----------------------------------------------------

/** form ドロップダウン（表示ラベル） */
export const FORM_OPTIONS = ["AABA", "ABAC", "ブルース(12小節)", "その他"] as const;
/** season ドロップダウン（表示ラベル） */
export const SEASON_OPTIONS = ["春", "夏", "秋", "冬", "通年"] as const;
/** 難易度ドロップダウン（未設定を含む） */
export const DIFFICULTY_OPTIONS = ["1", "2", "3", "4", "5", "未設定"] as const;
/** listener_level / energy_level ドロップダウン */
export const LEVEL_OPTIONS = ["1", "2", "3", "4", "5"] as const;
/** 真偽・ジャンル列のチェックマーク（空欄=false） */
export const CHECK_MARK = "✓";

// --- 列レイアウト定義 --------------------------------------------------------

/** xlsx の1列の定義 */
export interface ColumnDef {
  /** 内部キー（scalar は snake_case、genre は正式名、reference/hidden は固定キー） */
  key: string;
  /** 行1に書く表示ヘッダ */
  header: string;
  /** 列種別 */
  kind: "title" | "scalar" | "genre" | "reference" | "hidden";
  /** インライン list データ検証の選択肢（あれば） */
  listValidation?: readonly string[];
}

const BOOL_KEYS = ["has_played", "no_chart_ok", "is_standard", "in_kurobon1"];

function scalarColumn(key: string): ColumnDef {
  const header = COLUMN_LABELS[key];
  const base: ColumnDef = {
    key,
    header,
    kind: key === "title" ? "title" : "scalar",
  };
  if (key === "form") return { ...base, listValidation: FORM_OPTIONS };
  if (key === "season") return { ...base, listValidation: SEASON_OPTIONS };
  if (key === "difficulty") return { ...base, listValidation: DIFFICULTY_OPTIONS };
  if (key === "listener_level" || key === "energy_level") {
    return { ...base, listValidation: LEVEL_OPTIONS };
  }
  if (BOOL_KEYS.includes(key)) return { ...base, listValidation: [CHECK_MARK] };
  return base;
}

/**
 * xlsx `master` シートの全列レイアウト（左→右）。
 * スカラー13列 → 9ジャンル列 → 参考3列 → 隠し `__title_key`。
 */
export const COLUMNS: ColumnDef[] = [
  ...Object.keys(COLUMN_LABELS).map(scalarColumn),
  ...GENRE_TAG_NAMES.map(
    (name): ColumnDef => ({
      key: name,
      header: name,
      kind: "genre",
      listValidation: [CHECK_MARK],
    }),
  ),
  {
    key: "ref_difficulty",
    header: REFERENCE_HEADERS.difficulty,
    kind: "reference",
  },
  { key: "ref_comment", header: REFERENCE_HEADERS.comment, kind: "reference" },
  { key: "ref_level", header: REFERENCE_HEADERS.level, kind: "reference" },
  { key: TITLE_KEY_HEADER, header: TITLE_KEY_HEADER, kind: "hidden" },
];

/** 編集列（スカラー + 9ジャンル + 隠し __title_key）のヘッダ列（decode/テスト用） */
export const EDITABLE_HEADERS: string[] = COLUMNS.filter(
  (c) => c.kind !== "reference",
).map((c) => c.header);

/** スカラー列の表示ヘッダ集合 */
const SCALAR_HEADER_SET = new Set(
  Object.values(COLUMN_LABELS),
);
/** decode 時に無視するヘッダ（参考列 + 隠し列）。参考列を誤ってジャンル扱いしない */
const IGNORED_HEADER_SET = new Set<string>([
  ...Object.values(REFERENCE_HEADERS),
  TITLE_KEY_HEADER,
]);
/** ジャンル正式名の集合 */
const GENRE_SET = new Set<string>(GENRE_TAG_NAMES);

// --- encode（コード/値 → 表示ラベル） ---------------------------------------

const FORM_CODE_TO_LABEL: Record<FormCode, string> = {
  AABA: "AABA",
  ABAC: "ABAC",
  BLUES12: "ブルース(12小節)",
  OTHER: "その他",
};

const SEASON_CODE_TO_LABEL: Record<SeasonCode, string> = {
  SPRING: "春",
  SUMMER: "夏",
  AUTUMN: "秋",
  WINTER: "冬",
  ALL: "通年",
};

export function encodeForm(code: FormCode): string {
  return FORM_CODE_TO_LABEL[code] ?? "その他";
}

export function encodeSeason(code: SeasonCode): string {
  return SEASON_CODE_TO_LABEL[code] ?? "通年";
}

export function encodeBool(value: boolean): string {
  return value ? CHECK_MARK : "";
}

export function encodeDifficulty(value: number | null): string {
  return value == null ? "未設定" : String(value);
}

export function encodeLevel(value: number): string {
  return String(value);
}

// --- decode（表示ラベル → CSV 値。行番号付きエラーを返す） -------------------

interface DecodeResult {
  /** songs.csv に書く値（成功時） */
  value?: string;
  /** 失敗理由（未設定なら成功） */
  error?: string;
}

const FORM_LABEL_TO_CODE = new Map<string, FormCode>(
  (Object.entries(FORM_CODE_TO_LABEL) as [FormCode, string][]).map(
    ([code, label]) => [label, code],
  ),
);

const SEASON_LABELS = new Set<string>(SEASON_OPTIONS);

/** form ラベル → コード。空は OTHER（import と同じ）。未知はエラー */
export function decodeForm(cell: string): DecodeResult {
  const v = cell.trim();
  if (v === "") return { value: "OTHER" };
  const code = FORM_LABEL_TO_CODE.get(v);
  if (code === undefined) {
    return {
      error: `構成（form）が不正です: "${v}"（許可: ${FORM_OPTIONS.join(" / ")}）`,
    };
  }
  return { value: code };
}

/**
 * season ラベル → CSV 値。CSV には日本語ラベルを書く（import が日本語を受理）。
 * 空は「通年」扱い。未知はエラー。
 */
export function decodeSeason(cell: string): DecodeResult {
  const v = cell.trim();
  if (v === "") return { value: "通年" };
  if (!SEASON_LABELS.has(v)) {
    return {
      error: `季節（season）が不正です: "${v}"（許可: ${SEASON_OPTIONS.join(" / ")}）`,
    };
  }
  return { value: v };
}

/** 真偽（✓ / 空）→ CSV "1" / "0"。未知値はエラー */
export function decodeBool(cell: string, label: string): DecodeResult {
  const v = cell.trim();
  if (v === "" || v === "0") return { value: "0" };
  if (v === CHECK_MARK || v === "1") return { value: "1" };
  return {
    error: `${label} は ${CHECK_MARK} または空で指定してください（受領: "${v}"）`,
  };
}

/** listener_level / energy_level（1–5）→ CSV。空は空のまま（import が既定3）。範囲外/非整数はエラー */
export function decodeLevel(cell: string, label: string): DecodeResult {
  const v = cell.trim();
  if (v === "") return { value: "" };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return { error: `${label} は 1〜5 で指定してください（受領: "${v}"）` };
  }
  return { value: String(n) };
}

/** difficulty（1–5 / 未設定 / 空）→ CSV（未設定・空は ""）。範囲外/非整数はエラー */
export function decodeDifficulty(cell: string): DecodeResult {
  const v = cell.trim();
  if (v === "" || v === "未設定") return { value: "" };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return {
      error: `難易度（difficulty）は 1〜5 または未設定で指定してください（受領: "${v}"）`,
    };
  }
  return { value: String(n) };
}

/** ジャンル列の ✓ 判定（空・"0" 以外を真とみなす） */
export function isGenreChecked(cell: string): boolean {
  const v = cell.trim();
  return v !== "" && v !== "0";
}

// --- 1曲 → 表示行 ------------------------------------------------------------

/**
 * EditableSong を xlsx の編集列（表示ヘッダ keyed）へ展開する。
 * 参考列は含まない（buildWorkbook が黒本1突合で付与する）。
 */
export function songToDisplayRow(song: EditableSong): Record<string, string> {
  const row: Record<string, string> = {
    [COLUMN_LABELS.title]: song.title,
    [COLUMN_LABELS.key]: song.key ?? "",
    [COLUMN_LABELS.form]: encodeForm(song.form),
    [COLUMN_LABELS.composer]: song.composer ?? "",
    [COLUMN_LABELS.has_played]: encodeBool(song.hasPlayed),
    [COLUMN_LABELS.no_chart_ok]: encodeBool(song.noChartOk),
    [COLUMN_LABELS.is_standard]: encodeBool(song.isStandard),
    [COLUMN_LABELS.difficulty]: encodeDifficulty(song.difficulty),
    [COLUMN_LABELS.in_kurobon1]: encodeBool(song.inKurobon1),
    [COLUMN_LABELS.season]: encodeSeason(song.season),
    [COLUMN_LABELS.listener_level]: encodeLevel(song.listenerLevel),
    [COLUMN_LABELS.energy_level]: encodeLevel(song.energyLevel),
    [COLUMN_LABELS.note]: song.note ?? "",
    [TITLE_KEY_HEADER]: song.title,
  };
  const genreSet = new Set(song.genres);
  for (const name of GENRE_TAG_NAMES) {
    row[name] = genreSet.has(name) ? CHECK_MARK : "";
  }
  return row;
}

// --- 表示行 → songs.csv 行 ---------------------------------------------------

/** 行番号付きエラー */
export interface RowError {
  line: number;
  reason: string;
}

/** decodeRow の結果（成功時 row・失敗時 errors） */
export interface DecodeRowResult {
  /** SONGS_CSV_HEADERS keyed の songs.csv 行（成功時のみ） */
  row?: Record<string, string>;
  errors: RowError[];
}

/**
 * 編集後シートの1データ行を songs.csv 行へ変換する（行番号付き検証）。
 *
 * @param headerIndex 表示ヘッダ → cells 内の列インデックス（並べ替え耐性）
 * @param cells       データ行のセル文字列配列
 * @param line        エラー表示用の行番号（1始まり・シート行番号）
 */
export function decodeRow(
  headerIndex: Record<string, number>,
  cells: string[],
  line: number,
): DecodeRowResult {
  const errors: RowError[] = [];
  const get = (header: string): string => {
    const idx = headerIndex[header];
    if (idx === undefined) return "";
    return (cells[idx] ?? "").trim();
  };
  const push = (r: DecodeResult): string => {
    if (r.error) {
      errors.push({ line, reason: r.error });
      return "";
    }
    return r.value ?? "";
  };

  const title = get(COLUMN_LABELS.title);
  const titleKey = get(TITLE_KEY_HEADER);
  if (
    titleKey !== "" &&
    normalizeTitle(title) !== normalizeTitle(titleKey)
  ) {
    errors.push({
      line,
      reason: `曲名（照合キー __title_key）が変更されています。曲名列は編集しないでください（キー: "${titleKey}" / 現在: "${title}"）`,
    });
  }

  const form = push(decodeForm(get(COLUMN_LABELS.form)));
  const hasPlayed = push(decodeBool(get(COLUMN_LABELS.has_played), "演奏経験"));
  const noChartOk = push(
    decodeBool(get(COLUMN_LABELS.no_chart_ok), "譜面なし可"),
  );
  const isStandard = push(decodeBool(get(COLUMN_LABELS.is_standard), "超定番"));
  const inKurobon1 = push(
    decodeBool(get(COLUMN_LABELS.in_kurobon1), "黒本1掲載"),
  );
  const difficulty = push(decodeDifficulty(get(COLUMN_LABELS.difficulty)));
  const season = push(decodeSeason(get(COLUMN_LABELS.season)));
  const listenerLevel = push(
    decodeLevel(get(COLUMN_LABELS.listener_level), "リスナー向け度"),
  );
  const energyLevel = push(
    decodeLevel(get(COLUMN_LABELS.energy_level), "盛り上がり度"),
  );

  // ジャンル: 正式名の列を正準順で収集
  const genreParts: string[] = [];
  for (const name of GENRE_TAG_NAMES) {
    if (headerIndex[name] !== undefined && isGenreChecked(get(name))) {
      genreParts.push(name);
    }
  }
  // 未知のジャンル列（スカラー/参考/隠し/正式ジャンル以外の残余）を検出
  for (const header of Object.keys(headerIndex)) {
    if (
      SCALAR_HEADER_SET.has(header) ||
      IGNORED_HEADER_SET.has(header) ||
      GENRE_SET.has(header)
    ) {
      continue;
    }
    errors.push({ line, reason: `未知のジャンル列です: "${header}"` });
  }

  if (errors.length > 0) return { errors };

  const row: Record<string, string> = {
    title,
    key: get(COLUMN_LABELS.key),
    form,
    composer: get(COLUMN_LABELS.composer),
    has_played: hasPlayed,
    no_chart_ok: noChartOk,
    is_standard: isStandard,
    difficulty,
    in_kurobon1: inKurobon1,
    season,
    listener_level: listenerLevel,
    energy_level: energyLevel,
    genres: genreParts.join("|"),
    note: get(COLUMN_LABELS.note),
  };
  return { row, errors: [] };
}

// --- CSV 出力（RFC4180） -----------------------------------------------------

/** RFC4180: カンマ/改行/ダブルクォートを含む値は "" で囲みエスケープする */
export function csvField(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** SONGS_CSV_HEADERS 順の行群を songs.csv 文字列へ（末尾改行付き） */
export function buildSongsCsv(rows: Record<string, string>[]): string {
  const headers: readonly string[] = SONGS_CSV_HEADERS;
  const lines = [headers.map(csvField).join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvField(r[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}
