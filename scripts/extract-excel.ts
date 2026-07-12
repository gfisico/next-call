/**
 * 初回限定の Excel 抽出スクリプト（unit-08 Task 7）
 *
 *   npx tsx scripts/extract-excel.ts <xlsx-path> [--out-dir <dir>]
 *
 * 「やれる曲.xlsx」の list / logs_all シートを読み、CSV インポート API の受け口
 * （songs.csv / setlists.csv）へ変換する。マッピングは discovery.md
 * 「Excel Source Analysis」の表に厳密準拠。アプリ本体には組み込まない CLI 専用ツール
 * （exceljs は devDependency）。Excel ファイル自体はリポジトリにコミットしない。
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { INSTRUMENT_SEEDS } from "../src/db/seed";
import { normalizeTitle } from "../src/lib/normalize-title";

const KNOWN_INSTRUMENT_CODES = new Set(INSTRUMENT_SEEDS.map((s) => s.code));

/** 編成でないことを示す語（フロント記録なし） */
const NON_FORMATION_TOKENS = new Set(["trio", "all", "duo", "quartet", "quintet"]);

/** Genre（英語表記）→ 固定9語彙。曖昧値はマップに無い＝未設定 + note に原文 */
export const GENRE_MAP: Record<string, string> = {
  ballad: "バラード",
  bossa: "ボサノバ",
  "bossa nova": "ボサノバ",
  waltz: "3拍子",
  funk: "ファンク",
  blues: "ブルース",
  mode: "モード",
  "rhythm change": "循環",
};

// --- セル値の正規化 ----------------------------------------------------------

/** exceljs のセル値（string/number/Date/richText/formula）を文字列化する */
export function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value instanceof Date) return formatDate(value).date;
  if (typeof value === "object") {
    const v = value as {
      richText?: Array<{ text?: string }>;
      text?: string;
      result?: unknown;
      formula?: string;
    };
    if (Array.isArray(v.richText)) {
      return v.richText.map((r) => r.text ?? "").join("").trim();
    }
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
  }
  return "";
}

/** マーク列（Ready/Done/#1/CallingByMe/NoScore）の真偽判定 */
export function isTruthyMark(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (t === "") return false;
  return !["0", "-", "×", "✗", "false", "no", "n"].includes(t);
}

/** Excel の日付/文字列/シリアル値を YYYY-MM-DD へ（JST 相当。UTC 成分で組み立て） */
export function formatDate(value: ExcelJS.CellValue): {
  date: string;
  warning?: string;
} {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return { date: `${y}-${m}-${d}` };
  }
  if (typeof value === "number") {
    // Excel シリアル（1900 日付システム）→ UTC 日付
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    return formatDate(dt);
  }
  const s = String(value ?? "").trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) {
    return {
      date: `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`,
    };
  }
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
  if (slash) {
    return {
      date: `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`,
    };
  }
  return { date: "", warning: `日付を解釈できません: "${s}"` };
}

// --- マッピング --------------------------------------------------------------

/** Form: AABA/ABAC/Blues→BLUES12、その他→OTHER（原文は note へ） */
export function mapForm(raw: string): { form: string; noteExtra?: string } {
  const t = raw.trim();
  const low = t.toLowerCase();
  if (low === "aaba") return { form: "AABA" };
  if (low === "abac") return { form: "ABAC" };
  if (low === "blues" || low === "blues12") return { form: "BLUES12" };
  if (t === "") return { form: "OTHER" };
  return { form: "OTHER", noteExtra: `Form:${t}` };
}

/** Genre: 9語彙へ。曖昧値は空 + note に原文（warning も返す） */
export function mapGenre(raw: string): {
  genres: string[];
  noteExtra?: string;
  warning?: string;
} {
  const t = raw.trim();
  if (t === "") return { genres: [] };
  const mapped = GENRE_MAP[t.toLowerCase()];
  if (mapped) return { genres: [mapped] };
  return {
    genres: [],
    noteExtra: `Genre:${t}`,
    warning: `曖昧なジャンル（未設定にしました）: "${t}"`,
  };
}

