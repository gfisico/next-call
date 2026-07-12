# next-call 運用手順（Xserver VPS）

next-call を Xserver VPS 上に Docker で運用するための手順書。初回セットアップから
デプロイ・ロールバック・バックアップ・リストア・ログ確認までを、人がそのまま実行できる
粒度で記す。ドメイン名・ホスト IP は環境依存のため `<...>` プレースホルダで示す。

- 構成: `app`（Next.js standalone コンテナ・:3000）+ `caddy`（:80/:443 リバースプロキシ・自動 TLS）
- DB: SQLite 単一ファイル `/srv/next-call/data/next-call.db`（ホスト bind mount → コンテナ `/data`）
- イメージ: GitHub Actions が GHCR（`ghcr.io/<owner>/next-call`）へ `:latest` と `:<sha>` を push
- 前提: 単一ユーザー MVP・単一コンテナ（スケーリング対象外）

---

## 0. 前提と全体像

| 項目 | 値 |
| --- | --- |
| デプロイ先 | Xserver VPS（KVM・root 権限・Docker 利用可） |
| 推奨 OS | Ubuntu LTS（22.04 / 24.04） |
| 公開ポート | 22（SSH）/ 80（HTTP→HTTPS リダイレクト）/ 443（HTTPS） |
| アプリディレクトリ | `/srv/next-call/` |
| DB 実体 | `/srv/next-call/data/next-call.db` |
| バックアップ | `/srv/next-call/backup/`（週次 20 世代ローテ） |
| ピン留め | `/srv/next-call/pinned/`（明示削除まで永続） |

デプロイの流れ（`main` push 時・GitHub Actions）:

```
quality (typecheck/lint/test/build)
   └─> image  (docker build → GHCR :latest / :<sha>)
          └─> deploy (SSH → compose pull & up -d → /api/health 60秒リトライ)
```

`deploy` ジョブは **`vars.DEPLOY_ENABLED == 'true'` のときだけ**実行される。未設定なら
`quality` と `image` のみ通り、Secrets 未整備でも CI は赤くならない。

---

## 1. 初回セットアップ

### 1.1 Xserver VPS の準備（管理パネル）

1. VPS を作成し、OS イメージに **Ubuntu LTS** を選択する。
2. **SSH 公開鍵を登録**する（作成時に鍵を指定するか、後から `~/.ssh/authorized_keys` に追記）。
3. **パケットフィルター**で以下を開放する（デフォルトは制限的。閉じたままだと TLS 取得も失敗する）:
   - `22/tcp`（SSH）
   - `80/tcp`（HTTP。Let's Encrypt の HTTP-01 チャレンジに必須）
   - `443/tcp`（HTTPS）
4. ドメインの DNS **A レコード**を VPS のグローバル IP に向ける（例: `next-call.example.com → <VPS_IP>`）。
   TLS 証明書の自動発行は DNS 伝播後に成功する。

### 1.2 ホストのセットアップ（SSH ログイン後）

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh

# sqlite3 CLI（backup.sh / restore.sh の前提。バックアップの整合性検証に使う）
apt-get update && apt-get install -y sqlite3

# ディレクトリ
mkdir -p /srv/next-call/data /srv/next-call/backup /srv/next-call/pinned
cd /srv/next-call
```

### 1.3 リポジトリ資材の配置

`docker-compose.yml` と `Caddyfile` をホストの `/srv/next-call/` に配置する
（git clone するか、当該 2 ファイルを転送する）。

```bash
# 例: リポジトリを clone して必要ファイルをコピー
git clone https://github.com/<owner>/next-call.git /tmp/next-call-src
cp /tmp/next-call-src/docker-compose.yml /tmp/next-call-src/Caddyfile /srv/next-call/
cp /tmp/next-call-src/scripts/backup.sh /tmp/next-call-src/scripts/restore.sh /srv/next-call/
chmod +x /srv/next-call/backup.sh /srv/next-call/restore.sh
```

`docker-compose.yml` の `image:` 既定は `ghcr.io/OWNER/next-call:latest`。**`OWNER` を実際の
GitHub オーナー名（小文字）に置き換える**か、`.env` に `APP_IMAGE=ghcr.io/<owner>/next-call:latest`
を設定する。

### 1.4 環境変数（.env）

リポジトリの `.env.deploy.example` を雛形にして `/srv/next-call/.env` を作成する。

```bash
cp /tmp/next-call-src/.env.deploy.example /srv/next-call/.env
vi /srv/next-call/.env
```

| キー | 説明 |
| --- | --- |
| `DATABASE_PATH` | 通常 `/data/next-call.db` のまま |
| `AUTH_SECRET` | `openssl rand -base64 32` で生成 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google Cloud Console の OAuth クライアント |
| `ALLOWED_EMAILS` | ログイン許可メール（カンマ区切り。未設定は全拒否） |
| `AUTH_URL` | `https://<APP_DOMAIN>`（OAuth コールバックの基点） |
| `TZ` | `Asia/Tokyo`（固定） |
| `APP_DOMAIN` | 公開ドメイン（Caddy が TLS を取る対象） |
| `ACME_EMAIL` | Let's Encrypt 連絡先 |

