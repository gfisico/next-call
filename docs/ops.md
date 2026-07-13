# next-call 運用手順（Xserver VPS・既存 nginx 統合方式）

next-call を Xserver VPS 上に Docker で運用するための手順書。初回セットアップから
デプロイ・ロールバック・バックアップ・リストア・ログ確認までを、人がそのまま実行できる
粒度で記す。ドメイン名・ホスト IP は環境依存のため `<...>` プレースホルダで示す。

**この VPS は複数サイトを相乗り運用する共有サーバーである**（ホストの nginx が 80/443 を
専有し、pm2 等で複数アプリを配信している）。そのため next-call は **Caddy を使わず、
既存 nginx にリバースプロキシ 1 サイトを追加する形**で載せる。

- 構成: `app`（Next.js standalone コンテナ・`127.0.0.1:3003` に公開）
- 前段: ホストの **nginx** が `next-call.kamiya.to` を `127.0.0.1:3003` へリバースプロキシ
- TLS: ホストの **certbot（Let's Encrypt）** が証明書を管理（既存サイトと同方式）
- DB: SQLite 単一ファイル `/srv/next-call/data/next-call.db`（ホスト bind mount → コンテナ `/data`）
- イメージ: GitHub Actions が GHCR（`ghcr.io/gfisico/next-call`）へ `:latest` と `:<sha>` を push
- 前提: 単一ユーザー MVP・単一コンテナ（スケーリング対象外）

---

## 0. 前提と全体像

| 項目 | 値 |
| --- | --- |
| デプロイ先 | Xserver VPS（KVM・root 権限・Docker/compose 導入済み） |
| OS | Ubuntu LTS |
| 公開ポート | 22（SSH）/ 80・443（**ホスト nginx が使用**） |
| アプリディレクトリ | `/srv/next-call/` |
| app 公開ポート | `127.0.0.1:3003`（localhost のみ。nginx が受ける） |
| DB 実体 | `/srv/next-call/data/next-call.db`（**所有者 1000:1000**＝コンテナの node ユーザー） |
| バックアップ | `/srv/next-call/backup/`（週次 20 世代ローテ） |
| ピン留め | `/srv/next-call/pinned/`（明示削除まで永続） |
| nginx サイト設定 | `/etc/nginx/sites-available/next-call`（`sites-enabled` へ symlink） |
| 証明書 | `/etc/letsencrypt/live/next-call.kamiya.to/`（certbot 管理・自動更新） |

デプロイの流れ（`main` push 時・GitHub Actions）:

```
quality (typecheck/lint/test/build)
   └─> image  (docker build → GHCR :latest / :<sha>)
          └─> deploy (SSH → cd /srv/next-call && compose pull app && up -d → /api/health 60秒リトライ)
```

`deploy` ジョブは **`vars.DEPLOY_ENABLED == 'true'` のときだけ**実行される。未設定なら
`quality` と `image` のみ通り、Secrets 未整備でも CI は赤くならない。**deploy ジョブは
VPS 上に既に配置された `docker-compose.yml` をそのまま使う**（リポジトリから compose を
上書きコピーしない）。したがって VPS 側 compose を nginx 統合方式にしておけば、以降の
自動デプロイはその構成で動作する。

---

## 1. 初回セットアップ

### 1.1 Xserver VPS の準備（管理パネル）

1. VPS を作成し、OS イメージに **Ubuntu LTS** を選択する。
2. **SSH 公開鍵を登録**する。
3. **パケットフィルター**で `22/tcp`・`80/tcp`・`443/tcp` を開放する
   （80 は Let's Encrypt の HTTP-01 チャレンジに必須）。
4. ドメインの DNS **A レコード**を VPS のグローバル IP に向ける
   （例: `next-call.kamiya.to → <VPS_IP>`）。`dig +short next-call.kamiya.to` で確認できる。

### 1.2 ホストのセットアップ（SSH ログイン後・root）

