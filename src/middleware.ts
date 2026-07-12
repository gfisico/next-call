/**
 * 全ルート保護 middleware（Completion Criteria #3）:
 * 未認証アクセスは /login へリダイレクト。/api/health・/login・/api/auth/* は公開。
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { shouldRedirectToLogin } from "@/lib/route-guard";

export default auth((req) => {
  if (shouldRedirectToLogin(req.nextUrl.pathname, !!req.auth)) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  // 静的アセット類は matcher 段階で除外（isPublicPath でも二重に防御）
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
