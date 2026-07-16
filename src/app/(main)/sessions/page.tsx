"use client";

/**
 * 履歴 "/sessions"（criterion 1,8）: 新しい順の一覧。行タップで詳細へ。
 */
import { useMemo } from "react";
import Link from "next/link";
import { useSessions, useVenues } from "@/lib/api/hooks";
import { Badge } from "@/components/ui/badge";

export default function SessionsHistoryPage() {
  const { sessions, isLoading } = useSessions();
  const { venues } = useVenues();

  const homeVenueIds = useMemo(
    () => new Set(venues.filter((v) => v.isHome).map((v) => v.id)),
    [venues],
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          セッション履歴
        </h1>
        <Link
          href="/sessions/import-memo"
          className="inline-flex h-10 items-center rounded-lg border border-border bg-secondary px-3 text-sm font-medium text-secondary-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          メモから一括取込
        </Link>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">読み込み中…</p>
      ) : sessions.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          まだセッションの記録がありません。
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sessions/${s.id}`}
                className="flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {s.sessionDate} ・ {s.venueName}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {s.status === "ACTIVE" ? "記録中" : "終了済み"}
                    {s.hasListeners ? " ・ リスナー客あり" : ""}
                  </span>
                </span>
                {homeVenueIds.has(s.venueId) ? (
                  <Badge variant="info">母店</Badge>
                ) : null}
                <span aria-hidden="true" className="text-muted-foreground">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
