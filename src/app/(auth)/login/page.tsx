import type { Metadata } from "next";
import { signIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "ログイン | next-call",
};

/**
 * ログイン画面: Google サインインボタンのみのシンプル画面（design_rule 準拠。Primary は画面内1つ）
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">next-call</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            ジャズセッション向け選曲提案アプリ。許可された Google
            アカウントでログインしてください。
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            Google でログイン
          </button>
        </form>
      </section>
    </main>
  );
}