```bash
# Docker Engine + compose plugin（未導入の場合のみ）
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

# sqlite3 CLI（backup.sh / restore.sh の前提。整合性検証に使う）
apt-get update && apt-get install -y sqlite3

# ディレクトリ
mkdir -p /srv/next-call/data /srv/next-call/backup /srv/next-call/pinned
```

> **注意（既存の壊れた APT リポジトリ）**: 無関係な PPA が原因で `apt-get update` が
> エラーになる場合は、当該リポジトリを一時無効化してから sqlite3 を入れる
> （例: `mv /etc/apt/sources.list.d/<壊れたPPA>.sources{,.disabled}`）。

### 1.3 リポジトリ資材の配置

`docker-compose.yml` と バックアップスクリプトをホストの `/srv/next-call/` に配置する。
**Caddyfile は不要**（nginx 統合方式では使わない）。

```bash
# ローカルからの転送（例）
scp docker-compose.yml scripts/backup.sh scripts/restore.sh <user>@<VPS_IP>:/srv/next-call/
# もしくは VPS 上で git clone して該当ファイルをコピー
ssh <user>@<VPS_IP> 'chmod +x /srv/next-call/backup.sh /srv/next-call/restore.sh'
```

compose の `image:` 既定は `ghcr.io/gfisico/next-call:latest`。オーナーが異なる場合は
`.env` に `APP_IMAGE=ghcr.io/<owner>/next-call:latest` を設定する。

### 1.4 環境変数（.env）

リポジトリの `.env.deploy.example` を雛形にして `/srv/next-call/.env` を作成する（`umask 077`）。

| キー | 説明 |
| --- | --- |
| `DATABASE_PATH` | 通常 `/data/next-call.db` のまま |
| `AUTH_SECRET` | `openssl rand -base64 32` で生成 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google Cloud Console の OAuth クライアント |
| `ALLOWED_EMAILS` | ログイン許可メール（カンマ区切り。未設定は全拒否） |
| `AUTH_URL` | `https://<APP_DOMAIN>`（OAuth コールバックの基点） |
| `TZ` | `Asia/Tokyo`（固定） |
| `APP_DOMAIN` | 公開ドメイン |
| `ACME_EMAIL` | Let's Encrypt 連絡先（certbot 実行時にも使う） |
| `APP_IMAGE` | 通常は未設定。ロールバック時のみ `ghcr.io/gfisico/next-call:<sha>` |

`.env` は秘匿情報を含む。**コミット禁止**（`.gitignore` / `.dockerignore` で除外済み）。

### 1.5 Google OAuth リダイレクト URI

Google Cloud Console → 該当 OAuth クライアント → 「承認済みのリダイレクト URI」に追加:

```
https://<APP_DOMAIN>/api/auth/callback/google
```

OAuth 同意画面の「テストユーザー」に、ログインするメール（`ALLOWED_EMAILS` の各アドレス）を
追加すること（Testing モードのまま運用可・公開申請不要）。

### 1.6 DB ディレクトリの所有権（重要）

コンテナは非 root の `node`（uid:gid = 1000:1000）で動く。bind mount 元のホスト
ディレクトリが root 所有だと `SQLITE_CANTOPEN` で起動ループする。**必ず 1000:1000 に合わせる**:

```bash
chown -R 1000:1000 /srv/next-call/data
```

### 1.7 app コンテナの起動

```bash
cd /srv/next-call
docker compose pull
docker compose up -d
# health が healthy になり、localhost で 200 が返ることを確認
curl -fsS http://127.0.0.1:3003/api/health   # => {"status":"ok","db":"ok"}
```

GHCR パッケージが private の場合のみ、先に `docker login ghcr.io`（`read:packages` の PAT）が必要。
public なら不要。

### 1.8 nginx サイト追加 + TLS 取得

既存サイト（`todo` 等）と同型の server ブロックを作り、`127.0.0.1:3003` へプロキシする。

`/etc/nginx/sites-available/next-call`（まず HTTP のみ。certbot が後で 443 化する）:

