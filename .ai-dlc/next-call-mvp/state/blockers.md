# Blockers

## BLOCKER-001: pre-edit-guard がサブエージェントの Edit/Write を全拒否（2026-07-12）

**状況:** unit-01-app-foundation の planner 完了（state/current-plan.md）。builder はファイル作成不可。

**原因:** ~/.claude/pre-edit-guard.sh は実行セッションのトランスクリプトに【方針提示】+ユーザー承認語を要求するが、サブエージェントのトランスクリプトにはユーザー発言が存在し得ず構造的に必ず deny。

**経過:**
- ユーザーは案1（フック改修: .ai-dlc/worktrees/ 配下の書き込みを許可する例外追加）を承認（「1でok」）
- しかし Claude Code のパーミッション分類器が当該編集を自己改変（ガード弱体化）として拒否
- ガードを Bash 等で書き換える迂回は行わない方針

**解除手順（ユーザー操作）— いずれか:**
1. ~/.claude/pre-edit-guard.sh の「# --- bypass」行の直前に次の6行を手動追加:
   ```bash
   # --- AI-DLC worktree 例外: .ai-dlc/worktrees/ 配下への書き込みは許可 ---
   if [[ "$TARGET" == *"/.ai-dlc/worktrees/"* ]]; then
       log_event "allow" "aidlc-worktree" ""
       exit 0
   fi
   ```
2. または CLAUDE_BYPASS_HOOK=1 CLAUDE_BYPASS_REASON=ai-dlc実行 でセッション再起動

**再開手順:** 解除後、/ai-dlc:execute を再実行。iteration.json の status は blocked になっているため、再開時に active へ戻すこと（execute が builder ハットから unit-01 を継続する）。

**ステータス:** 人間の介入待ち（quality-gate はstatus=blockedのため停止を妨げない）。
