/**
 * CSV パース + プレビュー生成（unit-08 Task 3）
 *
 * multipart で受け取った CSV テキストを行単位で zod 検証し、有効行 / エラー行に
 * 振り分けたうえで ImportJob(PREVIEW) を作成する。エラー行があっても有効行の
 * プレビューは継続する（成功基準3）。
 *
 * setlists では「未知 venue」「マスター未一致 title（近似候補付き）」を収集し、
 * プレビュー画面での区分確定・曲名解決に供する（成功基準4）。
 */
import { parse } from "csv-parse/sync";
import { eq, inArray, like } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { songs, venues } from "@/db/schema";
import { normalizeTitle } from "@/lib/normalize-title";
import { validationError } from "@/server/http/errors";
import {
  createJob,
  type ImportType,
  type Unknowns,
} from "@/server/repositories/import-jobs";
import type { DbOrTx } from "@/server/repositories/songs";
import {
  MAX_ROWS,
  SETLISTS_CSV_HEADERS,
  SONGS_CSV_HEADERS,
  setlistsCsvRowSchema,
  songsCsvRowSchema,
  type ErrorRow,
  type ParsedRow,
  type SetlistsCsvRow,
  type SetlistUnknowns,
  type SongsCsvRow,
  type TitleCandidate,
} from "@/server/validation/import";

export interface PreviewResult {
  job: { id: number; type: ImportType; status: string };
  totalRows: number;
  validRows: number;
  errors: ErrorRow[];
  unknowns: Unknowns;
}

/** LIKE のワイルドカード（% _）を無害化する（近似候補用途なので厳密性は不要） */
function neutralizeLike(s: string): string {
  return s.replace(/[%_]/g, " ");
}

/**
 * マスター未一致 title の近似候補を最大 limit 件返す。
 * 順序: (1)完全一致（raw title 一致）→(2)正規化一致→(3)部分一致（正規化 substring）。
 * songId で重複除去し、上の優先度順に先頭 limit 件を採る。
 */
export function rankTitleCandidates(
  dbx: DbOrTx,
  csvTitle: string,
  limit = 3,
): TitleCandidate[] {
  const normalized = normalizeTitle(csvTitle);
  const seen = new Set<number>();
  const out: TitleCandidate[] = [];
  const push = (
    rows: Array<{ id: number; title: string }>,
    matchType: TitleCandidate["matchType"],
  ) => {
    for (const r of rows) {
      if (seen.has(r.id) || out.length >= limit) continue;
      seen.add(r.id);
      out.push({ songId: r.id, title: r.title, matchType });
    }
  };

  // (1) 完全一致（原文）
  push(
    dbx
      .select({ id: songs.id, title: songs.title })
      .from(songs)
      .where(eq(songs.title, csvTitle))
      .all(),
    "exact",
  );
  // (2) 正規化一致
  if (out.length < limit) {
    push(
      dbx
        .select({ id: songs.id, title: songs.title })
        .from(songs)
        .where(eq(songs.titleNormalized, normalized))
        .all(),
      "normalized",
    );
  }
  // (3) 部分一致（正規化 substring）
  if (out.length < limit && normalized !== "") {
    push(
      dbx
        .select({ id: songs.id, title: songs.title })
        .from(songs)
        .where(like(songs.titleNormalized, `%${neutralizeLike(normalized)}%`))
        .limit(limit * 4)
        .all(),
      "partial",
    );
  }
  return out.slice(0, limit);
}

/** CSV テキストを行配列（ヘッダ + データ）にパースする */
function parseCsv(csvText: string): string[][] {
  let records: string[][];
  try {
    records = parse(csvText, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as string[][];
  } catch {
    throw validationError("CSV の解析に失敗しました（形式を確認してください）");
  }
  return records;
}

/**
 * ヘッダを検証し、必須列の欠落があれば 400。
 * 余分な列は無視する（前方互換のため）。front_instruments は setlists の任意追加列。
 */
function validateHeader(type: ImportType, header: string[]): void {
  const required =
    type === "songs"
      ? SONGS_CSV_HEADERS
      : SETLISTS_CSV_HEADERS.filter((h) => h !== "front_instruments");
  const missing = required.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    throw validationError(
      `CSV ヘッダに必須列がありません: ${missing.join(", ")}`,
      { missing },
    );
  }
}

