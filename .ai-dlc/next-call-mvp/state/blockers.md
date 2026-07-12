# Blockers

（アクティブなブロッカーなし）

## 備考（ブロッカーではない・期待された状態）

### NOTE-002: unit-02 は TDD RED フェーズ — tests ゲートの失敗は意図した状態（2026-07-12）
- unit-02-recommendation-engine（workflow: tdd, hat: test-writer）で失敗テスト200件をコミット済み（224758c）。
- `npm run test` は 200 failed | 86 passed（既存86件はパス維持）。失敗理由は全件
  スタブの `Error: not implemented`（正しい理由での失敗を確認済み。構文・import エラーなし）。
- これは test-writer の成果物仕様どおり。汎用 quality gate（tests）は TDD フェーズを
  認識しないため失敗と報告されるが、対応不要。
- 解消条件: 次の hat（implementer）が `src/engine/` を実装して GREEN にする。
  テストの skip・スタブへの実ロジック混入によるゲート回避は禁止（RED の意味が壊れるため）。

## 解決済み

### BLOCKER-001: pre-edit-guard がサブエージェントの Edit/Write を全拒否（2026-07-12 解決）
ユーザーが ~/.claude/pre-edit-guard.sh に AI-DLC worktree 例外（.ai-dlc/worktrees/ 配下は許可）を手動追加して解決。builder 再開。
