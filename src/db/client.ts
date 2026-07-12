/**
 * SQLite クライアント（better-sqlite3 + Drizzle）
 *
 * - DATABASE_PATH の読み取りは遅延（lazy singleton）。import 時には接続しない。
 *   これにより next build やテストが DB なしで通る。
 * - WAL + busy_timeout を設定（単一書き込みプロセス前提の排他対策）。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: Db;
}

/** 開発時の既定パス。 本番はコンテナの volume（/data/next-call.db）を DATABASE_PATH で指定する */
const DEFAULT_DATABASE_PATH = "./data/next-call.db";

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;
}

/**
 * 指定パスの SQLite を開く純ファクトリ（テストからは一時ファイルパスで直接利用する）
 */
export function openDatabase(dbPath: string): DatabaseHandle {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

let handle: DatabaseHandle | null = null;

/** アプリ共有のシングルトン接続（初回アクセス時に DATABASE_PATH で開く） */
export function getDatabase(): DatabaseHandle {
  if (!handle) {
    handle = openDatabase(getDatabasePath());
  }
  return handle;
}

export function getDb(): Db {
  return getDatabase().db;
}

export function getSqlite(): Database.Database {
  return getDatabase().sqlite;
}
