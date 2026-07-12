/**
 * ALLOWED_EMAILS（カンマ区切り許可メールリスト）の照合。
 * env 非依存の純関数（テスト容易性のため env 値は引数で受ける）。
 */
export function parseAllowedEmails(allowedEmailsEnv: string | undefined | null): string[] {
  if (!allowedEmailsEnv) return [];
  return allowedEmailsEnv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * メールアドレスが許可リストに含まれるか（trim + 小文字比較）。
 * リスト未設定・空の場合は全拒否（フェイルクローズ）。
 */
export function isAllowedEmail(
  email: string | undefined | null,
  allowedEmailsEnv: string | undefined | null,
): boolean {
  if (!email) return false;
  const allowed = parseAllowedEmails(allowedEmailsEnv);
  return allowed.includes(email.trim().toLowerCase());
}
