# Blockers

## BLOCKER-001: pre-edit-guard がサブエージェントの Edit/Write を全拒否（2026-07-12）

**状況:** /ai-dlc:execute の自律ループで unit-01-app-foundation の planner は完了（計画は state/current-plan.md）。しかし builder サブエージェントは Edit/Write を一切実行できない。

**原因:** ~/.claude/pre-edit-guard.sh (PreToolUse: Edit|Write) は、実行セッションのトランスクリプト内に「アシスタントの【方針提示】→その後のユーザー承認語」を要求する。サブエージェントのトランスクリプトにはユーザー発言（承認）が存在し得ないため、構造的に必ず deny になる。planner も Write をブロックされ dlc_state_save（Bash）で保存した。

**制約:** グローバル CLAUDE.md は「pre-edit-guard に弾かれた場合、Bash/sed 等での迂回は絶対禁止」と定めるため、builder に Bash ヒアドキュメントでファイル生成させる回避は不可。

**解除に必要なユーザー判断（いずれか）:**
1. CLAUDE_BYPASS_HOOK=1 CLAUDE_BYPASS_REASON=... を設定したセッションで /ai-dlc:execute を再実行（フック自身が持つ正規バイパス。全バイパスはログ記録される）
2. pre-edit-guard.sh を改修し、AI-DLC の worktree（.ai-dlc/worktrees/ 配下）への書き込みを許可する例外を追加
3. サブエージェントを使わず、メイン会話で【方針提示】→OK を得てインライン実装（ユニットごとに承認が必要・自律性は失われる）

**ステータス:** 人間の介入待ち。unit-01 は in_progress / hat=builder で停止中。
