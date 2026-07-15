/**
 * CSV インポート API のバリデーション・行変換スキーマ（unit-08）
 *
 * CSV 仕様の唯一の情報源は discovery.md「Data Import Plan」。
 * csv-parse は全セルを文字列で返すため、各行スキーマは「生の文字列レコード
 * （CSV ヘッダ名 = snake_case キー）」を入力に取り、camelCase + 型変換した
 * ドメイン値へ変換する。曲名マッチの正規化は src/lib/normalize-title.ts が唯一の規則。
 */
import { z } from "zod";
import { GENRE_TAG_NAMES } from "@/db/seed";

/** 行数上限（超過は 400。5,000 行程度を想定しつつ暴発を防ぐ） */
export const MAX_ROWS = 20000;

// CSV 必須ヘッダは CLI（tsx）と共有するため純定数モジュールに集約し再エクスポートする。
export {
  SONGS_CSV_HEADERS,
  SETLISTS_CSV_HEADERS,
} from "./import-headers";

/** 生 CSV セル → trim 済み文字列（欠損セルは空文字に正規化） */
const cell = z.preprocess(
  (v) => (v == null ? "" : String(v)).trim(),
  z.string(),
);

/** "1"→true / "0"・空→false / それ以外はエラー */
function csvBoolean(label: string) {
  return cell.transform((v, ctx) => {
    if (v === "" || v === "0") return false;
    if (v === "1") return true;
    ctx.addIssue({
      code: "custom",
      message: `${label} は 1 または 0 で指定してください（受領: "${v}"）`,
    });
    return z.NEVER;
  });
}

const SEASON_MAP: Record<
  string,
  "SPRING" | "SUMMER" | "AUTUMN" | "WINTER" | "ALL"
> = {
  春: "SPRING",
  夏: "SUMMER",
  秋: "AUTUMN",
  冬: "WINTER",
  通年: "ALL",
  "": "ALL",
};

const seasonCsv = cell.transform((v, ctx) => {
  const mapped = SEASON_MAP[v];
  if (mapped === undefined) {
    ctx.addIssue({
      code: "custom",
      message: `season は 春/夏/秋/冬/通年 のいずれかです（受領: "${v}"）`,
    });
    return z.NEVER;
  }
  return mapped;
});

/** listener_level / energy_level: 1–5、空は既定 3 */
function levelCsv(label: string) {
  return cell.transform((v, ctx) => {
    if (v === "") return 3;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      ctx.addIssue({
        code: "custom",
        message: `${label} は 1〜5 で指定してください（受領: "${v}"）`,
      });
      return z.NEVER;
    }
    return n;
  });
}

/** difficulty: 1–5、空は null（未設定）。範囲外・非整数はエラー */
const difficultyCsv = cell.transform((v, ctx) => {
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    ctx.addIssue({
      code: "custom",
      message: `difficulty は 1〜5 または空で指定してください（受領: "${v}"）`,
    });
    return z.NEVER;
  }
  return n;
});

const FORM_VALUES = ["AABA", "ABAC", "BLUES12", "OTHER"] as const;

const formCsv = cell.transform((v, ctx) => {
  if (v === "") return "OTHER" as const;
  const up = v.toUpperCase();
  if ((FORM_VALUES as readonly string[]).includes(up)) {
    return up as (typeof FORM_VALUES)[number];
  }
  ctx.addIssue({
    code: "custom",
    message: `form は AABA/ABAC/BLUES12/OTHER のいずれかです（受領: "${v}"）`,
  });
  return z.NEVER;
});

const GENRE_SET = new Set<string>(GENRE_TAG_NAMES);

const genresCsv = cell.transform((v, ctx) => {
  if (v === "") return [] as string[];
  const parts = v
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  for (const p of parts) {
    if (!GENRE_SET.has(p)) {
      ctx.addIssue({
        code: "custom",
        message: `未知のジャンルです: "${p}"（許可: ${GENRE_TAG_NAMES.join("/")}）`,
      });
    }
  }
  return parts;
});

/** 空文字は null（nullable なテキスト列向け） */
const nullableCell = cell.transform((v) => (v === "" ? null : v));

/** 必須テキスト（title / venue_name）: 空は明示エラー */
function requiredCell(label: string) {
  return cell.pipe(z.string().min(1, `${label} は必須です`));
}

const dateCsv = cell.transform((v, ctx) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) {
    ctx.addIssue({
      code: "custom",
      message: `date は YYYY-MM-DD 形式で指定してください（受領: "${v}"）`,
    });
    return z.NEVER;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    ctx.addIssue({
      code: "custom",
      message: `date が実在しない日付です（受領: "${v}"）`,
    });
    return z.NEVER;
  }
  return v;
});

