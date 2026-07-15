/**
 * 成功基準10: 抽出スクリプトが匿名化した小型 xlsx から songs.csv / setlists.csv を生成し、
 * has_played（Ready/Done）・in_kurobon1（#1）・Genre マッピング・フロント編成パース
 * （as*2/trio/空を含む）・no_chart_ok 導出が discovery.md の表どおりであることを検証する。
 *
 * 実データ（やれる曲.xlsx）はコミットしないため、exceljs でフィクスチャを生成する。
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  extractWorkbook,
  mapGenre,
  parseFrontInstruments,
} from "../../scripts/extract-excel";

/** ヘッダ + 行から CSV をオブジェクト配列に戻す簡易パーサ（テスト検証用・引用符なし前提） */
function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    // 単純分割（フィクスチャは引用符を含まない値のみ使用）
    const cells = line.split(",");
    const obj: Record<string, string> = {};
    header.forEach((h, i) => (obj[h] = cells[i] ?? ""));
    return obj;
  });
}

function buildFixture(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const list = wb.addWorksheet("list");
  list.addRow([]); // 1行目空
  list.addRow([]); // 2行目空
  list.addRow(["Title", "Key", "Form", "Composer", "Ready", "Done", "#1", "Genre"]); // 3行目ヘッダ
  list.addRow(["Stella", "Bb", "AABA", "Victor Young", "★", "", "■", "Ballad"]);
  list.addRow(["Recorda Me", "C", "special", "Joe Henderson", "", "★", "", "Bossa"]);
  list.addRow(["Blue Monk", "F", "Blues", "Monk", "", "", "■", "Blues"]);
  list.addRow(["Waltz Tune", "G", "ABAC", "X", "★", "", "", "Waltz"]);
  list.addRow(["Ambiguous", "", "ABAB", "", "", "", "", "Swing or Bossa"]);

  const logs = wb.addWorksheet("logs_all");
  logs.addRow(["Title", "Date", "Place", "PlayedPart", "CallingByMe", "NoScore", "WithVo", "Logs"]);
  logs.addRow(["Stella", new Date(Date.UTC(2024, 4, 12)), "Somethin'", "as", "1", "0", "", "Stella (as, vo) ※テスト"]);
  logs.addRow(["Recorda Me", new Date(Date.UTC(2024, 4, 12)), "Somethin'", "-", "0", "0", "", "Recorda (trio)"]);
  logs.addRow(["Blue Monk", new Date(Date.UTC(2024, 4, 13)), "Unten", "pf", "0", "1", "", "Blue Monk (as*2) 🎺"]);
  return wb;
}

describe("extract-excel: フィクスチャ抽出", () => {
  it("songs.csv: has_played(Ready/Done)・in_kurobon1(#1)・Genre・Form・no_chart_ok を正しく生成する", () => {
    const result = extractWorkbook(buildFixture());
    const songs = parseCsv(result.songsCsv);
    const by = (t: string) => songs.find((s) => s.title === t)!;

    // Ready★ → has_played=1, #1■ → in_kurobon1=1, Ballad→バラード
    expect(by("Stella")).toMatchObject({
      has_played: "1",
      in_kurobon1: "1",
      form: "AABA",
      genres: "バラード",
      no_chart_ok: "0", // Stella は NoScore 実績なし
    });
    // Done★ → has_played=1, form special→OTHER(note), Bossa→ボサノバ
    expect(by("Recorda Me")).toMatchObject({
      has_played: "1",
      in_kurobon1: "0",
      form: "OTHER",
      genres: "ボサノバ",
    });
    expect(by("Recorda Me").note).toContain("Form:special");
    // Blues→BLUES12, NoScore 実績あり → no_chart_ok=1, has_played=0（Ready/Done なし）
    expect(by("Blue Monk")).toMatchObject({
      has_played: "0",
      in_kurobon1: "1",
      form: "BLUES12",
      genres: "ブルース",
      no_chart_ok: "1",
    });
    // Waltz→3拍子, form ABAC
    expect(by("Waltz Tune")).toMatchObject({ form: "ABAC", genres: "3拍子", has_played: "1" });
    // 曖昧値 → genres 空 + note に原文 + 警告
    expect(by("Ambiguous").genres).toBe("");
    expect(by("Ambiguous").note).toContain("Genre:Swing or Bossa");
    expect(result.warnings.some((w) => w.includes("Swing or Bossa"))).toBe(true);

    // 既定値
    expect(by("Stella")).toMatchObject({
      is_standard: "0",
      difficulty: "",
      season: "通年",
      listener_level: "3",
      energy_level: "3",
    });
  });

  it("setlists.csv: date+place 集約・PlayedPart 変換・front 編成パース（as*2/trio/空）", () => {
    const result = extractWorkbook(buildFixture());
    const setlists = parseCsv(result.setlistsCsv);
    expect(setlists).toHaveLength(3);

    const stella = setlists.find((s) => s.title === "Stella")!;
    expect(stella).toMatchObject({
      date: "2024-05-12",
      venue_name: "Somethin'",
      order: "1",
      participated: "1",
      instrument: "sax",
      front_instruments: "as|vo", // 絵文字/※注記除去、順序保持
    });

    const recorda = setlists.find((s) => s.title === "Recorda Me")!;
    expect(recorda).toMatchObject({
      order: "2", // 同 date+place で 2 番目
      participated: "0",
      instrument: "",
      front_instruments: "", // trio → 編成なし
    });

    const monk = setlists.find((s) => s.title === "Blue Monk")!;
    expect(monk).toMatchObject({
      date: "2024-05-13",
      venue_name: "Unten",
      participated: "1",
      instrument: "piano", // pf→piano
      no_chart: "1", // NoScore=1
      front_instruments: "as|as", // as*2 → as,as
    });
  });

  it("純関数: parseFrontInstruments / mapGenre の境界", () => {
    expect(parseFrontInstruments("x (as*2)")).toBe("as|as");
    expect(parseFrontInstruments("x (trio)")).toBe("");
    expect(parseFrontInstruments("x (all)")).toBe("");
    expect(parseFrontInstruments("x")).toBe(""); // 括弧なし
    expect(parseFrontInstruments("x (vo, as, ts)")).toBe("vo|as|ts");

    // 未知コードは警告に積む
    const warns: string[] = [];
    expect(parseFrontInstruments("x (as, xyz)", warns)).toBe("as");
    expect(warns.some((w) => w.includes("xyz"))).toBe(true);

    expect(mapGenre("Ballad")).toMatchObject({ genres: ["バラード"] });
    expect(mapGenre("Rhythm Change")).toMatchObject({ genres: ["循環"] });
    expect(mapGenre("Lain").genres).toEqual([]);
  });
});
