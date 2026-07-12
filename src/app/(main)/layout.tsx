import { BottomNav } from "@/components/shell/bottom-nav";
import { Toaster } from "@/components/ui/sonner";

/**
 * 認証必須エリアの共通レイアウト（モバイルファースト app shell）:
 * ヘッダー + コンテンツ + 下部固定ナビ（セッション/推薦/マスター/設定）
 */
export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-12 max-w-lg items-center px-4">
          <span className="text-base font-semibold">next-call</span>
        </div>
      </header>
      {/* 下部ナビ（h-14）と重ならないよう余白を確保 */}
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6 pb-20">
        {children}
      </main>
      <BottomNav />
      {/* トースト通知（409 誘導・保存失敗など）。handoff-notes 指示によりここでマウント */}
      <Toaster />
    </div>
  );
}