```nginx
server {
    listen 80;
    server_name <APP_DOMAIN>;

    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -sf /etc/nginx/sites-available/next-call /etc/nginx/sites-enabled/next-call
nginx -t                       # 既存サイト含め構文検証（必ず成功を確認）
systemctl reload nginx

# 新ドメインのみ対象に TLS 取得（既存サイトの設定は触らない）
certbot --nginx -d <APP_DOMAIN> --non-interactive --agree-tos -m <ACME_EMAIL> --redirect
```

certbot が `next-call` の設定を 443 対応に書き換え、80→443 リダイレクトを追加する。
`https://<APP_DOMAIN>/api/health` が `{"status":"ok","db":"ok"}` を返せば成功。

---

## 2. GitHub Actions（CI/CD）の設定

### 2.1 ワークフロー

- `.github/workflows/ci.yml`: PR と（main 以外への）push で `quality` を実行。
- `.github/workflows/deploy.yml`: `main` への push で `quality → image → deploy`。

### 2.2 Secrets / Variables

リポジトリ設定 → Secrets and variables → Actions:

**Variables**
| 名前 | 値 | 用途 |
| --- | --- | --- |
| `DEPLOY_ENABLED` | `true` | これが `true` のときだけ `deploy` ジョブが動く |

**Secrets**
| 名前 | 用途 |
| --- | --- |
| `VPS_HOST` | VPS のホスト名 / IP |
| `VPS_USER` | SSH ユーザー |
| `VPS_SSH_KEY` | SSH 秘密鍵（改行含む全文） |

`DEPLOY_ENABLED` 未設定・Secrets 未整備でも `quality` と `image` は通る（フォーク安全）。
GHCR への push は `GITHUB_TOKEN` を使うため追加 Secret 不要。

### 2.3 デプロイ監視

`main` に push 後、Actions の `deploy` ワークフローを監視する:

```bash
gh run watch "$(gh run list --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

`deploy` ジョブは VPS 上で `docker compose pull app && up -d` 後に
`https://<APP_DOMAIN>/api/health` を最大 60 秒（2 秒間隔 × 30 回）リトライし、200 を
得られなければ **ジョブを失敗**させる。VPS 上の compose をそのまま使うため、compose を
変更した場合は VPS 側の `/srv/next-call/docker-compose.yml` も更新すること。

---

## 3. デプロイ / ロールバック

### 3.1 通常デプロイ

`main` への push で自動実行される（§2.3 で監視）。手動で行う場合:

```bash
cd /srv/next-call
docker compose pull app
docker compose up -d
```

### 3.2 ロールバック（特定 SHA へ戻す）

イメージは `:<sha>` タグで GHCR に残る。戻したいコミットの SHA を指定して再起動する。

```bash
cd /srv/next-call
APP_IMAGE=ghcr.io/gfisico/next-call:<sha> docker compose up -d app
curl -fsS https://<APP_DOMAIN>/api/health
```

DB マイグレーションは **追加的**（既存を破壊しない）運用のため、イメージを戻すだけで
ロールバックが成立し、DB の巻き戻しは不要。恒久的に戻す場合は `.env` に
`APP_IMAGE=ghcr.io/gfisico/next-call:<sha>` を書いて `docker compose up -d`。

> マイグレーションはコンテナ起動時に `docker-entrypoint.sh` → `scripts/docker-migrate.mjs`
> が適用する（アプリの instrumentation でも二重に適用されるが drizzle が適用済みを
> スキップするため冪等）。

---

## 4. バックアップ

### 4.1 週次バックアップ + 20 世代ローテ

`scripts/backup.sh` を**ホスト cron** から実行する。対象は**ホストパス**の DB 実体
（`/srv/next-call/data/next-call.db`）で、稼働中でも安全な `sqlite3 .backup` API を使う
（`cp` は破損リスクがあるため使わない）。作成後に `gunzip -t` と `PRAGMA integrity_check`
で検証し、失敗すれば非ゼロ終了する。週次 20 世代を超えた最古のみ削除する。

cron 登録（例: 毎週日曜 04:00 JST）:

```bash
crontab -e
```

```cron
CRON_TZ=Asia/Tokyo
0 4 * * 0 /srv/next-call/backup.sh >> /srv/next-call/backup.log 2>&1
```

生成物: `/srv/next-call/backup/next-call-YYYY-MM-DD.db.gz`

> **運用チェック（通知連携なし MVP）**: 月 1 回、`ls -lt /srv/next-call/backup/` で最新
> バックアップの日付を確認する。`backup.log` も併せて確認。

### 4.2 ピン留めスナップショット（永続）

```bash
/srv/next-call/backup.sh --pin              # /srv/next-call/pinned/next-call-YYYY-MM-DD.db.gz
/srv/next-call/backup.sh --pin release-v1   # ...-release-v1.db.gz
```

`pinned/` のファイルは**ローテーション対象外**で、手動で `rm` するまで永続保持される。

---

## 5. リストア

```bash
cd /srv/next-call
./restore.sh /srv/next-call/backup/next-call-2026-07-06.db.gz
./restore.sh /srv/next-call/pinned/next-call-2026-07-01-release-v1.db.gz
```

`restore.sh` の手順:

1. `app` コンテナを停止（書き込みを止める）。
2. バックアップを一時領域へ展開。
3. `PRAGMA integrity_check` で健全性を確認（`ok` 以外は中断し**現行 DB を守る**）。
4. 現行 DB を `next-call.db.bak-<timestamp>` に退避してから復元 DB を配置。
5. `app` コンテナを起動。

復元後 `curl -fsS https://<APP_DOMAIN>/api/health` で疎通を確認する。復元 DB を配置する際は
所有者が 1000:1000 であること（§1.6）。退避した `.bak-*` は問題なければ手動削除してよい。

---

## 6. ログ確認

```bash
cd /srv/next-call
docker compose ps                 # 稼働状況・health
docker compose logs -f app        # アプリログ（起動時のマイグレーション適用ログ含む）
docker compose logs --tail=200 app

# nginx（前段リバースプロキシ）のログ
tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

`app` の HEALTHCHECK は slim イメージに curl/wget が無いため `node` で `/api/health` を
叩く方式（`docker compose ps` の STATUS が `healthy` になる）。

---

## 7. トラブルシュート早見表

| 症状 | 確認 |
| --- | --- |
| `SQLITE_CANTOPEN` で起動ループ | `/srv/next-call/data` の所有者が 1000:1000 か（§1.6） |
| TLS が取得できない | DNS A レコード / パケットフィルター 80・443 / `nginx -t` / certbot ログ |
| ログインできない | `.env` の `AUTH_URL` / Google のリダイレクト URI（§1.5） / テストユーザー / `ALLOWED_EMAILS` |
| `/api/health` が 503 | `docker compose logs app`（DB マウント `/srv/next-call/data` の権限） |
| 502/504（nginx） | app コンテナが healthy か / `curl http://127.0.0.1:3003/api/health` / `nginx -t` |
| deploy ジョブが動かない | `vars.DEPLOY_ENABLED == 'true'` と Secrets（§2.2） |
| GHCR pull 失敗 | private パッケージは `docker login ghcr.io`（read:packages PAT） |
| バックアップが無い | `crontab -l` / `backup.log` / `sqlite3` インストール済みか |

---

## 8. Docker イメージのローカル検証について

本リポジトリの CI（`image` ジョブ）が `docker build` の実ビルド経路。ローカルに Docker が
無い環境では、`scripts/verify-dockerfile.sh` が Dockerfile の不変条件（ステージ名・FROM の
タグピン留め・`COPY --from=builder` のソース実在〔`.next/*` はビルド成果物のため対象外〕・
HEALTHCHECK が curl/wget 非依存で `/api/health` を node で叩く・`next.config` の
`output: "standalone"`）を静的に検査する。`tests/infra/backup-restore.test.ts`（vitest）から
自動実行され、バックアップ/リストアのローテーション・ピン留め・整合性検証も併せてテストされる。
