"use client";

/**
 * 「推薦」タブ（bottom-nav）。単独の入口ではなく進行中セッションの選曲支援へ誘導する。
 * - 進行中セッションがあれば "/sessions/[id]/recommend" へ置換遷移（迷子導線の解消）
 * - 無ければ「進行中セッションがありません」空状態
 */
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveSession } from "@/lib/api/hooks";

export default function SuggestPage() {
  const router = useRouter();
  const { session, isLoading } = useActiveSession();

  useEffect(() => {
    if (session) router.replace(`/sessions/${session.id}/recommend`);
  }, [session, router]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中…</p>;
  }

  if (session) {
    return <p className="text-sm text-muted-foreground">選曲支援へ移動中…</p>;
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold tracking-tight">選曲支援</h1>
      <p className="text-sm text-muted-foreground">
        進行中のセッションがありません。セッションを開始すると、次の曲の候補を提案できます。
      </p>
      <Link
        href="/"
        className="inline-flex text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        セッションを開始する
      </Link>
    </div>
  );
}
