/**
 * Auth.js v5 設定（NextAuth() 呼び出しから分離したテスト可能な設定オブジェクト）。
 * - Google provider（AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET は Auth.js が env から自動解決）
 * - JWT セッション戦略（DB アダプタなし・ユーザーテーブルなし）
 * - signIn コールバックで ALLOWED_EMAILS に含まれないメールを拒否
 */
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "./allowed-emails";

export const authConfig = {
  providers: [Google],
  // 自前ホスティング（Caddy 等のリバースプロキシ配下）のため Host ヘッダを信頼する。
  // 未設定だと本番モードで UntrustedHost となり middleware の認証判定が機能しない
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ user }) {
      // 許可リスト外は拒否（ALLOWED_EMAILS 未設定時は全拒否のフェイルクローズ）
      return isAllowedEmail(user.email, process.env.ALLOWED_EMAILS);
    },
  },
} satisfies NextAuthConfig;
