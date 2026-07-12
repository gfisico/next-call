---
status: pending
last_updated: ""
depends_on: [unit-01-app-foundation]
branch: ai-dlc/next-call-mvp/09-infra-deploy
discipline: infrastructure
pass: ""
workflow: ""
ticket: ""
design_ref: ""
views: []
deployment:
  target: docker
  artifacts: [Dockerfile, docker-compose, caddyfile, github-actions]
  environments: [production]
monitoring:
  metrics: []
  dashboards: []
  alerts: []
  slos: []
operations:
  runbooks: [docs/ops.md]
  rollback: "GHCRの直前タグ（:sha）を compose で指定して up -d。DBは追加的マイグレーションのため巻き戻し不要"
  scaling: "単一ユーザー・単一コンテナ。スケーリング対象外"
---

# unit-09-infra-deploy

## Description
next-call をVPSで運用するためのインフラ一式を実装する: multi-stage Dockerfile、docker compose（app + Caddy）、GitHub Actions CI/CD（品質→イメージ→デプロイ）、**週次バックアップ20世代+ピン留めスナップショット（明示削除まで永続）**、運用ドキュメント。discovery.md「Deployment Architecture」を基本設計とし、バックアップ方針のみアライメントゲート決定で上書きする。

## Discipline
infrastructure - This unit will be executed by general-purpose agents with IaC/provisioning context.

## Domain Entities
なし（アプリのドメインには触れない）。対象はビルド成果物・コンテナ・SQLiteファイル（/data/next-call.db）・バックアップファイル。

## Data Sources
- リポジトリ: Dockerfile, docker-compose.yml, Caddyfile, .github/workflows/deploy.yml, scripts/backup.sh, docs/ops.md
- VPS側: /srv/next-call/{data,backup,pinned}/ ディレクトリ、.env（DATABASE_PATH, AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, ALLOWED_EMAILS, AUTH_URL, TZ=Asia/Tokyo）。TZ は compose の environment でコンテナに渡す（unit-01 の日付規定=JST に対応）
- GitHub Secrets: VPS_SSH_KEY / VPS_HOST / VPS_USER（GHCRはGITHUB_TOKEN）

## Technical Specification

1. **Dockerfile**（multi-stage）: build stage は node:22-bookworm-slim + python3/make/g++（better-sqlite3 のネイティブビルド）、実行 stage は slim + Next.js standalone 出力のみ。entrypoint で 生成済みマイグレーションSQLの適用 → node server.js。HEALTHCHECK は /api/health
2. **docker-compose.yml**: app（:3000、volume /srv/next-call/data:/data）+ Caddy（:80/:443、Caddyfile で {domain} → app:3000 のリバースプロキシ+TLS自動）。restart: unless-stopped
3. **GitHub Actions**（.github/workflows/deploy.yml）:
   - job quality: npm ci → lint → typecheck → test → build（品質ゲートと同一コマンド）
   - job image (needs quality): docker build → push ghcr.io/{owner}/next-call:latest と :\${{ github.sha }}
   - job deploy (needs image): SSH で VPS へ → docker compose pull && up -d → https://{domain}/api/health を最大60秒リトライで確認、失敗時はジョブ失敗
   - main への push のみで発火。PR では quality のみ実行する ci.yml を分離
4. **バックアップ（アライメントゲート確定仕様）**:
   - `scripts/backup.sh`: **ホスト cron から実行**する。対象は**ホストパス** `/srv/next-call/data/next-call.db`（コンテナ内 /data のbind mount元）。**ホストにインストールした sqlite3 CLI**（`apt install sqlite3`。docs/ops.md のセットアップ手順に追加）で `sqlite3 /srv/next-call/data/next-call.db ".backup"` → gzip → /srv/next-call/backup/next-call-YYYY-MM-DD.db.gz
   - **週次実行**（VPS の cron、例: 日曜 04:00）。**20世代を超えた最古の週次バックアップのみ削除**
   - **ピン留めスナップショット**: `scripts/backup.sh --pin [label]` で /srv/next-call/pinned/next-call-YYYY-MM-DD[-label].db.gz に保存。**ローテーション対象外＝明示的に rm するまで永続保持**
   - リストア手順: `scripts/restore.sh <backup-file>`（app停止→展開→整合性チェック(PRAGMA integrity_check)→配置→app起動）
   - バックアップ検証: backup.sh は作成後に gunzip -t と integrity_check を実行し、失敗時は非ゼロ終了+ログ
