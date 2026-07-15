/**
 * 成功基準1/2/3/4/5 の xlsx 面: buildWorkbook で生成した xlsx を
 * writeBuffer→読み戻し→workbookToCsv→parse まで通し、往復不変・参考列突合・
 * ドロップダウン(dataValidation)保持・__title_key 隠し・曲名セル保護を検証する。
 *
 * 実データ（やれる曲.xlsx）・ローカル DB は CI に無いため、合成 EditableSong[] と
 * inline の参考データ Map で完結させる。
 */
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { normalizeTitle } from "@/lib/normalize-title";
import { songsCsvRowSchema } from "@/server/validation/import";
import {
  buildWorkbook,
  type KurobonRef,
} from "../../scripts/master-export";
import { workbookToCsv } from "../../scripts/master-xlsx-to-csv";
import {
  COLUMN_LABELS,
  REFERENCE_HEADERS,
  TITLE_KEY_HEADER,
  type EditableSong,
} from "../../scripts/master-mapping";

const SONGS: EditableSong[] = [
  {
    title: "Stella By Starlight",
    key: "Bb",
    form: "AABA",
    composer: "Victor Young",
    hasPlayed: true,
    noChartOk: false,
    isStandard: true,
    difficulty: 4,
    inKurobon1: true,
    season: "WINTER",
    listenerLevel: 4,
    energyLevel: 3,
    genres: ["バラード", "循環"],
    note: "メモ",
  },
  {
    title: "Blue Bossa",
    key: "Cm",
    form: "BLUES12",
    composer: "Kenny Dorham",
    hasPlayed: false,
    noChartOk: true,
    isStandard: false,
    difficulty: null,
    inKurobon1: false,
    season: "ALL",
    listenerLevel: 3,
    energyLevel: 5,
    genres: ["ボサノバ"],
    note: null,
  },
];

const REF: KurobonRef = new Map([
  [
    normalizeTitle("Stella By Starlight"),
    { difficulty_1_5: 5, comment: "テーマが難しい", level_9: "上級-" },
  ],
  // Blue Bossa は非黒本1 → 参考データ無し（突合しない）
]);

/** ワークブックを writeBuffer→load して読み戻す（Sheets 往復のシミュレーション） */
async function roundTripWorkbook(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf as ArrayBuffer);
  return wb2;
}

/** worksheet 行1から header→列番号(1始まり)を得る */
function headerColumns(ws: ExcelJS.Worksheet): Record<string, number> {
  const map: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, col) => {
    map[String(cell.value ?? "").trim()] = col;
  });
  return map;
}

