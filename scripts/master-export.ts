/**
 * 曲マスタ一括編集用 xlsx 生成スクリプト（unit-06 Task A）
 *
 *   tsx scripts/master-export.ts [--source list|db] [--in <xlsx>] \
 *       [--out <xlsx>] [--reference <json>]
 *
 * 全曲を「人が読めるラベル + ドロップダウン + 9列✓ジャンル + 曲名保護」の
 * 編集用 xlsx に展開する。左側=songs.csv インポート互換の編集列（difficulty 含む・
 * simple_form 除外）、右側=参考列（黒本1突合の難易度叩き台・コメント・攻め方目安、
 * インポート対象外）。
 *
 * `@/` エイリアスは tsx では解決されないため相対 import のみ。zod スキーマ
 * （import.ts）は @/db/seed 依存のため本スクリプトからは import しない。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { openDatabase, getDatabasePath } from "../src/db/client";
import { genreTags, songGenreTags, songs } from "../src/db/schema";
import { normalizeTitle } from "../src/lib/normalize-title";
import { extractWorkbook } from "./extract-excel";
import {
  COLUMNS,
  TITLE_KEY_HEADER,
  songToDisplayRow,
  type EditableSong,
  type FormCode,
  type SeasonCode,
} from "./master-mapping";

/** 参考データ（黒本1の難易度叩き台）1件 */
interface KurobonRefEntry {
  difficulty_1_5: number | null;
  comment: string;
  level_9: string;
}

export type KurobonRef = Map<string, KurobonRefEntry>;

/**
 * 参考列付与「専用」の緩い突合キー。import 同定契約の `normalizeTitle` とは別物で、
 * 曲名の綴り揺れ（カーリー・アポストロフィ、先頭/末尾の冠詞、記号・空白差）を吸収する。
 * あくまで advisory な参考列の付与にのみ使用し、CSV の同定キーには使わない。
 */
export function looseTitleKey(title: string): string {
  let x = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();
  x = x.replace(/,\s*(the|a|an)$/, ""); // 末尾冠詞（アプリの "Name, The" 形式）
  x = x.replace(/^(the|a|an)\s+/, ""); // 先頭冠詞
  x = x.replace(/[^a-z0-9]+/g, ""); // 記号・空白を除去
  return x;
}

/**
 * アプリ側の表記が参照データと系統的に異なる曲の明示エイリアス。
 * キー = アプリ曲名（looseTitleKey 適用前）、値 = 参照データの title_normalized。
 */
const REF_ALIASES: Record<string, string> = {
  "Freddie The Freeloader": "freddie freeloader",
  Recado: "recado bossa nova",
};

// --- ソース → EditableSong[] --------------------------------------------------

const SEASON_LABEL_TO_CODE: Record<string, SeasonCode> = {
  春: "SPRING",
  夏: "SUMMER",
  秋: "AUTUMN",
  冬: "WINTER",
  通年: "ALL",
  "": "ALL",
};

/**
 * [list] 主経路: 既存 extract-excel の抽出を再利用して songs.csv 相当を得る。
 * difficulty / season / level は list に無いため既定（null / ALL / 3）になる。
 */