/** PlayedPart: as→SAX/pf→PIANO/-・空→不参加(NONE) */
export function mapPlayedPart(raw: string): {
  participated: string;
  instrument: string;
} {
  const t = raw.trim().toLowerCase();
  if (t === "as" || t === "sax") return { participated: "1", instrument: "sax" };
  if (t === "pf" || t === "piano") {
    return { participated: "1", instrument: "piano" };
  }
  return { participated: "0", instrument: "" };
}

/**
 * Logs 列（"曲名 (as, ts) ※メモ"）の括弧内からフロント編成を抽出する。
 * - カンマ区切り、順序保持・重複可
 * - `as*2` → as,as
 * - `trio`/`all`/空 → 編成なし
 * - 絵文字・※注記は除去、未知コードは warnings へ
 * 返り値は `|` 区切り（setlists.csv の front_instruments 列そのまま）
 */
export function parseFrontInstruments(
  logs: string,
  warnings: string[] = [],
): string {
  const m = /[（(]([^）)]*)[）)]/.exec(logs);
  if (!m) return "";
  const inner = m[1];
  const tokens = inner
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const out: string[] = [];
  for (const tokRaw of tokens) {
    const low = tokRaw.toLowerCase();
    // as*2 / as×2 形式
    const star = /^([a-z]+)\s*[*✕x×]\s*(\d+)$/.exec(low);
    if (star) {
      const code = star[1];
      const n = Number(star[2]);
      if (!KNOWN_INSTRUMENT_CODES.has(code)) {
        warnings.push(`未知の楽器コード: "${tokRaw}"`);
        continue;
      }
      for (let i = 0; i < n; i++) out.push(code);
      continue;
    }
    // 絵文字・※注記・空白を除去して英字コードのみ残す
    const clean = low.replace(/[^a-z]/g, "");
    if (clean === "" || NON_FORMATION_TOKENS.has(clean)) continue;
    if (!KNOWN_INSTRUMENT_CODES.has(clean)) {
      warnings.push(`未知の楽器コード: "${tokRaw}"`);
      continue;
    }
    out.push(clean);
  }
  return out.join("|");
}

// --- CSV 出力 ----------------------------------------------------------------

