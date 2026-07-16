/**
 * メモ一括移行 — 貼付テキストの純関数パーサ（unit-02 要件7）
 *
 * DB 非依存の純関数。照合（Song/Venue/Instrument のマスタ突合）は行わず、
 * テキストを構造化するだけに徹する（照合は memo-preview.ts の責務）。
 * これにより DB 不要でユニットテストが回る（Success Criteria #4）。
 *
 * 入力メモ形式（intent.md「移行対象メモのサンプル形式」が唯一の情報源）:
 *   2026/5/9 池袋                         ← ヘッダ（日付 + 店名）
 *   tp1, as1, g4, pf2, b3, ds3            ← パート別人数（code+数）
 *   ・メインパートで記載                   ← 凡例（無視）
 *   ・ホストはpf                          ← ホストのパート
 *   ・🎷🎹:演奏、👆:曲指定、🔰:初          ← 凡例（無視）
 *   ・()内: フロント編成                   ← 凡例（無視）
 *
 *   1. Stella By Starlight (tp, g, g) ※pfなし   ← 曲行（順・曲名・編成・記号・注記）
 *   14. Giant Steps (as, g) 🎷🔰 ※Key=C
 *
 *   🖋️Giant Stepsを初めてやった            ← 全体メモ
 *
 * 記号（Unicode 厳密一致）:
 *   🎷 U+1F3B7 = SAX 演奏 / 🎹 U+1F3B9 = PIANO 演奏 / 👆 U+1F446 = 自分がコール
 *   🔰 U+1F530 = 初（beginner-first。フラグとして保持し preview で提示）
 *
 * ブロック分割方針: **日付行の出現**（`^\d{4}/\d{1,2}/\d{1,2}`）で新セッション開始。
 * セッション内の空行は区切りではなく読み飛ばす（サンプルは凡例と曲行の間・曲行と
 * 全体メモの間に空行を含むが 1 セッション）。日付行より前に本文がある場合のみ
 * 「暗黙の 1 セッション」として扱う。
 */

/** 記号（サロゲートペア。string 比較で厳密一致する） */
const SYM_SAX = "\u{1F3B7}"; // 🎷
const SYM_PIANO = "\u{1F3B9}"; // 🎹
const SYM_CALLED = "\u{1F446}"; // 👆
const SYM_BEGINNER = "\u{1F530}"; // 🔰
const SYM_PEN = "\u{1F58B}"; // 🖋 (U+1F58B、異体字セレクタ付き 🖋️ にも前方一致)

const DATE_LINE = /^\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\b/;
const HEADER_LINE = /^\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(.+?)\s*$/;
const SONG_LINE = /^\s*(\d+)\.\s*(.+?)\s*$/;
const PART_TOKEN = /^([A-Za-z]+)(\d+)$/;

export type PlayedInstrument = "SAX" | "PIANO" | "NONE";

export interface ParsedMemoSong {
  /** 曲順（メモの `N.` の N） */
  order: number;
  /** 曲名（編成・記号・注記を除去し trim） */
  title: string;
  /** フロント編成（`(...)` 内。順序・同一楽器の重複を保持） */
  front: string[];
  /** 🎷 か 🎹 があれば true（自分が演奏で参加） */
  played: boolean;
  /** 🎷→SAX / 🎹→PIANO / 無→NONE（両方あれば SAX 優先） */
  instrument: PlayedInstrument;
  /** 👆（自分がコールした曲） */
  calledByMe: boolean;
  /** 🔰（初。フラグとして保持し preview で提示） */
  beginnerFirst: boolean;
  /** ※注記（複数 ※ は連結）。無ければ null */
  note: string | null;
}

export interface ParsedMemoSession {
  /** ISO date（"2026/5/9" → "2026-05-09"）。欠落/無効は null + warning */
  date: string | null;
  /** 店名（ヘッダの日付の右側）。欠落は null */
  venueName: string | null;
  /** パート別人数（tp1,as1,... を分解。リスナーは含めない） */
  participants: { code: string; count: number }[];
  /** ホストのパート（"ホストはpf" → "pf"）。無ければ null */
  hostCode: string | null;
  /** 曲行（order 昇順・記載順のまま） */
  songs: ParsedMemoSong[];
  /** 🖋️ 全体メモ。無ければ null */
  overallNote: string | null;
  /** 凡例行（`・...`。解釈せず保持のみ） */
  rawLegendLines: string[];
}

export interface ParsedMemo {
  sessions: ParsedMemoSession[];
  /** 分解できなかった/曖昧な行の警告（silent に捨てない） */
  warnings: string[];
}

