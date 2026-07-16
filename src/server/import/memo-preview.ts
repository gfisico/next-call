/**
 * メモ一括移行 — プレビュー生成（unit-02 要件7）。**DB 未書込**。
 *
 * parseMemo で構造化したのち、venue / 曲名 / 楽器コードをマスタ突合し、
 * 「解決済み」「要確認（クイック登録候補付き）」「警告」に振り分けた結果を返す。
 * silent に誤取込しないため、未知の楽器コード・未一致曲は needs-review に落とす。
 * 突合ロジックは CSV import の資産（normalizeTitle / rankTitleCandidates）を再利用する。
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { instruments, songs, venues } from "@/db/schema";
import { normalizeTitle } from "@/lib/normalize-title";
import type { DbOrTx } from "@/server/repositories/songs";
import type { TitleCandidate } from "@/server/validation/import";
import { parseMemo, type PlayedInstrument } from "./memo-parse";
import { rankTitleCandidates } from "./preview";

export interface MemoPreviewInstrument {
  code: string;
  count: number;
  /** instruments マスタに存在するか（false = 要確認 / クイック追加候補） */
  known: boolean;
}

export interface MemoPreviewFront {
  code: string;
  known: boolean;
}

export type MemoSongMatch =
  | { kind: "existing"; id: number; title: string; matchType: TitleCandidate["matchType"] }
  | { kind: "new" };

export interface MemoPreviewSong {
  order: number;
  title: string;
  front: MemoPreviewFront[];
  played: boolean;
  instrument: PlayedInstrument;
  calledByMe: boolean;
  beginnerFirst: boolean;
  note: string | null;
  /** マスタ突合結果。exact/normalized 一致は existing、未一致は new */
  songMatch: MemoSongMatch;
  /** 未一致時のクイック登録候補（match/create_stub の判断材料） */
  candidates: TitleCandidate[];
}

export type MemoVenueMatch =
  | { kind: "existing"; id: number }
  | { kind: "new" };

export interface MemoPreviewSession {
  date: string | null;
  venueName: string | null;
  venueMatch: MemoVenueMatch;
  participants: MemoPreviewInstrument[];
  host: { code: string; known: boolean } | null;
  songs: MemoPreviewSong[];
  overallNote: string | null;
  /** 人間の確定が必要な事項（要確認） */
  needsReview: string[];
  /** 情報提示（母店フラグ要確認・日付欠落 等） */
  warnings: string[];
}

export interface MemoPreviewResult {
  sessions: MemoPreviewSession[];
  /** 全セッションで未知だった楽器コード（クイック登録候補） */
  unknownInstrumentCodes: string[];
  /** パーサ由来の警告 */
  warnings: string[];
}

/** 与えられたコード群のうち instruments マスタに存在するものの集合を返す */
function knownCodeSet(dbx: DbOrTx, codes: string[]): Set<string> {
  const unique = [...new Set(codes)].filter((c) => c !== "");
  if (unique.length === 0) return new Set();
  const rows = dbx
    .select({ code: instruments.code })
    .from(instruments)
    .where(inArray(instruments.code, unique))
    .all();
  return new Set(rows.map((r) => r.code));
}

/**
 * 貼付テキストからプレビューを生成する（DB 書込みなし）。
 */
export function previewMemoImport(
  text: string,
  db: Db = getDb(),
): MemoPreviewResult {
  const parsed = parseMemo(text);
  const unknownInstrumentCodes = new Set<string>();

  const sessions: MemoPreviewSession[] = parsed.sessions.map((s) => {
    const needsReview: string[] = [];
    const warnings: string[] = [];

    // --- venue 突合 ---
    let venueMatch: MemoVenueMatch = { kind: "new" };
    if (s.venueName) {
      const v = db
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.name, s.venueName))
        .get();
      if (v) {
        venueMatch = { kind: "existing", id: v.id };
      } else {
        venueMatch = { kind: "new" };
        warnings.push(
          `新規店舗「${s.venueName}」を作成します（母店フラグ要確認: is_home は既定 false）`,
        );
      }
    } else {
      needsReview.push("店名が読み取れません");
    }

    if (s.date === null) {
      needsReview.push("セッション日が読み取れません");
    }

    // --- 楽器コード突合（participants + host + front を一括） ---
    const allCodes = [
      ...s.participants.map((p) => p.code),
      ...(s.hostCode ? [s.hostCode] : []),
      ...s.songs.flatMap((song) => song.front),
    ];
    const known = knownCodeSet(db, allCodes);
    const noteUnknown = (code: string) => {
      if (!known.has(code)) unknownInstrumentCodes.add(code);
    };

    const participants: MemoPreviewInstrument[] = s.participants.map((p) => {
      noteUnknown(p.code);
      const isKnown = known.has(p.code);
      if (!isKnown) {
        needsReview.push(`未知の楽器コード（参加者）: ${p.code}`);
      }
      return { code: p.code, count: p.count, known: isKnown };
    });

    let host: MemoPreviewSession["host"] = null;
    if (s.hostCode) {
      noteUnknown(s.hostCode);
      const isKnown = known.has(s.hostCode);
      if (!isKnown) needsReview.push(`未知の楽器コード（ホスト）: ${s.hostCode}`);
      host = { code: s.hostCode, known: isKnown };
    }

    // --- 曲名突合 ---
    const songTitles: MemoPreviewSong[] = s.songs.map((song) => {
      for (const f of song.front) noteUnknown(f);
      const front: MemoPreviewFront[] = song.front.map((code) => {
        const isKnown = known.has(code);
        if (!isKnown) {
          needsReview.push(
            `未知の楽器コード（フロント編成・${song.order}曲目）: ${code}`,
          );
        }
        return { code, known: isKnown };
      });

      const normalized = normalizeTitle(song.title);
      const match = db
        .select({ id: songs.id, title: songs.title })
        .from(songs)
        .where(eq(songs.titleNormalized, normalized))
        .get();

      let songMatch: MemoSongMatch;
      let candidates: TitleCandidate[] = [];
      if (match) {
        songMatch = {
          kind: "existing",
          id: match.id,
          title: match.title,
          matchType: "normalized",
        };
      } else {
        songMatch = { kind: "new" };
        candidates = rankTitleCandidates(db, song.title);
        needsReview.push(`未一致曲（${song.order}曲目）: ${song.title}`);
      }

      if (song.beginnerFirst) {
        needsReview.push(`初（🔰）の曲: ${song.title}（記録方法を確認）`);
      }

      return {
        order: song.order,
        title: song.title,
        front,
        played: song.played,
        instrument: song.instrument,
        calledByMe: song.calledByMe,
        beginnerFirst: song.beginnerFirst,
        note: song.note,
        songMatch,
        candidates,
      };
    });

    return {
      date: s.date,
      venueName: s.venueName,
      venueMatch,
      participants,
      host,
      songs: songTitles,
      overallNote: s.overallNote,
      needsReview,
      warnings,
    };
  });

  return {
    sessions,
    unknownInstrumentCodes: [...unknownInstrumentCodes],
    warnings: parsed.warnings,
  };
}