5. **運用ドキュメント**（docs/ops.md）: 初回セットアップ手順（VPS要件、.env、compose 起動、Google OAuth リダイレクトURI設定、**ホストへの sqlite3 CLI インストール（`apt install sqlite3`。backup.sh の前提）**、cron登録）、デプロイ・ロールバック手順（:sha タグ指定）、バックアップ/ピン留め/リストア手順、ログ確認（docker compose logs）
6. **VPS固有値の扱い**: デプロイ先は **Xserver VPS**（ユーザー確定。KVM・root権限・Docker利用可）。OSは Ubuntu LTS を推奨。docs/ops.md に Xserver VPS 固有の手順を含める: 管理パネルの**パケットフィルターで 22/80/443 を開放**、OSイメージ選択、SSH鍵登録。ドメイン名・ホストIPは実装時にユーザーへ確認して設定する。Secrets 未設定時は deploy ジョブをスキップし quality/image のみ通す（フォークやSecrets未設定でもCIが赤くならない）

## Success Criteria
- [ ] `docker build` がローカル/CIで成功し、コンテナ起動で自動マイグレーション+ /api/health が 200 を返す（deployable）
- [ ] docker compose up -d で app+Caddy が起動する（Caddyfile はドメインをenv/プレースホルダで受け取る）
- [ ] GitHub Actions: PR で quality が走り、main への push で quality→image→deploy が連鎖する。deploy 後のヘルスチェック失敗でワークフローが失敗する（observable）
- [ ] backup.sh: 実行で世代ファイルが作られ、21世代目で最古の週次のみ削除される（テスト: 一時ディレクトリで21回実行）。--pin のファイルはローテーションで削除されない（operable）
- [ ] restore.sh でバックアップから復元でき、integrity_check が ok を返す
- [ ] Secrets 未設定の環境で deploy ジョブが安全にスキップされる
- [ ] docs/ops.md に初回セットアップ〜リストアまでの手順が揃っている（人間がそのまま実行できる粒度）

## Risks
- **VPS環境の詳細**: デプロイ先は Xserver VPS で確定（Docker/compose/Caddy/cron すべて利用可、非互換なし）。残る未確定はドメイン名・ホストIP・OSバージョン選択のみ。Mitigation: 実装時に確認。パケットフィルター（80/443/SSH開放）の設定漏れを ops.md のチェックリストに含める
- **SQLiteバックアップの整合性**: 稼働中コピーの破損。Mitigation: cp でなく sqlite3 .backup API + 検証を必須化
- **cron の失権**: バックアップが止まっても気づかない。Mitigation: backup.sh がログを残し、docs/ops.md に「月1でバックアップ日付を確認」を運用チェックとして明記（MVPでは通知連携なし）

## Boundaries
アプリコード・スキーマ・ヘルスエンドポイントの実装は unit-01。エクスポート機能（アプリ内）は unit-03。監視ダッシュボード・アラート通知は本インテントの対象外（単一ユーザーMVP。ヘルスチェック+バックアップ検証+ログで代替）。

## Notes
- バックアップ方針は「週次・20世代+ピン留め永続」（アライメントゲートでユーザーが日次14世代から変更）
- デプロイの CI/CD 監視はグローバル運用ルール（gh run watch）と整合するよう、ワークフロー名を分かりやすく（deploy）する
