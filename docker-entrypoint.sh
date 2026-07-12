#!/bin/sh
# next-call コンテナ entrypoint。
# 1) 起動時に生成済みマイグレーション SQL を適用（冪等・追加的運用）。
# 2) その後 CMD（既定は node server.js）へ exec でプロセスを引き継ぐ。
#
# マイグレーションは純 JS ランナー scripts/docker-migrate.mjs で行う。
# アプリ本体の instrumentation.ts も起動時に同じ適用を試みるが、drizzle の
# migrator は適用済みをスキップするため二重でも無害。ここで先に適用しておくと、
# 失敗時にサーバを起動する前に非ゼロ終了でき、原因が切り分けやすい。
set -e

echo "[entrypoint] applying database migrations (DATABASE_PATH=${DATABASE_PATH:-/data/next-call.db})"
node scripts/docker-migrate.mjs

echo "[entrypoint] starting application: $*"
exec "$@"