/** 未知 venue と未一致 title（近似候補付き）を有効行から収集する */
function collectSetlistUnknowns(
  dbx: DbOrTx,
  rows: SetlistsCsvRow[],
): SetlistUnknowns {
  // --- 未知 venue ---
  const venueNames = [...new Set(rows.map((r) => r.venueName))];
  const knownVenues =
    venueNames.length === 0
      ? []
      : dbx
          .select({ name: venues.name })
          .from(venues)
          .where(inArray(venues.name, venueNames))
          .all();
  const knownVenueSet = new Set(knownVenues.map((v) => v.name));
  const unknownVenues = venueNames.filter((n) => !knownVenueSet.has(n));

  // --- マスター未一致 title（normalizeTitle で突合） ---
  const titleByNormalized = new Map<string, string>(); // normalized -> 代表 csvTitle
  for (const r of rows) {
    const n = normalizeTitle(r.title);
    if (!titleByNormalized.has(n)) titleByNormalized.set(n, r.title);
  }
  const normalizedList = [...titleByNormalized.keys()];
  const matched =
    normalizedList.length === 0
      ? []
      : dbx
          .select({ tn: songs.titleNormalized })
          .from(songs)
          .where(inArray(songs.titleNormalized, normalizedList))
          .all();
  const matchedSet = new Set(matched.map((m) => m.tn));

  const unknownTitles: SetlistUnknowns["titles"] = [];
  for (const [normalized, csvTitle] of titleByNormalized) {
    if (matchedSet.has(normalized)) continue; // 自動 match されるので解決不要
    unknownTitles.push({
      csvTitle,
      candidates: rankTitleCandidates(dbx, csvTitle),
    });
  }

  return { venues: unknownVenues, titles: unknownTitles };
}

/**
 * CSV テキストからプレビュー（ImportJob PREVIEW）を生成する。
 */
export function previewImport(
  type: ImportType,
  csvText: string,
  db: Db = getDb(),
): PreviewResult {
  const records = parseCsv(csvText);
  if (records.length === 0) {
    throw validationError("CSV が空です（ヘッダ行がありません）");
  }
  const header = records[0].map((h) => h.trim());
  validateHeader(type, header);

  const dataRows = records.slice(1);
  if (dataRows.length > MAX_ROWS) {
    throw validationError(
      `行数が上限（${MAX_ROWS} 行）を超えています: ${dataRows.length} 行`,
      { maxRows: MAX_ROWS, rows: dataRows.length },
    );
  }

  const schema = type === "songs" ? songsCsvRowSchema : setlistsCsvRowSchema;
  const validRows: ParsedRow<SongsCsvRow | SetlistsCsvRow>[] = [];
  const errors: ErrorRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i];
    const raw: Record<string, string> = {};
    header.forEach((h, idx) => {
      raw[h] = cells[idx] ?? "";
    });
    const line = i + 2; // ヘッダを 1 行目とした 1 始まり行番号
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      validRows.push({ line, data: parsed.data });
    } else {
      errors.push({
        line,
        reason: parsed.error.issues.map((iss) => iss.message).join("; "),
        raw,
      });
    }
  }

  const unknowns: Unknowns =
    type === "setlists"
      ? collectSetlistUnknowns(
          db,
          validRows.map((r) => r.data as SetlistsCsvRow),
        )
      : ({} as Unknowns);

  const job = createJob(
    { type, parsedRows: validRows, errors, unknowns },
    db,
  );

  return {
    job: { id: job.id, type, status: job.status },
    totalRows: dataRows.length,
    validRows: validRows.length,
    errors,
    unknowns,
  };
}
