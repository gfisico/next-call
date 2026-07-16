/**
 * メモパーサ（純関数）のユニットテスト（unit-02 Success Criteria #4）。
 * DB 不要。intent.md「移行対象メモのサンプル形式」を 16 曲まで具体化した固定
 * フィクスチャで、日付/店/パート人数/ホスト/各曲(編成・記号・注記)/全体メモへの
 * 分解と、記号（🎷🎹👆🔰）・フロント編成・※注記の扱いを検証する。
 */
import { describe, expect, it } from "vitest";
import { parseMemo } from "@/server/import/memo-parse";

/** 池袋・16 曲の固定フィクスチャ（サンプルの 3 曲 + 記号/編成/注記の網羅） */
const SAMPLE_MEMO = `2026/5/9 池袋
tp1, as1, g4, pf2, b3, ds3
・メインパートで記載
・ホストはpf
・🎷🎹:演奏、👆:曲指定、🔰:初
・()内: フロント編成

1. Stella By Starlight (tp, g, g) ※pfなし
2. I'll Be Seeing You (g)
3. Autumn Leaves (as) 🎷
4. Take Five (ts) 🎷👆
5. So What (tp, as) 🎹
6. Blue Bossa (as) 🎷🔰
7. All The Things You Are (g, g)
8. Fly Me To The Moon (vo, g) 👆
9. Someday My Prince Will Come (as) 🎷
10. There Is No Greater Love (tp)
11. Nardis (as, g) 🎷 ※Key=Dm
12. Beautiful Love (g)
13. Days Of Wine And Roses (as) 🎷👆
14. Giant Steps (as, g) 🎷🔰 ※Key=C
15. Solar (tp, g) 🎹👆 ※pfあり ※テンポ速め
16. Bye Bye Blackbird (as) 🎷

🖋️Giant Stepsを初めてやった
`;

describe("parseMemo — 池袋 16 曲サンプル", () => {
  const result = parseMemo(SAMPLE_MEMO);

  it("1 セッションに分解される（空行では区切らない）", () => {
    expect(result.sessions).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  const s = result.sessions[0];

  it("ヘッダ: 日付を ISO 化・店名を抽出", () => {
    expect(s.date).toBe("2026-05-09");
    expect(s.venueName).toBe("池袋");
  });

  it("パート別人数を code+count に分解（リスナー含めない）", () => {
    expect(s.participants).toEqual([
      { code: "tp", count: 1 },
      { code: "as", count: 1 },
      { code: "g", count: 4 },
      { code: "pf", count: 2 },
      { code: "b", count: 3 },
      { code: "ds", count: 3 },
    ]);
  });

  it("ホストのパートを抽出", () => {
    expect(s.hostCode).toBe("pf");
  });

  it("凡例行を rawLegendLines に保持（解釈しない）", () => {
    expect(s.rawLegendLines).toHaveLength(4);
    expect(s.rawLegendLines[0]).toContain("メインパート");
  });

  it("全体メモ（🖋️）を抽出", () => {
    expect(s.overallNote).toBe("Giant Stepsを初めてやった");
  });

  it("16 曲を order 昇順で保持", () => {
    expect(s.songs).toHaveLength(16);
    expect(s.songs.map((x) => x.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("曲1: フロント編成の重複順序保持・※注記・記号なし", () => {
    expect(s.songs[0]).toMatchObject({
      order: 1,
      title: "Stella By Starlight",
      front: ["tp", "g", "g"],
      played: false,
      instrument: "NONE",
      calledByMe: false,
      beginnerFirst: false,
      note: "pfなし",
    });
  });

  it("曲2: 編成のみ・注記/記号なし", () => {
    expect(s.songs[1]).toMatchObject({
      title: "I'll Be Seeing You",
      front: ["g"],
      played: false,
      note: null,
    });
  });

  it("曲3: 🎷 → SAX 演奏", () => {
    expect(s.songs[2]).toMatchObject({
      title: "Autumn Leaves",
      played: true,
      instrument: "SAX",
      calledByMe: false,
    });
  });

  it("曲4: 🎷👆 → SAX + calledByMe", () => {
    expect(s.songs[3]).toMatchObject({
      title: "Take Five",
      played: true,
      instrument: "SAX",
      calledByMe: true,
    });
  });

  it("曲5: 🎹 → PIANO 演奏", () => {
    expect(s.songs[4]).toMatchObject({
      title: "So What",
      front: ["tp", "as"],
      played: true,
      instrument: "PIANO",
    });
  });

  it("曲6: 🎷🔰 → SAX + beginnerFirst", () => {
    expect(s.songs[5]).toMatchObject({
      title: "Blue Bossa",
      instrument: "SAX",
      beginnerFirst: true,
    });
  });

  it("曲8: 👆 のみ（演奏なし・calledByMe）", () => {
    expect(s.songs[7]).toMatchObject({
      title: "Fly Me To The Moon",
      front: ["vo", "g"],
      played: false,
      instrument: "NONE",
      calledByMe: true,
    });
  });

  it("曲11: 🎷 + ※Key=Dm", () => {
    expect(s.songs[10]).toMatchObject({
      title: "Nardis",
      instrument: "SAX",
      note: "Key=Dm",
    });
  });

  it("曲14: 🎷🔰 + ※Key=C（サンプル該当行）", () => {
    expect(s.songs[13]).toMatchObject({
      order: 14,
      title: "Giant Steps",
      front: ["as", "g"],
      played: true,
      instrument: "SAX",
      beginnerFirst: true,
      note: "Key=C",
    });
  });

  it("曲15: 🎹👆 + 複数 ※注記を連結", () => {
    expect(s.songs[14]).toMatchObject({
      title: "Solar",
      instrument: "PIANO",
      calledByMe: true,
      note: "pfあり テンポ速め",
    });
  });
});

describe("parseMemo — 複数セッション・分割と警告", () => {
  it("日付行の出現で新セッションに分割する", () => {
    const memo = `2026/5/9 池袋
tp1, as1

1. Misty (as) 🎷

2026/5/10 新宿
tp2

1. Body And Soul (ts)
`;
    const r = parseMemo(memo);
    expect(r.sessions).toHaveLength(2);
    expect(r.sessions[0].venueName).toBe("池袋");
    expect(r.sessions[1].venueName).toBe("新宿");
    expect(r.sessions[1].participants).toEqual([{ code: "tp", count: 2 }]);
    expect(r.sessions[1].songs[0].title).toBe("Body And Soul");
  });

  it("無効な日付は date=null + warning", () => {
    const r = parseMemo("2026/13/40 どこか\n1. Misty (as)\n");
    expect(r.sessions[0].date).toBeNull();
    expect(r.warnings.some((w) => w.includes("無効な日付"))).toBe(true);
  });

  it("店名のない日付行は venueName=null + warning", () => {
    const r = parseMemo("2026/5/9\n1. Misty (as)\n");
    expect(r.sessions[0].date).toBe("2026-05-09");
    expect(r.sessions[0].venueName).toBeNull();
    expect(r.warnings.some((w) => w.includes("店名"))).toBe(true);
  });
});
