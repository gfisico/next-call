# syntax=docker/dockerfile:1

##############################################
# next-call — multi-stage 本番イメージ
#
# builder: better-sqlite3 のネイティブビルドに必要な python3/make/g++ を入れ、
#          Next.js standalone 出力を生成する。
# runner : ビルドツールを含まない slim に standalone 成果物のみを配置する。
#
# 実ビルド検証は本環境（Docker 不可）では行えないため、静的検査は
# scripts/verify-dockerfile.sh が担保する。実ビルドは CI の image ジョブが経路。
##############################################

# ---- builder ----------------------------------------------------------------
# FROM はダイジェスト無しのタグピン留め（node:22-bookworm-slim）。
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 は prebuilt が無い場合にソースからビルドされる。
# python3 / make / g++ が無いと node-gyp が失敗するため明示的に導入する。
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# 依存の解決（lockfile を尊重して再現性を担保）。
COPY package.json package-lock.json ./
RUN npm ci

# アプリ本体をコピーしてビルド。
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Tokyo \
    DATABASE_PATH=/data/next-call.db

# 非 root 実行ユーザー（node:22 イメージ同梱の uid/gid 1000 の node ユーザー）。
# /data はマウント先。所有権を node に与えて SQLite 書き込みを可能にする。
RUN mkdir -p /data && chown -R node:node /data

# standalone 成果物一式。server.js と最小 node_modules（better-sqlite3 の
# ネイティブバイナリ含む）が含まれる。
COPY --from=builder --chown=node:node /app/.next/standalone ./
# 静的アセットと public は standalone に含まれないため個別にコピーする。
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# マイグレーション SQL は standalone に含まれないので明示的に同梱する。
# instrumentation.ts / docker-migrate.mjs は cwd/src/db/migrations を参照する。
COPY --from=builder --chown=node:node /app/src/db/migrations ./src/db/migrations

# drizzle-orm は server.js にバンドルされ standalone/node_modules には残らないため、
# entrypoint の docker-migrate.mjs が解決できるよう明示コピーする（drizzle-orm は
# ランタイム依存ゼロ・better-sqlite3 と bindings は standalone に既に含まれる）。
COPY --from=builder --chown=node:node /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

# 起動時マイグレーション用の純 JS ランナーと entrypoint。
COPY --from=builder --chown=node:node /app/scripts/docker-migrate.mjs ./scripts/docker-migrate.mjs
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER node
EXPOSE 3000
VOLUME ["/data"]

# HEALTHCHECK は slim に curl/wget が無いため node で /api/health を叩く。
# 2xx 以外・接続失敗は非ゼロ終了 → unhealthy。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