`.env` は秘匿情報を含む。**コミット禁止**（`.gitignore` / `.dockerignore` で除外済み）。

### 1.5 Google OAuth リダイレクト URI

Google Cloud Console → 該当 OAuth クライアント → 「承認済みのリダイレクト URI」に以下を追加:

```
https://<APP_DOMAIN>/api/auth/callback/google
```

### 1.6 GHCR からの pull 認可

イメージが private の場合、ホストで GHCR にログインしておく（`read:packages` 権限の PAT）:

```bash
echo <GHCR_PAT> | docker login ghcr.io -u <github-user> --password-stdin
```

public パッケージなら不要。

### 1.7 起動

```bash
cd /srv/next-call
docker compose pull
docker compose up -d
docker compose ps
```

TLS 証明書は Caddy が起動時に自動取得する（DNS が VPS を向き 80/443 が開いていること）。
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

`deploy` ジョブは VPS 上で `compose pull && up -d` 後に `https://<APP_DOMAIN>/api/health` を
最大 60 秒（2 秒間隔 × 30 回）リトライし、200 を得られなければ **ジョブを失敗**させ、直近 100 行の
`app` ログを出力する。

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
# 例: ひとつ前の安定コミットへ
APP_IMAGE=ghcr.io/<owner>/next-call:<sha> docker compose up -d app

# ヘルス確認
curl -fsS https://<APP_DOMAIN>/api/health
```

DB マイグレーションは **追加的**（既存を破壊しない）運用のため、イメージを戻すだけで
ロールバックが成立し、DB の巻き戻しは不要。恒久的に戻す場合は `.env` に
`APP_IMAGE=ghcr.io/<owner>/next-call:<sha>` を書いて `docker compose up -d`。

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
# JST で解釈させる（cron 自体のタイムゾーン）
CRON_TZ=Asia/Tokyo
0 4 * * 0 /srv/next-call/backup.sh >> /srv/next-call/backup.log 2>&1
```

生成物: `/srv/next-call/backup/next-call-YYYY-MM-DD.db.gz`

> **運用チェック（通知連携なし MVP）**: 月 1 回、`ls -lt /srv/next-call/backup/` で最新
> バックアップの日付を確認する。cron が失権すると気づけないため、`backup.log` も併せて確認。

### 4.2 ピン留めスナップショット（永続）

リリース前など、ローテーションで消したくない世代を残す:

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
# ピン留めから戻す場合も同様にパスを指定
./restore.sh /srv/next-call/pinned/next-call-2026-07-01-release-v1.db.gz
```

`restore.sh` の手順:

1. `app` コンテナを停止（書き込みを止める）。
2. バックアップを一時領域へ展開。
3. `PRAGMA integrity_check` で健全性を確認（`ok` 以外は中断し**現行 DB を守る**）。
4. 現行 DB を `next-call.db.bak-<timestamp>` に退避してから復元 DB を配置。
5. `app` コンテナを起動。

復元後 `curl -fsS https://<APP_DOMAIN>/api/health` で疎通を確認する。退避した `.bak-*`
は問題なければ手動削除してよい。

---

## 6. ログ確認

```bash
cd /srv/next-call
docker compose ps                 # 稼働状況・health
docker compose logs -f app        # アプリログ（起動時のマイグレーション適用ログ含む）
docker compose logs -f caddy      # アクセスログ・TLS 発行ログ
docker compose logs --tail=200 app
```

`app` の HEALTHCHECK は slim イメージに curl/wget が無いため `node` で `/api/health` を
叩く方式（`docker compose ps` の STATUS が `healthy` になる）。

---

## 7. トラブルシュート早見表

| 症状 | 確認 |
| --- | --- |
| TLS が取得できない | DNS A レコード / パケットフィルター 80・443 / `docker compose logs caddy` |
| ログインできない | `.env` の `AUTH_URL` / Google のリダイレクト URI（§1.5） / `ALLOWED_EMAILS` |
| `/api/health` が 503 | `docker compose logs app`（DB マウント `/srv/next-call/data` の権限） |
| deploy ジョブが動かない | `vars.DEPLOY_ENABLED == 'true'` と Secrets（§2.2） |
| GHCR pull 失敗 | private パッケージは §1.6 の `docker login ghcr.io` |
| バックアップが無い | `crontab -l` / `backup.log` / `sqlite3` インストール済みか |

---

## 8. Docker イメージのローカル検証について

本リポジトリの CI（`image` ジョブ）が `docker build` の実ビルド経路。ローカルに Docker が
無い環境では、`scripts/verify-dockerfile.sh` が Dockerfile の不変条件（ステージ名・FROM の
タグピン留め・`COPY --from=builder` のソース実在・HEALTHCHECK が curl/wget 非依存で
`/api/health` を node で叩く・`next.config` の `output: "standalone"`）を静的に検査する。
`tests/infra/backup-restore.test.ts`（vitest）から自動実行され、バックアップ/リストアの
ローテーション・ピン留め・整合性検証も併せてテストされる。
