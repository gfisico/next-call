#!/usr/bin/env bash
#
# next-call SQLite リストア。
#
#   scripts/restore.sh <backup-file.db.gz>
#
# 手順:
#   1) app コンテナを停止（書き込みを止めてから差し替える）。
#   2) バックアップを一時領域へ展開。
#   3) PRAGMA integrity_check で健全性を確認（ok 以外は中断＝現行 DB を守る）。
#   4) 現行 DB を .bak-<timestamp> に退避してから展開済み DB を配置。
#   5) app コンテナを起動。
#
# パスは env で上書き可能（テスト・別環境向け）:
#   NEXT_CALL_DB              配置先 DB（既定 /srv/next-call/data/next-call.db）
#   NEXT_CALL_COMPOSE_DIR    docker compose 実行ディレクトリ（既定 /srv/next-call）
#   NEXT_CALL_RESTORE_NO_COMPOSE  1 なら compose 停止/起動を省略（テスト用）

set -euo pipefail

DB="${NEXT_CALL_DB:-/srv/next-call/data/next-call.db}"
COMPOSE_DIR="${NEXT_CALL_COMPOSE_DIR:-/srv/next-call}"
NO_COMPOSE="${NEXT_CALL_RESTORE_NO_COMPOSE:-0}"

log() { echo "[restore] $*"; }
fail() { echo "[restore][ERROR] $*" >&2; exit 1; }

SRC="${1:-}"
[ -n "$SRC" ] || fail "usage: restore.sh <backup-file.db.gz>"
[ -f "$SRC" ] || fail "backup file not found: $SRC"
command -v sqlite3 >/dev/null 2>&1 || fail "sqlite3 CLI not found (apt install sqlite3)"
command -v gunzip >/dev/null 2>&1 || fail "gunzip not found"

compose() {
  [ "$NO_COMPOSE" = "1" ] && { log "skip compose $* (NO_COMPOSE=1)"; return 0; }
  ( cd "$COMPOSE_DIR" && docker compose "$@" )
}

# --- 1) app 停止 ------------------------------------------------------------
log "stopping app container"
compose stop app || fail "failed to stop app"

# --- 2) 展開 ----------------------------------------------------------------
TMP_DB="$(mktemp)"
cleanup() { rm -f "$TMP_DB"; }
trap cleanup EXIT

log "extracting $SRC"
gunzip -t "$SRC" || fail "gunzip -t failed (corrupt archive): $SRC"
gunzip -c "$SRC" > "$TMP_DB" || fail "failed to decompress $SRC"

# --- 3) 整合性チェック ------------------------------------------------------
INTEGRITY="$(sqlite3 "$TMP_DB" 'PRAGMA integrity_check;' || true)"
if [ "$INTEGRITY" != "ok" ]; then
  fail "integrity_check failed on restored data: $INTEGRITY (current DB left untouched)"
fi
log "integrity_check: ok"

# --- 4) 現行退避 + 配置 -----------------------------------------------------
mkdir -p "$(dirname "$DB")"
if [ -f "$DB" ]; then
  BAK="${DB}.bak-$(date +%Y%m%d-%H%M%S)"
  log "moving current DB aside: $BAK"
  mv "$DB" "$BAK"
  # WAL/SHM の名残も退避（あれば）。復元 DB は単一ファイルで整合済み。
  [ -f "${DB}-wal" ] && mv "${DB}-wal" "${BAK}-wal" || true
  [ -f "${DB}-shm" ] && mv "${DB}-shm" "${BAK}-shm" || true
fi
cp "$TMP_DB" "$DB"
log "restored DB placed at $DB"

# --- 5) app 起動 ------------------------------------------------------------
log "starting app container"
compose up -d app || fail "failed to start app"

log "done — restored from $SRC"
