/**
 * Success Criteria #1（未認証リダイレクト）:
 * unit-03 で追加する全 API パスが middleware（src/middleware.ts → route-guard）の
 * 保護対象であること。未認証なら /login へリダイレクトされ、認証済みなら素通りする。
 */
import { describe, expect, it } from "vitest";
import { isPublicPath, shouldRedirectToLogin } from "@/lib/route-guard";

/** unit-03 で追加した API パス（代表例。すべて認証必須） */
const PROTECTED_API_PATHS = [
  "/api/songs",
  "/api/songs/1",
  "/api/songs/quick",
  "/api/instruments",
  "/api/instruments/vo",
  "/api/genre-tags",
  "/api/venues",
  "/api/venues/1",
  "/api/settings",
  "/api/sessions",
  "/api/sessions/active",
  "/api/sessions/1",
  "/api/sessions/1/performances",
  "/api/performances/1",
  "/api/export",
];

describe("unit-03 API パスの認証保護", () => {
  it.each(PROTECTED_API_PATHS)("%s は公開パスではない", (p) => {
    expect(isPublicPath(p)).toBe(false);
  });

  it.each(PROTECTED_API_PATHS)(
    "%s は未認証なら /login へリダイレクト",
    (p) => {
      expect(shouldRedirectToLogin(p, false)).toBe(true);
    },
  );

  it.each(PROTECTED_API_PATHS)("%s は認証済みなら素通り", (p) => {
    expect(shouldRedirectToLogin(p, true)).toBe(false);
  });
});
