/**
 * 成功基準5（変換ロジックの往復不変）と、ラベル↔コード写像のドリフト検出。
 *
 * 中核は「EditableSong → 表示行(encode) → decode → songs.csv 行 →
 * 実 `songsCsvRowSchema`（@/server/validation/import）で parse」まで通し、
 * ドメイン値が一致することを実証する点。import 側の受理トークンが変われば
 * ここが赤くなる（ミラー写像のドリフト検出）。
 */
import { describe, expect, it } from "vitest";
import { GENRE_TAG_NAMES } from "@/db/seed";
import { songsCsvRowSchema } from "@/server/validation/import";
import {
  COLUMN_LABELS,
  EDITABLE_HEADERS,
  decodeRow,
  songToDisplayRow,
  type EditableSong,
} from "../../scripts/master-mapping";

/** 表示行(header keyed) → {headerIndex, cells}（追加/上書きセルを渡せる） */
function toSheetRow(
  display: Record<string, string>,
  extraHeaders: string[] = [],
): { headerIndex: Record<string, number>; cells: string[] } {
  const headers = [...EDITABLE_HEADERS, ...extraHeaders];
  const cells = headers.map((h) => display[h] ?? "");
  const headerIndex = Object.fromEntries(headers.map((h, i) => [h, i]));
  return { headerIndex, cells };
}

/** EditableSong を encode→decode→parse し、ドメイン値を返す（往復の実証） */
function roundTrip(song: EditableSong) {
  const display = songToDisplayRow(song);
  const { headerIndex, cells } = toSheetRow(display);
  const result = decodeRow(headerIndex, cells, 2);
  expect(result.errors).toEqual([]);
  expect(result.row).toBeDefined();
  return songsCsvRowSchema.parse(result.row);
}

const FULL_SONG: EditableSong = {
  title: "My Funny Valentine",
  key: "Cm",
  form: "AABA",
  composer: "Richard Rodgers",
  hasPlayed: true,
  noChartOk: true,
  isStandard: true,
  difficulty: 4,
  inKurobon1: true,
  season: "SUMMER",
  listenerLevel: 5,
  energyLevel: 2,
  genres: ["バラード", "循環"],
  note: "テスト, メモ\n改行入り",
};

describe("master-mapping: 往復一致（実 songsCsvRowSchema で検証）", () => {
  it("代表曲が encode→decode→parse でドメイン一致する", () => {
    const domain = roundTrip(FULL_SONG);
    expect(domain).toEqual({
      title: "My Funny Valentine",
      songKey: "Cm",
      form: "AABA",
      composer: "Richard Rodgers",
      hasPlayed: true,
      noChartOk: true,
      isStandard: true,
      difficulty: 4,
      inKurobon1: true,
      season: "SUMMER",
      listenerLevel: 5,
      energyLevel: 2,
      genres: ["バラード", "循環"],
      note: "テスト, メモ\n改行入り",
    });
  });

  it("difficulty=null（未設定）は CSV 空→null で往復する", () => {
    const domain = roundTrip({ ...FULL_SONG, difficulty: null });
    expect(domain.difficulty).toBeNull();
  });

  it("nullable テキスト（key/composer/note）空は null で往復する", () => {
    const domain = roundTrip({
      ...FULL_SONG,
      key: null,
      composer: null,
      note: null,
    });
    expect(domain.songKey).toBeNull();
    expect(domain.composer).toBeNull();
    expect(domain.note).toBeNull();
  });

  it("全 form / season コードが往復する", () => {
    const forms = ["AABA", "ABAC", "BLUES12", "OTHER"] as const;
    for (const form of forms) {
      expect(roundTrip({ ...FULL_SONG, form }).form).toBe(form);
    }
    const seasons = ["SPRING", "SUMMER", "AUTUMN", "WINTER", "ALL"] as const;
    for (const season of seasons) {
      expect(roundTrip({ ...FULL_SONG, season }).season).toBe(season);
    }
  });

  it("真偽4項目の false が 0→false で往復する", () => {
    const domain = roundTrip({
      ...FULL_SONG,
      hasPlayed: false,
      noChartOk: false,
      isStandard: false,
      inKurobon1: false,
    });
    expect(domain.hasPlayed).toBe(false);
    expect(domain.noChartOk).toBe(false);
    expect(domain.isStandard).toBe(false);
    expect(domain.inKurobon1).toBe(false);
  });
});

