/**
 * 編集後 xlsx → songs.csv 変換スクリプト（unit-06 Task B）
 *
 *   tsx scripts/master-xlsx-to-csv.ts <edited.xlsx> [--out <csv>]
 *
 * Google Sheets で編集した xlsx（`master` シート）の左側編集列のみを読み、
 * 日本語ラベル→コード解決して songs.csv（SONGS_CSV_HEADERS）を出力する。
 * 参考3列は読まない。不正値（未知ラベル・範囲外 difficulty/level・未知ジャンル列・
 * 曲名改変）は行番号付きで検出し、1件でもあれば CSV を出さず中断する（黙って壊さない）。
 *
 * `@/` エイリアスは tsx では解決されないため相対 import のみ。
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { cellText } from "./extract-excel";
import {
  COLUMN_LABELS,
  TITLE_KEY_HEADER,
  buildSongsCsv,
  decodeRow,
  type RowError,
} from "./master-mapping";

/** workbookToCsv の結果（成功時 csv・失敗時 errors） */
export interface WorkbookToCsvResult {
  csv?: string;
  errors: RowError[];
}

/**
 * 編集後ワークブック → songs.csv（純関数・IO なし）。
 * `master` シート行1のヘッダを名前で検出（列並べ替え耐性）。
 * errors が1件でもあれば csv は返さない（部分出力しない）。
 */
export function workbookToCsv(wb: ExcelJS.Workbook): WorkbookToCsvResult {
  const ws =
    wb.getWorksheet("master") ??
    wb.worksheets.find((s) => s.name.toLowerCase() === "master");
  if (!ws) {
    return { errors: [{ line: 0, reason: "シート「master」が見つかりません" }] };
  }

  // 行1ヘッダ → header名 → 0始まり列インデックス
  const headerRow = ws.getRow(1);
  const headerIndex: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    const label = cellText(cell.value);
    if (label !== "") headerIndex[label] = colNumber - 1;
  });

  const titleCol = headerIndex[COLUMN_LABELS.title];
  const titleKeyCol = headerIndex[TITLE_KEY_HEADER];

  const rows: Record<string, string>[] = [];
  const errors: RowError[] = [];

  const last = ws.rowCount;
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    // 列番号 → セル文字列（0始まり配列）
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = cellText(cell.value);
    });

    // 完全な空行はスキップ（曲名・照合キーが共に空）
    const title = titleCol !== undefined ? (cells[titleCol] ?? "").trim() : "";
    const titleKey =
      titleKeyCol !== undefined ? (cells[titleKeyCol] ?? "").trim() : "";
    if (title === "" && titleKey === "") continue;

    const result = decodeRow(headerIndex, cells, r);
    if (result.errors.length > 0) {
      errors.push(...result.errors);
    } else if (result.row) {
      rows.push(result.row);
    }
  }

  if (errors.length > 0) return { errors };
  return { csv: buildSongsCsv(rows), errors: [] };
}

// --- CLI ---------------------------------------------------------------------

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inPath = args.find((a) => !a.startsWith("--"));
  const outPath = argValue(args, "--out") ?? "songs.csv";
  if (!inPath) {
    console.error(
      "使い方: tsx scripts/master-xlsx-to-csv.ts <edited.xlsx> [--out <csv>]",
    );
    process.exit(1);
    return;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inPath);
  const result = workbookToCsv(wb);

  if (result.errors.length > 0) {
    console.error(
      `[master-csv] ${result.errors.length} 件のエラーを検出しました。CSV は出力しません。`,
    );
    for (const e of result.errors) {
      console.error(`[行${e.line}] ${e.reason}`);
    }
    process.exit(1);
    return;
  }

  writeFileSync(outPath, result.csv ?? "", "utf8");
  console.log(`[master-csv] ${outPath} を出力しました`);
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
