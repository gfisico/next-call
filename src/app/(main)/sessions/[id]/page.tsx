"use client";

/**
 * 履歴詳細 "/sessions/[id]"（criterion 1,8）:
 * useSession(id) の詳細を SessionRecordScreen で再利用。
 * ENDED は読み取り中心（曲追加/次の曲は非表示）だが各行の編集・削除は可能。
 */
import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession, useVenues } from "@/lib/api/hooks";
import { SessionRecordScreen } from "@/components/session/session-record-screen";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;

  const { session, error, isLoading, mutate } = useSession(
    validId ? id : null,
  );
  const { venues } = useVenues();

  const isHome = useMemo(() => {
    if (!session) return false;
    return venues.some((v) => v.id === session.venueId && v.isHome);
  }, [session, venues]);

  if (!validId || error) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          セッションが見つかりませんでした。
        </p>
        <Link
          href="/sessions"
          className="text-sm underline underline-offset-4"
        >
          ‹ 履歴に戻る
        </Link>
      </div>
    );
  }

  if (isLoading || !session) {
    return <p className="text-sm text-muted-foreground">読み込み中…</p>;
  }

  return (
    <div className="space-y-4">
      <Link
        href="/sessions"
        className="inline-flex text-sm text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        ‹ 履歴に戻る
      </Link>
      <SessionRecordScreen session={session} refresh={mutate} isHome={isHome} />
    </div>
  );
}
