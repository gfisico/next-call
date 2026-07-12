/**
 * ImportJob（CSV インポート中間状態）の永続化（unit-08）
 *
 * parsedRows / errors / unknowns / resolutions は JSON 文字列列。
 * 本モジュールがシリアライズ/デシリアライズの唯一の窓口。
 */
import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { importJobs } from "@/db/schema";
import { conflict, notFound } from "@/server/http/errors";
import type {
  ErrorRow,
  ParsedRow,
  ResolutionsInput,
  SetlistUnknowns,
} from "@/server/validation/import";
import type { DbOrTx } from "./songs";

export type ImportJobRow = typeof importJobs.$inferSelect;
export type ImportType = "songs" | "setlists";
export type ImportStatus = "PREVIEW" | "COMMITTED" | "DISCARDED";

/** 未知要素の JSON: songs は空オブジェクト、setlists は SetlistUnknowns */
export type Unknowns = Record<string, never> | SetlistUnknowns;

const nowIso = () => new Date().toISOString();

export interface CreateJobInput {
  type: ImportType;
  parsedRows: ParsedRow<unknown>[];
  errors: ErrorRow[];
  unknowns: Unknowns;
}

/** PREVIEW ジョブを作成する */
export function createJob(input: CreateJobInput, dbx: DbOrTx = getDb()): ImportJobRow {
  return dbx
    .insert(importJobs)
    .values({
      type: input.type,
      status: "PREVIEW",
      parsedRows: JSON.stringify(input.parsedRows),
      errors: JSON.stringify(input.errors),
      unknowns: JSON.stringify(input.unknowns),
    })
    .returning()
    .get();
}

export function getJobOrThrow(id: number, dbx: DbOrTx = getDb()): ImportJobRow {
  const row = dbx.select().from(importJobs).where(eq(importJobs.id, id)).get();
  if (!row) throw notFound(`インポートジョブが見つかりません: id=${id}`);
  return row;
}

/** PREVIEW でなければ 409（コミット済み/破棄済みは操作不可） */
export function assertPreview(job: ImportJobRow): void {
  if (job.status !== "PREVIEW") {
    throw conflict(
      `このジョブは既に ${job.status} です（PREVIEW 状態のみ操作できます）`,
      { status: job.status },
    );
  }
}

/** 解決内容を保存する（PREVIEW のみ） */
export function saveResolutions(
  id: number,
  resolutions: ResolutionsInput,
  db: Db = getDb(),
): ImportJobRow {
  return db.transaction((tx) => {
    const job = getJobOrThrow(id, tx);
    assertPreview(job);
    return tx
      .update(importJobs)
      .set({ resolutions: JSON.stringify(resolutions), updatedAt: nowIso() })
      .where(eq(importJobs.id, id))
      .returning()
      .get();
  });
}

/** ステータスを更新する（tx 内から呼べる） */
export function markStatus(
  id: number,
  status: ImportStatus,
  dbx: DbOrTx = getDb(),
): void {
  dbx
    .update(importJobs)
    .set({ status, updatedAt: nowIso() })
    .where(eq(importJobs.id, id))
    .run();
}

// --- JSON 列のデシリアライズヘルパ ------------------------------------------

export function parsedRowsOf<T>(job: ImportJobRow): ParsedRow<T>[] {
  return JSON.parse(job.parsedRows) as ParsedRow<T>[];
}

export function errorsOf(job: ImportJobRow): ErrorRow[] {
  return JSON.parse(job.errors) as ErrorRow[];
}

export function unknownsOf(job: ImportJobRow): Unknowns {
  return JSON.parse(job.unknowns) as Unknowns;
}

export function resolutionsOf(job: ImportJobRow): ResolutionsInput | null {
  if (job.resolutions == null) return null;
  return JSON.parse(job.resolutions) as ResolutionsInput;
}
