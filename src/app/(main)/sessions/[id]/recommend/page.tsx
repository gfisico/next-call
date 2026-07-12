"use client";

/**
 * 選曲支援・推薦結果画面 "/sessions/[id]/recommend"（unit-06）。
 * params から sessionId を解決し RecommendScreen へ渡す（画面本体は params 非依存でテスト可能）。
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { RecommendScreen } from "@/components/session/recommend-screen";

export default function RecommendPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;

  if (!validId) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          セッションが見つかりませんでした。
        </p>
        <Link href="/sessions" className="text-sm underline underline-offset-4">
          ‹ 履歴に戻る
        </Link>
      </div>
    );
  }

  return <RecommendScreen sessionId={id} />;
}
