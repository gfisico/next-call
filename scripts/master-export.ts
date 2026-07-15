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
    map.set(normalizeTitle(e.title_normalized), {
      difficulty_1_5: e.difficulty_1_5 ?? null,
      comment: e.comment ?? "",
      level_9: e.level_9 ?? "",
    });
  }
  return map;
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
    const ref = kurobonRef.get(normalizeTitle(song.title));
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
    if (kurobonRef.has(normalizeTitle(s.title))) n++;
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
