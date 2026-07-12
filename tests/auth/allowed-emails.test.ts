/**
 * Completion Criteria #2:
 * ALLOWED_EMAILS に含まれるメールはログイン可、それ以外は拒否
 * （純関数 isAllowedEmail + Auth.js signIn コールバックの単体テスト）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "next-auth";
import { isAllowedEmail, parseAllowedEmails } from "@/lib/allowed-emails";
import { authConfig } from "@/lib/auth.config";

describe("parseAllowedEmails", () => {
  it("カンマ区切りを trim + 小文字化して返す", () => {
    expect(parseAllowedEmails(" A@example.com , b@Example.COM ")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("未設定・空は空配列", () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails("")).toEqual([]);
    expect(parseAllowedEmails(" , ,")).toEqual([]);
  });
});

describe("isAllowedEmail", () => {
  const env = "alice@example.com,bob@example.com";

  it("許可リスト内のメールは true", () => {
    expect(isAllowedEmail("alice@example.com", env)).toBe(true);
    expect(isAllowedEmail("bob@example.com", env)).toBe(true);
  });

  it("許可リスト外のメールは false", () => {
    expect(isAllowedEmail("mallory@example.com", env)).toBe(false);
  });

  it("大文字小文字を区別しない", () => {
    expect(isAllowedEmail("Alice@Example.COM", env)).toBe(true);
  });

  it("前後の空白を無視する", () => {
    expect(isAllowedEmail("  alice@example.com  ", env)).toBe(true);
    expect(isAllowedEmail("alice@example.com", " alice@example.com , x@y.z ")).toBe(
      true,
    );
  });

  it("email が null/undefined/空なら false", () => {
    expect(isAllowedEmail(null, env)).toBe(false);
    expect(isAllowedEmail(undefined, env)).toBe(false);
    expect(isAllowedEmail("", env)).toBe(false);
  });

  it("ALLOWED_EMAILS 未設定なら全拒否（フェイルクローズ）", () => {
    expect(isAllowedEmail("alice@example.com", undefined)).toBe(false);
    expect(isAllowedEmail("alice@example.com", "")).toBe(false);
  });

  it("単一メール設定でも動作する", () => {
    expect(isAllowedEmail("solo@example.com", "solo@example.com")).toBe(true);
    expect(isAllowedEmail("other@example.com", "solo@example.com")).toBe(false);
  });
});

describe("authConfig.callbacks.signIn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function callSignIn(email: string | null): boolean {
    const user: User = { email };
    // signIn コールバックは user.email と ALLOWED_EMAILS のみ参照する
    return authConfig.callbacks.signIn({ user, account: null });
  }

  it("ALLOWED_EMAILS 内のメールは true（ログイン許可）", () => {
    vi.stubEnv("ALLOWED_EMAILS", "me@example.com,sub@example.com");
    expect(callSignIn("me@example.com")).toBe(true);
  });

  it("ALLOWED_EMAILS 外のメールは false（サインイン拒否）", () => {
    vi.stubEnv("ALLOWED_EMAILS", "me@example.com");
    expect(callSignIn("attacker@example.com")).toBe(false);
  });

  it("email なしは false", () => {
    vi.stubEnv("ALLOWED_EMAILS", "me@example.com");
    expect(callSignIn(null)).toBe(false);
  });

  it("ALLOWED_EMAILS 未設定は false", () => {
    vi.stubEnv("ALLOWED_EMAILS", "");
    expect(callSignIn("me@example.com")).toBe(false);
  });

  it("JWT セッション戦略が設定されている（DB アダプタなし）", () => {
    expect(authConfig.session.strategy).toBe("jwt");
  });
});
