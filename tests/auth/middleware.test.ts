/**
 * Completion Criteria #3:
 * 未認証アクセスは /login へリダイレクト（/api/health を除く）。
 * middleware が使う純関数 isPublicPath / shouldRedirectToLogin を検証する。
 */
import { describe, expect, it } from "vitest";
import { isPublicPath, shouldRedirectToLogin } from "@/lib/route-guard";

describe("isPublicPath", () => {
  it("/api/health は公開（認証不要）", () => {
    expect(isPublicPath("/api/health")).toBe(true);
  });

  it("/login は公開", () => {
    expect(isPublicPath("/login")).toBe(true);
  });

  it("/api/auth/* は公開（Auth.js コールバック）", () => {
    expect(isPublicPath("/api/auth/signin")).toBe(true);
    expect(isPublicPath("/api/auth/callback/google")).toBe(true);
    expect(isPublicPath("/api/auth")).toBe(true);
  });

  it("静的アセットは公開", () => {
    expect(isPublicPath("/_next/static/chunks/main.js")).toBe(true);
    expect(isPublicPath("/favicon.ico")).toBe(true);
  });

  it("アプリのページ・API は非公開", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/suggest")).toBe(false);
    expect(isPublicPath("/songs")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/sessions/1")).toBe(false);
    expect(isPublicPath("/api/anything")).toBe(false);
    // 前方一致の偽陽性がないこと
    expect(isPublicPath("/api/healthcheck")).toBe(false);
    expect(isPublicPath("/api/authx")).toBe(false);
    expect(isPublicPath("/login/other")).toBe(false);
  });
});

describe("shouldRedirectToLogin", () => {
  it("未認証 + 保護ルート → /login へリダイレクト", () => {
    expect(shouldRedirectToLogin("/", false)).toBe(true);
    expect(shouldRedirectToLogin("/sessions/3", false)).toBe(true);
    expect(shouldRedirectToLogin("/api/anything", false)).toBe(true);
  });

  it("未認証でも /api/health は素通り", () => {
    expect(shouldRedirectToLogin("/api/health", false)).toBe(false);
  });

  it("未認証でも /login と /api/auth/* は素通り（リダイレクトループ防止）", () => {
    expect(shouldRedirectToLogin("/login", false)).toBe(false);
    expect(shouldRedirectToLogin("/api/auth/callback/google", false)).toBe(false);
  });

  it("認証済みはリダイレクトしない", () => {
    expect(shouldRedirectToLogin("/", true)).toBe(false);
    expect(shouldRedirectToLogin("/settings", true)).toBe(false);
  });
});
