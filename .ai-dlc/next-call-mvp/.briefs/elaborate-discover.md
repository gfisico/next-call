---
intent_slug: next-call-mvp
worktree_path: /Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-mvp
project_maturity: greenfield
provider_config: {}
---

# Intent Description

ジャズセッション向け「次の曲」選曲提案アプリ（次コール / next-call）のMVPを新規開発する。

セッション中のセットリストをリアルタイム記録しながら、当日の演奏傾向・過去の演奏履歴（約5年分）・自分の選曲傾向・次の曲の編成条件・今回の選曲意図を踏まえて、次にコールする曲の候補を約3曲、推奨理由付きで30秒以内に提示する意思決定支援アプリ。「正解の曲」を提示するのではなく、最終判断は利用者自身が行う。

**一次仕様書: docs/jazz_session_song_recommendation_spec_v2.md（必ず全文を読むこと。852行）**
**デザインルール: docs/design_rule.md（Tailwind + shadcn/ui 前提、全画面でこれに準拠）**

## Clarification Answers（Phase 2 のQ&A全記録）

- Q: アプリの形態は？ → **モバイル対応Webアプリ**（Next.js + Tailwind + shadcn/ui。iPhoneのSafariから利用、後でPWA化も可能）
- Q: データの保存先は？（利用者1人、店内で電波不安定の可能性） → **クラウドDB**（ローカル保存ではなくサーバー側DB）
- Q: 推奨理由の生成方式（初期版）は？ → **固定テンプレートのみ**（LLM/AIは初期版では使わない。定型文をルールから生成。AIは後続インテントで追加）
- Q: 初期データ投入は？ → **CSV/テキスト一括インポート機能を初期版に含める**（曲マスター＋約5年分のセットリスト履歴。iPhoneメモで管理されている）
- Q: ホスティングは？ → **VPSに自前ホスティング**
- Q: 認証は？ → **Googleログイン**（OAuth。自分のGoogleアカウントのみ許可する単一ユーザー運用。サインアップ画面は作らない）
- Q: DBエンジンは？ → **SQLite**（単一ユーザー・小規模データ：曲マスター数百曲・セッション数百件程度）
- Q: デプロイ方法は？ → **GitHub Actions + Docker**（mainへのpushでDockerイメージをビルドしVPSへ自動デプロイ）
- Q: 仕様書§21の未確定事項は？ → **暫定値で進めて設定化**（合理的な暫定値で実装し、スコア重み・減点強度等は設定画面から調整可能にする）

## Discovery File Path

/Users/fisico/src/senkyoku/.ai-dlc/worktrees/next-call-mvp/.ai-dlc/next-call-mvp/discovery.md

## Existing Project Knowledge

### knowledge/design.md（confidence: high）

ユーザー提供の design_rule.md をデザインシステムとして採用（全文は .ai-dlc/knowledge/design.md および docs/design_rule.md にある。Tailwind CSS + shadcn/ui 前提、カラートークン、タイポグラフィ、スペーシング4px刻み、radius/shadow規約、Button/Card/Badge/Input/Table/Modalのクラス定義、アクセシビリティ基準：キーボード操作・focus-visible・コントラスト・タップ領域h-10）。

## Additional Context for Discovery（greenfieldにつき）

このリポジトリにはまだプロダクションコードが存在しない（docs/ と .ai-dlc/ のみ）。従ってコードベース探索の代わりに、以下を実施すること:

1. **仕様書の全文分析**: docs/jazz_session_song_recommendation_spec_v2.md を精読し、ドメインモデル（エンティティ、属性、関係、ライフサイクル）を抽出して discovery.md に書く。特に: セッション、曲マスター（多属性・ジャンル特徴は複数付与可）、演奏記録（自分の参加有無・楽器・コール有無・譜面なし）、店舗マスター（母店/母店以外の自動判定）、推奨ロジック（完全除外→編成条件→強制条件→スコアリング→繰り返し減点→重み付けランダム抽出→理由生成）、選曲意図（5段階スライダー群、前回値引き継ぎ）、保留曲（セッションまたぎ）、推奨履歴（繰り返し減点用）。
2. **未確定事項（§21）への暫定値提案**: 各未確定事項に対し、実装可能な具体的暫定値（数値・式）を提案し discovery.md に「## Provisional Values」として記録。すべて設定値として調整可能にする前提。
3. **技術スタック設計**: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + SQLite（ORM: Drizzle または Prisma を比較して推奨を決める）+ Auth.js (Google provider, メールアドレス許可リスト) + Docker + GitHub Actions。ディレクトリ構成案、データアクセス層の設計方針を discovery.md に書く。
4. **Deployment Architecture セクション**: VPSへのDocker配置構成（コンテナ、SQLiteファイルのボリューム永続化、バックアップ方針、リバースプロキシ/TLS想定）、GitHub ActionsのCI/CDパイプライン案を「## Deployment Architecture」として書く。
5. **Quality Gate Candidates**: greenfieldなので、導入予定ツーリングから妥当なゲートを提案（例: typecheck: tsc --noEmit, lint: eslint, test: vitest, build: next build）。「## Quality Gate Candidates」セクションに表形式で書く。
6. **インポートデータ形式の検討**: iPhoneメモ由来のセットリスト履歴と曲マスターの現実的なインポート形式（CSV列定義案）を提案。実データのフォーマットは未入手であることを Open Questions に明記。
7. **Open Questions**: ユーザーに確認が必要な残課題を列挙。

discovery.md には最低限、以下のセクションを含めること:
## Domain Model（Entities / Relationships / Data Sources / Data Gaps）
## Recommendation Logic Analysis（仕様§12,14の除外・減点・スコアリングの整理、パイプライン化）
## Provisional Values（§21の暫定値提案）
## Tech Stack & Architecture
## Deployment Architecture
## Data Import Plan
## Quality Gate Candidates
## Open Questions
