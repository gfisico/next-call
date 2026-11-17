#!/bin/bash
# next-call のデプロイ専用のスクリプト。VPS の root の authorized_keys の command= から呼ばれる。
#
# GitHub Actions（.github/workflows/deploy.yml の deploy ジョブ）は、`deploy ghcr.io/gfisico/next-call:<commit SHA>`
# だけを送る。デプロイ用の鍵では、このスクリプトしか動かせない（シェル・ほかのコマンド・ポート転送は使えない）。
# 手順は以前の deploy ジョブの SSH のスクリプトと同じ（イメージの取得 → up -d → /api/health → 古いイメージの削除）。
#
# 限界：送られてきたイメージは root の docker で動く。塞げるのは「鍵で任意のコマンドを打たれる」経路まで。
#
# 配置先: /usr/local/sbin/deploy-next-call（root 所有・755）
# このファイルが元だが、VPS への配置は手作業で行う（デプロイから置き直さない）。手順は docs/ops.md §2.2
#
# authorized_keys の書き方:
#   restrict,command="/usr/local/sbin/deploy-next-call" ssh-ed25519 … next-call-deploy

set -euo pipefail

APP_DIR=/srv/next-call

log() { echo "[deploy] $*"; }

deny() {
  echo "deploy-next-call: 許可されていないコマンドです" >&2
  # CMD は判定に使った値（コマンドなしのログインの試みでは空）。先に200文字に切ってから（長い入力で置き換えに
  # 時間がかからないように）、改行などの制御文字を ? にして記録する。文字の判定は接続元が送るロケールに左右されないよう C で行う
  local LC_ALL=C
  local cmd="${CMD:-}"
  cmd="${cmd:0:200}"
  logger -t deploy-next-call "denied: ${cmd//[^[:print:]]/?}" 2>/dev/null || true
  exit 126
}

# 受け付けるのは `deploy ghcr.io/gfisico/next-call:<40桁の commit SHA>` だけ
CMD="${SSH_ORIGINAL_COMMAND:-}"
[[ "$CMD" =~ ^deploy\ (ghcr\.io/gfisico/next-call:[0-9a-f]{40})$ ]] || deny
export APP_IMAGE="${BASH_REMATCH[1]}"

# 同時に2つ動かさない。待たずにすぐ失敗する
# （待たせると、取り消された古い run が後から鍵を取り、新しい版の上に古いイメージを反映しうるため）
exec 9>/run/deploy-next-call.lock
flock -n 9 || { log "別のデプロイが動いています"; exit 1; }

cd "$APP_DIR"
log "pulling $APP_IMAGE"
docker compose pull app
docker compose up -d

# .env から公開ドメインを取得してヘルスチェック（最大 60 秒リトライ）
APP_DOMAIN="$(grep -E '^APP_DOMAIN=' .env | cut -d= -f2-)"
HEALTH_URL="https://${APP_DOMAIN}/api/health"
log "health check: $HEALTH_URL"
ok=0
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  if [ "$code" = "200" ]; then ok=1; log "healthy after ${i} attempt(s)"; break; fi
  log "attempt ${i}: HTTP ${code} — retrying in 2s"
  sleep 2
done
if [ "$ok" != "1" ]; then
  log "health check FAILED after 60s"
  docker compose logs --tail=100 app
  exit 1
fi

# 未使用の旧イメージを掃除（直前タグはロールバック用に残す）
docker image prune -f