describe("master-xlsx: buildWorkbook 往復不変", () => {
  it("writeBuffer→読み戻し→workbookToCsv→parse でドメインが一致する", async () => {
    const wb = buildWorkbook(SONGS, REF);
    const wb2 = await roundTripWorkbook(wb);
    const result = workbookToCsv(wb2);
    expect(result.errors).toEqual([]);
    expect(result.csv).toBeDefined();

    const records = parse(result.csv!, {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];
    expect(records).toHaveLength(2);

    const parsed = records.map((r) => songsCsvRowSchema.parse(r));
    const stella = parsed.find((p) => p.title === "Stella By Starlight")!;
    expect(stella).toMatchObject({
      songKey: "Bb",
      form: "AABA",
      hasPlayed: true,
      noChartOk: false,
      isStandard: true,
      difficulty: 4,
      inKurobon1: true,
      season: "WINTER",
      listenerLevel: 4,
      energyLevel: 3,
      genres: ["バラード", "循環"],
    });
    const bossa = parsed.find((p) => p.title === "Blue Bossa")!;
    expect(bossa).toMatchObject({
      form: "BLUES12",
      hasPlayed: false,
      noChartOk: true,
      difficulty: null,
      season: "ALL",
      genres: ["ボサノバ"],
      note: null,
    });
  });
});

describe("master-xlsx: ドロップダウン・隠し列・曲名保護", () => {
  it("編集列にインラインの list データ検証が付く（生成時・読み戻し後とも）", async () => {
    const wb = buildWorkbook(SONGS, REF);
    const ws = wb.getWorksheet("master")!;
    const cols = headerColumns(ws);
    // 生成時
    const formCell = ws.getRow(2).getCell(cols[COLUMN_LABELS.form]);
    expect(formCell.dataValidation?.type).toBe("list");
    // 読み戻し後も保持される（Sheets 取り込みでドロップダウンが残る根拠）
    const wb2 = await roundTripWorkbook(wb);
    const ws2 = wb2.getWorksheet("master")!;
    const cols2 = headerColumns(ws2);
    const diffCell = ws2.getRow(2).getCell(cols2[COLUMN_LABELS.difficulty]);
    expect(diffCell.dataValidation?.type).toBe("list");
    const genreCell = ws2.getRow(2).getCell(cols2["バラード"]);
    expect(genreCell.dataValidation?.type).toBe("list");
  });

  it("__title_key 列が hidden・曲名セルが fill/locked", async () => {
    const wb = buildWorkbook(SONGS, REF);
    const ws = wb.getWorksheet("master")!;
    const cols = headerColumns(ws);

    const titleCell = ws.getRow(2).getCell(cols[COLUMN_LABELS.title]);
    expect(titleCell.protection?.locked).toBe(true);
    expect(titleCell.fill).toBeDefined();
    // 編集列はロックされない
    const keyCell = ws.getRow(2).getCell(cols[COLUMN_LABELS.key]);
    expect(keyCell.protection?.locked).toBe(false);

    // __title_key 列は hidden（読み戻し後も）
    const wb2 = await roundTripWorkbook(wb);
    const ws2 = wb2.getWorksheet("master")!;
    const cols2 = headerColumns(ws2);
    expect(ws2.getColumn(cols2[TITLE_KEY_HEADER]).hidden).toBe(true);
  });
});

describe("master-xlsx: 参考列突合（インポート対象外）", () => {
  it("黒本1一致曲に参考3列、非一致は空。CSV には出ない", async () => {
    const wb = buildWorkbook(SONGS, REF);
    const ws = wb.getWorksheet("master")!;
    const cols = headerColumns(ws);
    const text = (row: number, header: string) =>
      String(ws.getRow(row).getCell(cols[header]).value ?? "");

    // Stella（黒本1一致）→ 参考3列が埋まる
    expect(text(2, REFERENCE_HEADERS.difficulty)).toBe("5");
    expect(text(2, REFERENCE_HEADERS.comment)).toBe("テーマが難しい");
    expect(text(2, REFERENCE_HEADERS.level)).toBe("上級-");
    // Blue Bossa（非一致）→ 空
    expect(text(3, REFERENCE_HEADERS.difficulty)).toBe("");
    expect(text(3, REFERENCE_HEADERS.comment)).toBe("");

    // 変換後 CSV には参考列も参考値も出ない
    const wb2 = await roundTripWorkbook(wb);
    const result = workbookToCsv(wb2);
    const header = result.csv!.split("\n")[0].split(",");
    expect(header).not.toContain(REFERENCE_HEADERS.difficulty);
    expect(header).not.toContain(REFERENCE_HEADERS.comment);
    expect(result.csv).not.toContain("テーマが難しい");
    expect(result.csv).not.toContain("上級-");
  });
});

describe("master-xlsx: エラー系（不正値で中断・CSV 未生成）", () => {
  it("difficulty=9 を行番号付きで検出し CSV を出さない", () => {
    const wb = buildWorkbook(SONGS, REF);
    const ws = wb.getWorksheet("master")!;
    const cols = headerColumns(ws);
    ws.getRow(2).getCell(cols[COLUMN_LABELS.difficulty]).value = "9";

    const result = workbookToCsv(wb);
    expect(result.csv).toBeUndefined();
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[0].reason).toContain("難易度");
  });

  it("曲名改変（__title_key と不一致）を検出し CSV を出さない", () => {
    const wb = buildWorkbook(SONGS, REF);
    const ws = wb.getWorksheet("master")!;
    const cols = headerColumns(ws);
    ws.getRow(3).getCell(cols[COLUMN_LABELS.title]).value = "勝手に改名";

    const result = workbookToCsv(wb);
    expect(result.csv).toBeUndefined();
    expect(result.errors.some((e) => e.reason.includes("照合キー"))).toBe(true);
  });
});