export function songsFromExtract(wb: ExcelJS.Workbook): EditableSong[] {
  const { songsCsv } = extractWorkbook(wb);
  const records = parse(songsCsv, {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
  return records.map((r) => {
    const diff = r.difficulty?.trim() ?? "";
    return {
      title: r.title,
      key: r.key === "" ? null : r.key,
      form: (r.form || "OTHER") as FormCode,
      composer: r.composer === "" ? null : r.composer,
      hasPlayed: r.has_played === "1",
      noChartOk: r.no_chart_ok === "1",
      isStandard: r.is_standard === "1",
      difficulty: diff === "" ? null : Number(diff),
      inKurobon1: r.in_kurobon1 === "1",
      season: SEASON_LABEL_TO_CODE[r.season?.trim() ?? ""] ?? "ALL",
      listenerLevel: r.listener_level === "" ? 3 : Number(r.listener_level),
      energyLevel: r.energy_level === "" ? 3 : Number(r.energy_level),
      genres: r.genres === "" ? [] : r.genres.split("|").filter((g) => g !== ""),
      note: r.note === "" ? null : r.note,
    } satisfies EditableSong;
  });
}

/** DB 副経路: 現行 DB から現在値で全曲を取得（repositories は使わず schema 直クエリ） */
export function songsFromDb(dbPath: string): EditableSong[] {
  const { db, sqlite } = openDatabase(dbPath);
  try {
    const rows = db.select().from(songs).all();
    const genreRows = db
      .select({ songId: songGenreTags.songId, name: genreTags.name })
      .from(songGenreTags)
      .innerJoin(genreTags, eq(songGenreTags.genreTagId, genreTags.id))
      .all();
    const genresBySong = new Map<number, string[]>();
    for (const g of genreRows) {
      const list = genresBySong.get(g.songId) ?? [];
      list.push(g.name);
      genresBySong.set(g.songId, list);
    }
    return rows.map((s) => ({
      title: s.title,
      key: s.songKey,
      form: s.form as FormCode,
      composer: s.composer,
      hasPlayed: s.hasPlayed,
      noChartOk: s.noChartOk,
      isStandard: s.isStandard,
      difficulty: s.difficulty ?? null,
      inKurobon1: s.inKurobon1,
      season: s.season as SeasonCode,
      listenerLevel: s.listenerLevel,
      energyLevel: s.energyLevel,
      genres: genresBySong.get(s.id) ?? [],
      note: s.note,
    }));
  } finally {
    sqlite.close();
  }
}

// --- 参考データ読み込み -------------------------------------------------------

/** kurobon1-difficulty.json → Map<title_normalized, entry> */
export function loadKurobonRef(jsonPath: string): KurobonRef {
  const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as Array<{
    title_normalized: string;
    difficulty_1_5: number | null;
    comment?: string;
    level_9?: string;
  }>;
  const map: KurobonRef = new Map();
  for (const e of raw) {
    const entry: KurobonRefEntry = {
      difficulty_1_5: e.difficulty_1_5 ?? null,
      comment: e.comment ?? "",
      level_9: e.level_9 ?? "",
    };
    map.set(normalizeTitle(e.title_normalized), entry);
    // 緩いキーも登録（strict を上書きしない）。曲名の綴り揺れを吸収する。
    const loose = looseTitleKey(e.title_normalized);
    if (!map.has(loose)) map.set(loose, entry);
  }
  // 明示エイリアス（アプリ表記 → 参照データ）を緩いキーで追加登録
  for (const [appTitle, refNorm] of Object.entries(REF_ALIASES)) {
    const entry = map.get(normalizeTitle(refNorm));
    if (!entry) continue;
    const k = looseTitleKey(appTitle);
    if (!map.has(k)) map.set(k, entry);
  }
  return map;
}

/** 曲名で参考データを引く（strict → loose の順）。 */
export function lookupRef(
  kurobonRef: KurobonRef,
  title: string,
): KurobonRefEntry | undefined {
  return (
    kurobonRef.get(normalizeTitle(title)) ??
    kurobonRef.get(looseTitleKey(title))
  );
}

// --- 作曲者オーバーライド -----------------------------------------------------

/**
 * composers.json（[{ title_normalized|title, composer }]）→ Map<key, composer>。
 * ファイルが無ければ空 Map（補完なし）。strict＋loose の両キーで登録。
 */
export function loadComposerOverrides(jsonPath: string): Map<string, string> {
  const map = new Map<string, string>();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return map; // 未生成でも致命ではない
  }
  if (!Array.isArray(raw)) return map;
  for (const e of raw as Array<Record<string, unknown>>) {
    const composer = typeof e.composer === "string" ? e.composer.trim() : "";
    if (composer === "") continue;
    const t =
      typeof e.title_normalized === "string"
        ? e.title_normalized
        : typeof e.title === "string"
          ? e.title
          : "";
    if (t === "") continue;
    map.set(normalizeTitle(t), composer);
    const loose = looseTitleKey(t);
    if (!map.has(loose)) map.set(loose, composer);
  }
  return map;
}

/** composer が空欄の曲のみオーバーライドで補完。補完した件数を返す。 */
export function applyComposerOverrides(
  editable: EditableSong[],
  overrides: Map<string, string>,
): number {
  if (overrides.size === 0) return 0;
  let n = 0;
  for (const s of editable) {
    if (s.composer != null && s.composer.trim() !== "") continue;
    const c =
      overrides.get(normalizeTitle(s.title)) ??
      overrides.get(looseTitleKey(s.title));
    if (c) {
      s.composer = c;
      n++;
    }
  }
  return n;
}

// --- ワークブック生成（純関数・IO なし） -------------------------------------

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFDDE6F0" },
};

