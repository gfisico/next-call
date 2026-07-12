#!/usr/bin/env bash
#
# Dockerfile 静的検査。
# 本環境では `docker build` の実ビルド検証ができないため、ビルドが成立する
# ために満たすべき不変条件を静的に確認する（実ビルドは CI の image ジョブが経路）。
#
# 検査項目:
#   - FROM がタグピン留め（node:22-bookworm-slim）で :latest を使っていない
#   - builder / runner の 2 ステージが存在する
#   - COPY --from=builder のソースパスがリポジトリに実在する
#   - HEALTHCHECK が存在し curl/wget に依存しない（node で叩く）
#   - next.config に output: "standalone" がある
#
# 失敗が 1 件でもあれば非ゼロ終了。

set -euo pipefail

# リポジトリルート（このスクリプトの 2 階層上）。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCKERFILE="${ROOT}/Dockerfile"
NEXT_CONFIG="${ROOT}/next.config.ts"

errors=0
pass() { echo "[verify] PASS: $*"; }
err()  { echo "[verify] FAIL: $*" >&2; errors=$(( errors + 1 )); }

[ -f "$DOCKERFILE" ] || { echo "[verify] FAIL: Dockerfile not found" >&2; exit 1; }

# --- FROM ピン留め ----------------------------------------------------------
if grep -Eq '^FROM[[:space:]]+node:22-bookworm-slim[[:space:]]+AS[[:space:]]+builder' "$DOCKERFILE"; then
  pass "builder stage pinned to node:22-bookworm-slim"
else
  err "builder stage must be 'FROM node:22-bookworm-slim AS builder'"
fi

if grep -Eq '^FROM[[:space:]]+node:22-bookworm-slim[[:space:]]+AS[[:space:]]+runner' "$DOCKERFILE"; then
  pass "runner stage pinned to node:22-bookworm-slim"
else
  err "runner stage must be 'FROM node:22-bookworm-slim AS runner'"
fi

if grep -Eq 'FROM[[:space:]]+[^[:space:]]*:latest' "$DOCKERFILE"; then
  err "no image may use the :latest tag"
else
  pass "no :latest base image"
fi

# --- COPY --from=builder のソースパス実在確認 -------------------------------
# COPY --from=builder 行から '/app/<path>' を抽出しリポジトリ相対で存在チェック。
while IFS= read -r src; do
  rel="${src#/app/}"
  # .next/ 配下は builder ステージで生成されるビルド成果物であり、
  # リポジトリには存在しない（gitignore）。実在チェックの対象外とする。
  case "$rel" in
    .next/*) pass "COPY build artifact (generated in builder stage): ${rel}"; continue ;;
  esac
  if [ -e "${ROOT}/${rel}" ]; then
    pass "COPY source exists: ${rel}"
  else
    err "COPY --from=builder source missing in repo: ${rel}"
  fi
done < <(grep -E '^COPY --from=builder' "$DOCKERFILE" \
          | grep -Eo '/app/[^[:space:]]+' | sort -u)

# --- entrypoint スクリプト（COPY --chown ... docker-entrypoint.sh）の実在 ----
if [ -e "${ROOT}/docker-entrypoint.sh" ]; then
  pass "COPY source exists: docker-entrypoint.sh"
else
  err "docker-entrypoint.sh missing in repo"
fi

# --- HEALTHCHECK ------------------------------------------------------------
if grep -Eq '^HEALTHCHECK' "$DOCKERFILE"; then
  pass "HEALTHCHECK present"
  # curl / wget に依存していないこと（slim には無い）。node で叩くこと。
  # 実ディレクティブ行 + 続く CMD 行のみを対象にする（コメント行は除外）。
  hc_line="$(grep -E '^HEALTHCHECK' -A1 "$DOCKERFILE" | tr '\n' ' ')"
  if echo "$hc_line" | grep -Eq '\bcurl\b|\bwget\b'; then
    err "HEALTHCHECK must not depend on curl/wget (slim image lacks them)"
  else
    pass "HEALTHCHECK does not use curl/wget"
  fi
  if echo "$hc_line" | grep -Eq '\bnode\b'; then
    pass "HEALTHCHECK uses node"
  else
    err "HEALTHCHECK should use node to probe /api/health"
  fi
  if echo "$hc_line" | grep -q '/api/health'; then
    pass "HEALTHCHECK probes /api/health"
  else
    err "HEALTHCHECK should probe /api/health"
  fi
else
  err "HEALTHCHECK missing"
fi

# --- next.config standalone -------------------------------------------------
if [ -f "$NEXT_CONFIG" ] && grep -Eq 'output:[[:space:]]*"standalone"' "$NEXT_CONFIG"; then
  pass "next.config sets output: \"standalone\""
else
  err "next.config.ts must set output: \"standalone\""
fi

echo "[verify] ${errors} error(s)"
[ "$errors" -eq 0 ] || exit 1
echo "[verify] Dockerfile static checks passed"