/** 全角/半角の空白・スペースを畳んで trim */
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** "2026/5/9" → "2026-05-09"。実在しない日付は null */
function toIsoDate(y: string, mo: string, d: string): string | null {
  const yy = Number(y);
  const mm = Number(mo);
  const dd = Number(d);
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (
    dt.getUTCFullYear() !== yy ||
    dt.getUTCMonth() !== mm - 1 ||
    dt.getUTCDate() !== dd
  ) {
    return null;
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${yy}-${p(mm)}-${p(dd)}`;
}

/** 全記号を除去した文字列を返す */
function stripSymbols(s: string): string {
  return s
    .split(SYM_SAX)
    .join("")
    .split(SYM_PIANO)
    .join("")
    .split(SYM_CALLED)
    .join("")
    .split(SYM_BEGINNER)
    .join("");
}

/** 曲行の右側（`N.` を除いた本体）を分解する */
function parseSongBody(order: number, body: string): ParsedMemoSong {
  // 1) フロント編成: 最初の () / （）を抽出
  let front: string[] = [];
  const paren = /[（(]([^）)]*)[）)]/.exec(body);
  if (paren) {
    front = paren[1]
      .split(/[,、]/)
      .map((t) => tidy(t))
      .filter((t) => t !== "");
  }

  // 2) 記号フラグ
  const played = body.includes(SYM_SAX) || body.includes(SYM_PIANO);
  const instrument: PlayedInstrument = body.includes(SYM_SAX)
    ? "SAX"
    : body.includes(SYM_PIANO)
      ? "PIANO"
      : "NONE";
  const calledByMe = body.includes(SYM_CALLED);
  const beginnerFirst = body.includes(SYM_BEGINNER);

  // 3) 注記（※... を全て。複数は連結）
  const noteSegments = [...body.matchAll(/※\s*([^※]+)/g)].map((m) =>
    tidy(m[1]),
  );
  const note = noteSegments.length > 0 ? noteSegments.join(" ") : null;

  // 4) 曲名 = 本体から (編成) と ※以降と記号を除いた残り
  let title = body;
  if (paren) title = title.replace(paren[0], " ");
  const hazamaIdx = title.indexOf("※");
  if (hazamaIdx >= 0) title = title.slice(0, hazamaIdx);
  title = tidy(stripSymbols(title));

  return { order, title, front, played, instrument, calledByMe, beginnerFirst, note };
}

function emptySession(): ParsedMemoSession {
  return {
    date: null,
    venueName: null,
    participants: [],
    hostCode: null,
    songs: [],
    overallNote: null,
    rawLegendLines: [],
  };
}

/**
 * メモテキストを構造化する（純関数）。
 */
export function parseMemo(text: string): ParsedMemo {
  const warnings: string[] = [];
  const sessions: ParsedMemoSession[] = [];
  let current: ParsedMemoSession | null = null;

  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (line === "") continue; // セッション内の空行は読み飛ばす

    // --- 日付行 → 新セッション開始 ---
    if (DATE_LINE.test(line)) {
      current = emptySession();
      sessions.push(current);
      const h = HEADER_LINE.exec(line);
      if (h) {
        const iso = toIsoDate(h[1], h[2], h[3]);
        current.date = iso;
        current.venueName = tidy(h[4]) || null;
        if (iso === null) {
          warnings.push(`無効な日付です: "${line}"`);
        }
      } else {
        // 日付のみ（店名なし）
        const d = DATE_LINE.exec(line);
        if (d) {
          const iso = toIsoDate(d[1], d[2], d[3]);
          current.date = iso;
          if (iso === null) warnings.push(`無効な日付です: "${line}"`);
        }
        warnings.push(`店名が読み取れません: "${line}"`);
      }
      continue;
    }

    // 日付行より前に本文が出た場合は暗黙の 1 セッションを開始
    if (!current) {
      current = emptySession();
      sessions.push(current);
      warnings.push(`日付ヘッダより前に本文が現れました: "${line}"`);
    }

    // --- 全体メモ（🖋️） ---
    if (line.startsWith(SYM_PEN)) {
      const rest = line.slice(SYM_PEN.length).replace(/^️/, "");
      current.overallNote = tidy(rest) || null;
      continue;
    }

    // --- 曲行（N. ...） ---
    const song = SONG_LINE.exec(line);
    if (song) {
      current.songs.push(parseSongBody(Number(song[1]), song[2]));
      continue;
    }

    // --- ホスト行（"ホストは<code>"。凡例 `・` 付きも許容） ---
    const host = /ホストは\s*([A-Za-z]+)/.exec(line);
    if (host) {
      current.hostCode = host[1];
      // 凡例形式の行はそのまま legend にも保持（原文の可視化用）
      if (line.startsWith("・")) current.rawLegendLines.push(line);
      continue;
    }

    // --- 凡例行（・...） ---
    if (line.startsWith("・")) {
      current.rawLegendLines.push(line);
      continue;
    }

    // --- パート別人数行（code+数 のカンマ区切り） ---
    const tokens = line
      .split(/[,、]/)
      .map((t) => tidy(t))
      .filter((t) => t !== "");
    if (tokens.length > 0 && tokens.every((t) => PART_TOKEN.test(t))) {
      for (const t of tokens) {
        const m = PART_TOKEN.exec(t) as RegExpExecArray;
        current.participants.push({ code: m[1], count: Number(m[2]) });
      }
      continue;
    }

    // --- 未分類 ---
    warnings.push(`分解できない行をスキップしました: "${line}"`);
  }

  return { sessions, warnings };
}
