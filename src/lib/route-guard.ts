/**
 * ルート保護の判定（middleware から使う純関数）。
 * 未認証アクセスは /login へリダイレクトする。ただし以下は公開:
 * - /api/health（コンテナヘルスチェックの基点。認証不要が Completion Criteria）
 * - /login（ログイン画面）
 * - /api/auth/*（Auth.js のコールバック等）
 * - Next.js 内部/静的アセット
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/api/health") return true;
  if (pathname === "/login") return true;
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/robots.txt") return true;
  return false;
}

/** 未認証時に /login へリダイレクトすべきか */
export function shouldRedirectToLogin(
  pathname: string,
  isAuthenticated: boolean,
): boolean {
  return !isAuthenticated && !isPublicPath(pathname);
}