const orderCsv = cell.transform((v, ctx) => {
  const n = Number(v);
  if (v === "" || !Number.isInteger(n)) {
    ctx.addIssue({
      code: "custom",
      message: `order は整数で指定してください（受領: "${v}"）`,
    });
    return z.NEVER;
  }
  return n;
});

const instrumentCsv = cell.transform((v, ctx) => {
  const low = v.toLowerCase();
  if (low === "") return "NONE" as const;
  if (low === "sax") return "SAX" as const;
  if (low === "piano") return "PIANO" as const;
  ctx.addIssue({
    code: "custom",
    message: `instrument は sax/piano/空 のいずれかです（受領: "${v}"）`,
  });
  return z.NEVER;
});

/** `|` 区切り楽器コード列（順序保持・重複可・空可。コード実在検証は commit 時） */
const frontInstrumentsCsv = cell.transform((v) =>
  v === ""
    ? []
    : v
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
);

// --- songs.csv 行スキーマ ----------------------------------------------------

export const songsCsvRowSchema = z
  .object({
    title: requiredCell("title"),
    key: nullableCell,
    form: formCsv,
    composer: nullableCell,
    has_played: csvBoolean("has_played"),
    no_chart_ok: csvBoolean("no_chart_ok"),
    is_standard: csvBoolean("is_standard"),
    difficulty: difficultyCsv,
    in_kurobon1: csvBoolean("in_kurobon1"),
    season: seasonCsv,
    listener_level: levelCsv("listener_level"),
    energy_level: levelCsv("energy_level"),
    genres: genresCsv,
    note: nullableCell,
  })
  .transform((r) => ({
    title: r.title,
    songKey: r.key,
    form: r.form,
    composer: r.composer,
    hasPlayed: r.has_played,
    noChartOk: r.no_chart_ok,
    isStandard: r.is_standard,
    difficulty: r.difficulty,
    inKurobon1: r.in_kurobon1,
    season: r.season,
    listenerLevel: r.listener_level,
    energyLevel: r.energy_level,
    genres: r.genres,
    note: r.note,
  }));

export type SongsCsvRow = z.infer<typeof songsCsvRowSchema>;

// --- setlists.csv 行スキーマ --------------------------------------------------

export const setlistsCsvRowSchema = z
  .object({
    date: dateCsv,
    venue_name: requiredCell("venue_name"),
    order: orderCsv,
    title: requiredCell("title"),
    participated: csvBoolean("participated"),
    instrument: instrumentCsv,
    called_by_me: csvBoolean("called_by_me"),
    no_chart: csvBoolean("no_chart"),
    memo: nullableCell,
    front_instruments: frontInstrumentsCsv,
  })
  .transform((r) => ({
    date: r.date,
    venueName: r.venue_name,
    order: r.order,
    title: r.title,
    participated: r.participated,
    // participated=0 の行は自分の担当楽器を強制 NONE（discovery.md）
    instrument: r.participated ? r.instrument : ("NONE" as const),
    calledByMe: r.called_by_me,
    noChart: r.no_chart,
    note: r.memo,
    frontInstruments: r.front_instruments,
  }));

export type SetlistsCsvRow = z.infer<typeof setlistsCsvRowSchema>;

// --- resolutions / commit -----------------------------------------------------

export const titleResolutionSchema = z
  .object({
    action: z.enum(["match", "create_stub", "skip"]),
    songId: z.number().int().positive().optional(),
  })
  .refine((t) => t.action !== "match" || t.songId !== undefined, {
    message: "action=match には songId が必要です",
  });

export const resolutionsSchema = z.object({
  /** { venue_name: isHome } */
  venues: z.record(z.string(), z.boolean()).default({}),
  /** { csvTitle: { action, songId? } } */
  titles: z.record(z.string(), titleResolutionSchema).default({}),
});

export type ResolutionsInput = z.infer<typeof resolutionsSchema>;

export const commitSchema = z.object({
  recalcHasPlayed: z.boolean().default(false),
});

export type CommitInput = z.infer<typeof commitSchema>;

// --- ImportJob 内 JSON 構造の型（parsedRows / errors / unknowns） ------------

/** 有効行（行番号 + 変換済みデータ） */
export interface ParsedRow<T> {
  line: number;
  data: T;
}

/** バリデーションエラー行 */
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
  /** venues.name に存在しない venue_name（is_home の確定が必要） */
  venues: string[];
  /** マスター未一致の title（近似候補付き。match/create_stub/skip の確定が必要） */
  titles: Array<{ csvTitle: string; candidates: TitleCandidate[] }>;
}