function csvField(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function csvRow(fields: string[]): string {
  return fields.map(csvField).join(",");
}

const SONGS_HEADER = [
  "title",
  "key",
  "form",
  "composer",
  "has_played",
  "no_chart_ok",
  "is_standard",
  "simple_form",
  "in_kurobon1",
  "season",
  "listener_level",
  "energy_level",
  "genres",
  "note",
];

const SETLISTS_HEADER = [
  "date",
  "venue_name",
  "order",
  "title",
  "participated",
  "instrument",
  "called_by_me",
  "no_chart",
  "memo",
  "front_instruments",
];

// --- ヘッダ列の検出 ----------------------------------------------------------

type Aliases = Record<string, string[]>;

const LIST_ALIASES: Aliases = {
  title: ["title", "曲名"],
  key: ["key", "キー"],
  form: ["form", "構成"],
  composer: ["composer", "作曲", "作曲者"],
  ready: ["ready", "可"],
  done: ["done", "済"],
  kurobon1: ["#1", "黒本1", "黒本"],
  genre: ["genre", "ジャンル"],
};

const LOGS_ALIASES: Aliases = {
  title: ["title", "曲名"],
  date: ["date", "日付"],
  place: ["place", "店", "会場", "場所"],
  playedPart: ["playedpart", "played part", "part", "担当"],
  callingByMe: ["callingbyme", "calling by me", "call", "コール"],
  noScore: ["noscore", "no score", "譜面なし"],
  logs: ["logs", "log", "ログ"],
};

interface ColumnMap {
  headerRow: number;
  cols: Record<string, number>;
}

/** ヘッダ行を最大 maxScan 行から探し、alias に一致する列番号を確定する */
function detectColumns(
  sheet: ExcelJS.Worksheet,
  aliases: Aliases,
  requiredKey: string,
  maxScan = 10,
): ColumnMap {
  for (let r = 1; r <= maxScan; r++) {
    const row = sheet.getRow(r);
    const cols: Record<string, number> = {};
    row.eachCell((cell, colNumber) => {
      const label = cellText(cell.value).toLowerCase();
      if (label === "") return;
      for (const [key, names] of Object.entries(aliases)) {
        if (cols[key] !== undefined) continue;
        if (names.some((n) => label === n.toLowerCase())) {
          cols[key] = colNumber;
        }
      }
    });
    if (cols[requiredKey] !== undefined) {
      return { headerRow: r, cols };
    }
  }
  throw new Error(
    `ヘッダ行が見つかりません（列 "${requiredKey}" を含む行なし）: シート「${sheet.name}」`,
  );
}

function pickSheet(
  wb: ExcelJS.Workbook,
  name: string,
): ExcelJS.Worksheet | undefined {
  const exact = wb.getWorksheet(name);
  if (exact) return exact;
  const low = name.toLowerCase();
  return wb.worksheets.find((s) => s.name.toLowerCase().includes(low));
}

// --- 抽出本体 ----------------------------------------------------------------

export interface ExtractResult {
  songsCsv: string;
  setlistsCsv: string;
  warnings: string[];
  songCount: number;
  setlistCount: number;
}

/**
 * logs_all → setlists.csv。副産物として no_chart_ok 導出用の
 * 「NoScore=1 の実績がある曲」正規化タイトル集合を返す。
 */
function extractSetlists(
  sheet: ExcelJS.Worksheet,
  warnings: string[],
): { csv: string; count: number; noChartTitles: Set<string> } {
  const { headerRow, cols } = detectColumns(sheet, LOGS_ALIASES, "title");
  const rows: string[] = [csvRow(SETLISTS_HEADER)];
  const orderByGroup = new Map<string, number>();
  const noChartTitles = new Set<string>();
  let count = 0;

  const get = (row: ExcelJS.Row, key: string): ExcelJS.CellValue =>
    cols[key] !== undefined ? row.getCell(cols[key]).value : null;

  const last = sheet.rowCount;
  for (let r = headerRow + 1; r <= last; r++) {
    const row = sheet.getRow(r);
    const title = cellText(get(row, "title"));
    if (title === "") continue; // 空行スキップ

    const { date, warning: dateWarn } = formatDate(get(row, "date"));
    if (dateWarn) {
      warnings.push(`[logs 行${r}] ${dateWarn}（曲: ${title}）`);
      continue;
    }
    const venue = cellText(get(row, "place"));
    if (venue === "") {
      warnings.push(`[logs 行${r}] Place が空です（曲: ${title}）`);
      continue;
    }

    const { participated, instrument } = mapPlayedPart(
      cellText(get(row, "playedPart")),
    );
    const calledByMe = isTruthyMark(cellText(get(row, "callingByMe")))
      ? "1"
      : "0";
    const noScore = isTruthyMark(cellText(get(row, "noScore")));
    const front = parseFrontInstruments(cellText(get(row, "logs")), warnings);

    if (noScore) noChartTitles.add(normalizeTitle(title));

    const groupKey = `${date} ${venue}`;
    const order = (orderByGroup.get(groupKey) ?? 0) + 1;
    orderByGroup.set(groupKey, order);

    rows.push(
      csvRow([
        date,
        venue,
        String(order),
        title,
        participated,
        instrument,
        calledByMe,
        noScore ? "1" : "0",
        "",
        front,
      ]),
    );
    count++;
  }
  return { csv: rows.join("\n") + "\n", count, noChartTitles };
}

/** list → songs.csv（no_chart_ok は logs 由来の集合で導出） */
function extractSongs(
  sheet: ExcelJS.Worksheet,
  noChartTitles: Set<string>,
  warnings: string[],
): { csv: string; count: number } {
  const { headerRow, cols } = detectColumns(sheet, LIST_ALIASES, "title");
  const rows: string[] = [csvRow(SONGS_HEADER)];
  let count = 0;

  const get = (row: ExcelJS.Row, key: string): ExcelJS.CellValue =>
    cols[key] !== undefined ? row.getCell(cols[key]).value : null;

  const last = sheet.rowCount;
  for (let r = headerRow + 1; r <= last; r++) {
    const row = sheet.getRow(r);
    const title = cellText(get(row, "title"));
    if (title === "") continue;

    const key = cellText(get(row, "key"));
    const { form, noteExtra: formNote } = mapForm(cellText(get(row, "form")));
    const composer = cellText(get(row, "composer"));
    const hasPlayed =
      isTruthyMark(cellText(get(row, "ready"))) ||
      isTruthyMark(cellText(get(row, "done")))
        ? "1"
        : "0";
    const inKurobon1 = isTruthyMark(cellText(get(row, "kurobon1"))) ? "1" : "0";
    const {
      genres,
      noteExtra: genreNote,
      warning: genreWarn,
    } = mapGenre(cellText(get(row, "genre")));
    if (genreWarn) warnings.push(`[list 行${r}] ${genreWarn}（曲: ${title}）`);

    const noChartOk = noChartTitles.has(normalizeTitle(title)) ? "1" : "0";
    const note = [formNote, genreNote].filter(Boolean).join("; ");

    rows.push(
      csvRow([
        title,
        key,
        form,
        composer,
        hasPlayed,
        noChartOk,
        "0", // is_standard 既定
        "0", // simple_form 既定
        inKurobon1,
        "通年", // season 既定
        "3", // listener_level 既定
        "3", // energy_level 既定
        genres.join("|"),
        note,
      ]),
    );
    count++;
  }
  return { csv: rows.join("\n") + "\n", count };
}

/** ワークブック全体を CSV 群へ変換する（logs を先に処理して no_chart_ok を導出） */
export function extractWorkbook(wb: ExcelJS.Workbook): ExtractResult {
  const warnings: string[] = [];
  const listSheet = pickSheet(wb, "list");
  const logsSheet = pickSheet(wb, "logs_all");
  if (!listSheet) throw new Error("シート「list」が見つかりません");
  if (!logsSheet) throw new Error("シート「logs_all」が見つかりません");

  const setlists = extractSetlists(logsSheet, warnings);
  const songs = extractSongs(listSheet, setlists.noChartTitles, warnings);

  return {
    songsCsv: songs.csv,
    setlistsCsv: setlists.csv,
    warnings,
    songCount: songs.count,
    setlistCount: setlists.count,
  };
}

// --- CLI ---------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const xlsxPath = args.find((a) => !a.startsWith("--"));
  const outIdx = args.indexOf("--out-dir");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : process.cwd();
  if (!xlsxPath) {
    console.error(
      "使い方: tsx scripts/extract-excel.ts <xlsx-path> [--out-dir <dir>]",
    );
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const result = extractWorkbook(wb);

  const songsPath = path.join(outDir, "songs.csv");
  const setlistsPath = path.join(outDir, "setlists.csv");
  const warnPath = path.join(outDir, "extract-warnings.txt");
  writeFileSync(songsPath, result.songsCsv, "utf8");
  writeFileSync(setlistsPath, result.setlistsCsv, "utf8");
  writeFileSync(
    warnPath,
    result.warnings.length > 0
      ? result.warnings.join("\n") + "\n"
      : "（警告なし）\n",
    "utf8",
  );

  console.log(`[extract] songs.csv: ${result.songCount} 曲 → ${songsPath}`);
  console.log(
    `[extract] setlists.csv: ${result.setlistCount} 行 → ${setlistsPath}`,
  );
  console.log(
    `[extract] 警告 ${result.warnings.length} 件 → ${warnPath}`,
  );
  if (result.warnings.length > 0) {
    console.error("--- 警告（人間が確認してください）---");
    for (const w of result.warnings.slice(0, 50)) console.error(w);
    if (result.warnings.length > 50) {
      console.error(`... ほか ${result.warnings.length - 50} 件`);
    }
  }
}

// CLI として実行された場合のみ main を呼ぶ（テストからの import 時は実行しない）
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