const TITLE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFEFEFEF" },
};

/**
 * EditableSong[] + 参考データ → 編集用ワークブック（シート `master` 1枚）。
 * 純関数（ファイル IO なし）。CLI 側で protect / writeFile する。
 */
export function buildWorkbook(
  editable: EditableSong[],
  kurobonRef: KurobonRef,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("master");

  // 行1: ヘッダ
  const headerRow = ws.addRow(COLUMNS.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.protection = { locked: true };
  });

  for (const song of editable) {
    const display = songToDisplayRow(song);
    const ref = lookupRef(kurobonRef, song.title);
    const values = COLUMNS.map((c) => {
      if (c.kind === "reference") {
        if (!ref) return "";
        if (c.key === "ref_difficulty") {
          return ref.difficulty_1_5 == null ? "" : String(ref.difficulty_1_5);
        }
        if (c.key === "ref_comment") return ref.comment;
        return ref.level_9;
      }
      return display[c.header] ?? "";
    });
    const row = ws.addRow(values);

    COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.kind === "title") {
        cell.fill = TITLE_FILL;
        cell.protection = { locked: true };
      } else {
        cell.protection = { locked: false };
      }
      if (c.listValidation) {
        cell.dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`"${c.listValidation.join(",")}"`],
        };
      }
    });
  }

  // 列幅・隠し列
  COLUMNS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.key === TITLE_KEY_HEADER) {
      col.hidden = true;
      col.width = 20;
    } else if (c.kind === "reference" || c.header === "曲名") {
      col.width = 24;
    } else {
      col.width = 12;
    }
  });

  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  return wb;
}

/** 黒本1突合で参考列が埋まる曲数を数える（ログ用） */
export function countReferenceMatches(
  editable: EditableSong[],
  kurobonRef: KurobonRef,
): number {
  let n = 0;
  for (const s of editable) {
    if (lookupRef(kurobonRef, s.title)) n++;
  }
  return n;
}

// --- CLI ---------------------------------------------------------------------

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const source =
    argValue(args, "--source") ?? process.env.MASTER_SOURCE ?? "list";
  const inPath = argValue(args, "--in") ?? "docs/やれる曲.xlsx";
  const outPath = argValue(args, "--out") ?? "docs/song-master-edit.xlsx";
  const refPath =
    argValue(args, "--reference") ?? "docs/reference/kurobon1-difficulty.json";
  const composersPath =
    argValue(args, "--composers") ?? "docs/reference/composers.json";

  let editable: EditableSong[];
  if (source === "db") {
    const dbPath = getDatabasePath();
    console.log(`[master-export] source=db (${dbPath})`);
    editable = songsFromDb(dbPath);
  } else if (source === "list") {
    console.log(`[master-export] source=list (${inPath})`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(inPath);
    editable = songsFromExtract(wb);
  } else {
    console.error(`不明な --source です: "${source}"（list | db）`);
    process.exit(1);
    return;
  }

  const composerOverrides = loadComposerOverrides(composersPath);
  const composerFilled = applyComposerOverrides(editable, composerOverrides);

  const kurobonRef = loadKurobonRef(refPath);
  const wb = buildWorkbook(editable, kurobonRef);

  // best-effort: シート保護（Google Sheets は無視するが Excel 向け。曲名列ロック）
  try {
    await wb
      .getWorksheet("master")
      ?.protect("", { selectLockedCells: true, selectUnlockedCells: true });
  } catch {
    // 保護不可でも致命ではない（曲名列は fill で視覚的に区別）
  }

  await wb.xlsx.writeFile(outPath);

  const matches = countReferenceMatches(editable, kurobonRef);
  console.log(`[master-export] ${editable.length} 曲 → ${outPath}`);
  console.log(`[master-export] 参考列付与: ${matches} 曲（黒本1突合）`);
  const blanks = editable.filter(
    (s) => s.composer == null || s.composer.trim() === "",
  ).length;
  console.log(
    `[master-export] 作曲者補完: ${composerFilled} 曲（残ブランク ${blanks} 曲）`,
  );
  if (source === "list") {
    console.log(
      "[master-export] 注: list 経路は difficulty=未設定 / season=通年 / level=3 が既定値です（現在値で埋めたい場合は --source db）",
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