describe("master-mapping: 9ジャンル展開/合成", () => {
  it("GENRE_TAG_NAMES 全9名を展開→合成して往復する", () => {
    const domain = roundTrip({ ...FULL_SONG, genres: [...GENRE_TAG_NAMES] });
    expect(domain.genres).toEqual([...GENRE_TAG_NAMES]);
    expect(domain.genres).toHaveLength(9);
  });

  it("ジャンル未選択は空配列で往復する", () => {
    expect(roundTrip({ ...FULL_SONG, genres: [] }).genres).toEqual([]);
  });

  it("各ジャンルが個別に ✓ 展開される", () => {
    for (const g of GENRE_TAG_NAMES) {
      const display = songToDisplayRow({ ...FULL_SONG, genres: [g] });
      expect(display[g]).toBe("✓");
      expect(roundTrip({ ...FULL_SONG, genres: [g] }).genres).toEqual([g]);
    }
  });
});

describe("master-mapping: 未編集不変", () => {
  it("複数曲を素通しして全フィールドが不変", () => {
    const songs: EditableSong[] = [
      FULL_SONG,
      { ...FULL_SONG, title: "Autumn Leaves", season: "AUTUMN", genres: [] },
      {
        ...FULL_SONG,
        title: "Blue Bossa",
        form: "BLUES12",
        difficulty: null,
        genres: ["ボサノバ", "ブルース"],
      },
    ];
    for (const s of songs) {
      const d = roundTrip(s);
      expect(d.title).toBe(s.title);
      expect(d.form).toBe(s.form);
      expect(d.season).toBe(s.season);
      expect(d.difficulty).toBe(s.difficulty);
      expect(d.genres).toEqual(s.genres);
    }
  });
});

describe("master-mapping: 不正値検出（行番号付き）", () => {
  const base = songToDisplayRow(FULL_SONG);

  it("未知 form ラベルを行番号付きで検出する", () => {
    const display = { ...base, [COLUMN_LABELS.form]: "スイング" };
    const { headerIndex, cells } = toSheetRow(display);
    const res = decodeRow(headerIndex, cells, 7);
    expect(res.row).toBeUndefined();
    expect(res.errors[0].line).toBe(7);
    expect(res.errors[0].reason).toContain("構成");
  });

  it("difficulty=6（範囲外）を検出する", () => {
    const display = { ...base, [COLUMN_LABELS.difficulty]: "6" };
    const { headerIndex, cells } = toSheetRow(display);
    const res = decodeRow(headerIndex, cells, 3);
    expect(res.row).toBeUndefined();
    expect(res.errors.some((e) => e.line === 3 && e.reason.includes("難易度"))).toBe(
      true,
    );
  });

  it("listener_level=0（範囲外）を検出する", () => {
    const display = { ...base, [COLUMN_LABELS.listener_level]: "0" };
    const { headerIndex, cells } = toSheetRow(display);
    const res = decodeRow(headerIndex, cells, 4);
    expect(res.row).toBeUndefined();
    expect(res.errors.some((e) => e.reason.includes("リスナー向け度"))).toBe(true);
  });

  it("未知の真偽値を検出する", () => {
    const display = { ...base, [COLUMN_LABELS.has_played]: "x" };
    const { headerIndex, cells } = toSheetRow(display);
    const res = decodeRow(headerIndex, cells, 5);
    expect(res.row).toBeUndefined();
    expect(res.errors.some((e) => e.reason.includes("演奏経験"))).toBe(true);
  });

  it("未知のジャンル列 header を検出する", () => {
    const display = { ...base, "未知のジャンル": "✓" };
    const { headerIndex, cells } = toSheetRow(display, ["未知のジャンル"]);
    const res = decodeRow(headerIndex, cells, 8);
    expect(res.row).toBeUndefined();
    expect(
      res.errors.some((e) => e.line === 8 && e.reason.includes("未知のジャンル列")),
    ).toBe(true);
  });

  it("曲名（照合キー）の改変を検出する", () => {
    const display = { ...base, [COLUMN_LABELS.title]: "改変されたタイトル" };
    const { headerIndex, cells } = toSheetRow(display);
    const res = decodeRow(headerIndex, cells, 9);
    expect(res.row).toBeUndefined();
    expect(res.errors.some((e) => e.reason.includes("照合キー"))).toBe(true);
  });

  it("複数エラーが1行にまとめて積まれる", () => {
    const display = {
      ...base,
      [COLUMN_LABELS.form]: "スイング",
      [COLUMN_LABELS.difficulty]: "9",
    };
    const { headerIndex, cells } = toSheetRow(display);
    const res = decodeRow(headerIndex, cells, 2);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
    expect(res.errors.every((e) => e.line === 2)).toBe(true);
  });
});
