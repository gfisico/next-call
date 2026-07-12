/**
 * インフラのシェルスクリプト実行テスト（backup.sh / restore.sh / verify-dockerfile.sh）。
 *
 * Success Criteria 対応:
 *  - backup.sh を 21 回実行 → 週次 20 世代へローテ（最古のみ削除）
 *  - --pin のスナップショットはローテーション対象外で残存
 *  - バックアップは gunzip -t + PRAGMA integrity_check が ok
 *  - restore.sh で復元でき integrity_check ok・現行 DB は .bak 退避
 *  - Dockerfile 静的検査（verify-dockerfile.sh）が通る
 *
 * Docker は本環境で使えないため restore は NEXT_CALL_RESTORE_NO_COMPOSE=1 で
 * compose 停止/起動を省き、ファイル操作と整合性検証のみを検証する。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BACKUP_SH = path.join(REPO_ROOT, "scripts", "backup.sh");
const RESTORE_SH = path.join(REPO_ROOT, "scripts", "restore.sh");
const VERIFY_SH = path.join(REPO_ROOT, "scripts", "verify-dockerfile.sh");

let workdir: string;
let dbPath: string;
let backupDir: string;
let pinnedDir: string;

/** 有効な SQLite DB を作る（テーブル + 1 行）。 */
function createDb(target: string, marker: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run(marker);
  db.close();
}

function runBackup(args: string[], dateStamp?: string): string {
  return execFileSync("bash", [BACKUP_SH, ...args], {
    env: {
      ...process.env,
      NEXT_CALL_DB: dbPath,
      NEXT_CALL_BACKUP_DIR: backupDir,
      NEXT_CALL_PINNED_DIR: pinnedDir,
      NEXT_CALL_BACKUP_KEEP: "20",
      ...(dateStamp ? { NEXT_CALL_BACKUP_DATE: dateStamp } : {}),
    },
    encoding: "utf8",
  });
}

function listBackups(): string[] {
  return fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("next-call-") && f.endsWith(".db.gz"))
    .sort();
}

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "next-call-infra-"));
  dbPath = path.join(workdir, "data", "next-call.db");
  backupDir = path.join(workdir, "backup");
  pinnedDir = path.join(workdir, "pinned");
  createDb(dbPath, "original");
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("verify-dockerfile.sh", () => {
  it("passes the Dockerfile static checks", () => {
    // 非ゼロ終了なら execFileSync が throw する。
    const out = execFileSync("bash", [VERIFY_SH], { encoding: "utf8" });
    expect(out).toContain("Dockerfile static checks passed");
  });
});

describe("backup.sh", () => {
  it("creates a validated, integrity-checked, gunzip-testable backup", () => {
    const out = runBackup([], "2026-01-01");
    expect(out).toContain("integrity_check: ok");
    expect(out).toContain("gunzip -t: ok");

    const files = listBackups();
    expect(files).toEqual(["next-call-2026-01-01.db.gz"]);

    // 外部からも gunzip -t が通ること。
    const gz = path.join(backupDir, files[0]);
    expect(() =>
      execFileSync("gunzip", ["-t", gz], { encoding: "utf8" }),
    ).not.toThrow();

    // 復元した内容が元 DB の行を保持していること。
    const restored = path.join(workdir, "check.db");
    execFileSync("bash", ["-c", `gunzip -c '${gz}' > '${restored}'`]);
    const db = new Database(restored, { readonly: true });
    const row = db.prepare("SELECT v FROM t LIMIT 1").get() as { v: string };
    db.close();
    expect(row.v).toBe("original");
  });

  it("rotates to 20 generations after 21 runs, deleting only the oldest weekly", () => {
    // 21 個の連続した日付で実行（lexical sort = 時系列）。
    const dates: string[] = [];
    for (let i = 1; i <= 21; i++) {
      const d = `2026-01-${String(i).padStart(2, "0")}`;
      dates.push(d);
      runBackup([], d);
    }

    const files = listBackups();
    expect(files.length).toBe(20);
    // 最古（2026-01-01）だけが削除され、2..21 が残る。
    expect(files).not.toContain("next-call-2026-01-01.db.gz");
    expect(files[0]).toBe("next-call-2026-01-02.db.gz");
    expect(files[files.length - 1]).toBe("next-call-2026-01-21.db.gz");
  });

  it("keeps pinned snapshots out of rotation", () => {
    // ピン留めを作成。
    const pinOut = runBackup(["--pin", "release-v1"], "2026-01-01");
    expect(pinOut).toContain("integrity_check: ok");
    const pinnedFiles = fs.readdirSync(pinnedDir);
    expect(pinnedFiles).toEqual(["next-call-2026-01-01-release-v1.db.gz"]);

    // 25 回の週次バックアップを走らせてローテを大きく超えさせる。
    for (let i = 1; i <= 25; i++) {
      runBackup([], `2026-02-${String(i).padStart(2, "0")}`);
    }

    // 週次は 20 に丸められるが、ピン留めは無傷。
    expect(listBackups().length).toBe(20);
    expect(fs.existsSync(path.join(pinnedDir, "next-call-2026-01-01-release-v1.db.gz"))).toBe(true);
  });

  it("fails non-zero when the database is missing", () => {
    fs.rmSync(dbPath, { force: true });
    expect(() => runBackup([], "2026-01-01")).toThrow();
  });
});

describe("restore.sh", () => {
  it("restores from a backup, verifies integrity, and preserves the current DB as .bak", () => {
    // 1) バックアップを作成（内容 marker=original）。
    runBackup([], "2026-03-01");
    const gz = path.join(backupDir, "next-call-2026-03-01.db.gz");

    // 2) 現行 DB を別内容へ書き換える（復元で上書きされる対象）。
    fs.rmSync(dbPath, { force: true });
    createDb(dbPath, "current-changed");

    // 3) restore（compose はスキップ）。
    const out = execFileSync("bash", [RESTORE_SH, gz], {
      env: {
        ...process.env,
        NEXT_CALL_DB: dbPath,
        NEXT_CALL_RESTORE_NO_COMPOSE: "1",
      },
      encoding: "utf8",
    });
    expect(out).toContain("integrity_check: ok");
    expect(out).toContain("restored from");

    // 4) 復元後の DB は backup の内容（original）に戻っている。
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT v FROM t LIMIT 1").get() as { v: string };
    db.close();
    expect(row.v).toBe("original");

    // 5) 現行 DB が .bak-* に退避されている。
    const baks = fs
      .readdirSync(path.dirname(dbPath))
      .filter((f) => f.includes(".bak-"));
    expect(baks.length).toBeGreaterThanOrEqual(1);
  });

  it("aborts (non-zero) on a corrupt archive without touching the current DB", () => {
    const badGz = path.join(backupDir, "corrupt.db.gz");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(badGz, "not a real gzip");
    expect(() =>
      execFileSync("bash", [RESTORE_SH, badGz], {
        env: {
          ...process.env,
          NEXT_CALL_DB: dbPath,
          NEXT_CALL_RESTORE_NO_COMPOSE: "1",
        },
        encoding: "utf8",
      }),
    ).toThrow();
    // 現行 DB は無傷。
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});
