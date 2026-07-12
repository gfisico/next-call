#!/usr/bin/env bash
#
# next-call SQLite バックアップ（ホスト cron から実行）。
#
#   scripts/backup.sh            # 週次バックアップ + 20世代ローテ
#   scripts/backup.sh --pin      # ピン留めスナップショット（ローテ対象外・永続）
#   scripts/backup.sh --pin note # ラベル付きピン留め（ファイル名に -note が付く）
#
# 手順:
#   1) sqlite3 の .backup で稼働中 DB を安全にオンラインコピー（cp は破損リスク）。
#   2) gzip 圧縮して backup/（または --pin 時は pinned/）へ保存。
#   3) 検証: gunzip -t と PRAGMA integrity_check（ok 以外は失敗）。
#   4) 通常モードのみ: 週次 20 世代を超えた最古のバックアップを削除。
#      --pin のファイルは pinned/ に置かれローテーション対象外＝明示 rm まで永続。
#
# 失敗時は非ゼロ終了しログを残す（cron 経由でも原因が追える）。
#
# パスは env で上書き可能（テスト・別環境向け）:
#   NEXT_CALL_DB          対象 DB（既定 /srv/next-call/data/next-call.db）
#   NEXT_CALL_BACKUP_DIR  週次バックアップ先（既定 /srv/next-call/backup）
#   NEXT_CALL_PINNED_DIR  ピン留め先（既定 /srv/next-call/pinned）
#   NEXT_CALL_BACKUP_KEEP 保持世代数（既定 20）
#   NEXT_CALL_BACKUP_DATE ファイル名の日付（既定 date +%F。テストの決定化用）

set -euo pipefail

DB="${NEXT_CALL_DB:-/srv/next-call/data/next-call.db}"
BACKUP_DIR="${NEXT_CALL_BACKUP_DIR:-/srv/next-call/backup}"
PINNED_DIR="${NEXT_CALL_PINNED_DIR:-/srv/next-call/pinned}"
KEEP="${NEXT_CALL_BACKUP_KEEP:-20}"
STAMP="${NEXT_CALL_BACKUP_DATE:-$(date +%F)}"

log() { echo "[backup] $*"; }
fail() { echo "[backup][ERROR] $*" >&2; exit 1; }

# --- 引数解析 ---------------------------------------------------------------
PIN=0
LABEL=""
case "${1:-}" in
  --pin)
    PIN=1
    LABEL="${2:-}"
    ;;
  "")
    ;;
  *)
    fail "unknown argument: $1 (use: no args | --pin [label])"
    ;;
esac

command -v sqlite3 >/dev/null 2>&1 || fail "sqlite3 CLI not found (apt install sqlite3)"
command -v gzip >/dev/null 2>&1 || fail "gzip not found"
[ -f "$DB" ] || fail "database not found: $DB"

# --- 出力先とファイル名 ------------------------------------------------------
if [ "$PIN" = "1" ]; then
  DEST_DIR="$PINNED_DIR"
  if [ -n "$LABEL" ]; then
    # ラベルはファイル名に安全な文字へ正規化。
    SAFE_LABEL="$(printf '%s' "$LABEL" | tr -c 'A-Za-z0-9._-' '-')"
    BASENAME="next-call-${STAMP}-${SAFE_LABEL}.db.gz"
  else
    BASENAME="next-call-${STAMP}.db.gz"
  fi
else
  DEST_DIR="$BACKUP_DIR"
  BASENAME="next-call-${STAMP}.db.gz"
fi

mkdir -p "$DEST_DIR"
DEST="${DEST_DIR}/${BASENAME}"

# --- バックアップ作成（一時ファイル経由でアトミックに） ----------------------
TMP_DB="$(mktemp)"
TMP_GZ="$(mktemp)"
cleanup() { rm -f "$TMP_DB" "$TMP_GZ"; }
trap cleanup EXIT

log "backing up $DB -> $DEST"
sqlite3 "$DB" ".backup '$TMP_DB'" || fail "sqlite3 .backup failed"

# --- 検証(1): integrity_check を圧縮前の生コピーで実行 -----------------------
INTEGRITY="$(sqlite3 "$TMP_DB" 'PRAGMA integrity_check;' || true)"
if [ "$INTEGRITY" != "ok" ]; then
  fail "integrity_check failed: $INTEGRITY"
fi
log "integrity_check: ok"

# --- 圧縮 -------------------------------------------------------------------
gzip -c "$TMP_DB" > "$TMP_GZ" || fail "gzip failed"

# --- 検証(2): gunzip -t で圧縮ファイルの健全性 ------------------------------
gunzip -t "$TMP_GZ" || fail "gunzip -t failed (corrupt archive)"
log "gunzip -t: ok"

# 検証済みアーカイブを最終配置へアトミック移動。
mv "$TMP_GZ" "$DEST"
log "wrote $DEST"

# --- ローテーション（通常モードのみ・pinned は対象外） -----------------------
if [ "$PIN" = "0" ]; then
  # next-call-YYYY-MM-DD.db.gz は名前が時系列＝lexical sort で並ぶ。
  # 新しい順に KEEP 件残し、それより古いものを削除する。
  # bash 3.2（macOS 既定）でも動くよう mapfile を使わず配列を組み立てる。
  FILES=()
  while IFS= read -r f; do
    [ -n "$f" ] && FILES+=("$f")
  done < <(ls -1 "${BACKUP_DIR}"/next-call-*.db.gz 2>/dev/null | sort)
  COUNT="${#FILES[@]}"
  if [ "$COUNT" -gt "$KEEP" ]; then
    REMOVE=$(( COUNT - KEEP ))
    log "rotating: ${COUNT} backups, keep ${KEEP}, remove ${REMOVE} oldest"
    i=0
    while [ "$i" -lt "$REMOVE" ]; do
      log "removing old backup: ${FILES[$i]}"
      rm -f "${FILES[$i]}"
      i=$(( i + 1 ))
    done
  else
    log "rotation: ${COUNT} backups (<= ${KEEP}), nothing to remove"
  fi
fi

log "done"
