/**
 * Next.js instrumentation — サーバー起動時に一度だけ実行される。
 * マイグレーションの自動適用（Completion Criteria #7）:
 * 新規コンテナは起動だけでスキーマが最新化される。ロールバックは直前イメージへの切替のみで成立
 * （マイグレーションは追加的に保つ運用のため）。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 日付の解釈は JST が正（仕様）。未設定時のみ既定値を補う
    process.env.TZ ??= "Asia/Tokyo";
    const { runMigrations } = await import("./db/migrate");
    runMigrations();
    console.log("[instrumentation] database migrations applied");
  }
}
