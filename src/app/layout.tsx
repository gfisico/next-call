import type { Metadata, Viewport } from "next";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "next-call",
  description: "ジャズセッション向け選曲提案アプリ",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        {/*
         * FOUC 防止（docs/dark_mode.md §3-4）: UI マウント前に <head> 内で
         * 同期実行し、初回ペイント前に <html> へ .dark を先付けする。
         * 判定条件・キーは theme.ts（フックと共有）から埋め込む生インライン。
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* ページ背景・本文色は design_rule §1.3（bg-background text-foreground） */}
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        {children}
      </body>
    </html>
  );
}
