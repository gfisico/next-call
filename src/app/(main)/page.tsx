"use client";

/**
 * ホーム "/"（criterion 1,8）:
 * - ACTIVE セッションあり → セッション記録画面
 * - なし → 「セッションを開始」（画面内唯一の Primary）+ 直近セッション
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useActiveSession, useSessions, useVenues } from "@/lib/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SessionRecordScreen } from "@/components/session/session-record-screen";
import { StartSessionSheet } from "@/components/session/start-session-sheet";

const RECENT_LIMIT = 5;

export default function HomePage() {
  const { session, isLoading, mutate } = useActiveSession();
  const { sessions } = useSessions();
  const { venues } = useVenues();
  const [startOpen, setStartOpen] = useState(false);

  const homeVenueIds = useMemo(
    () => new Set(venues.filter((v) => v.isHome).map((v) => v.id)),
    [venues],
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">読み込み中…</p>;
  }

  if (session) {
    return (
      <SessionRecordScreen
        session={session}
        refresh={mutate}
        isHome={homeVenueIds.has(session.venueId)}
      />
    );
  }

  const recent = sessions.slice(0, RECENT_LIMIT);

  return (
    <div className="space-y-6">
      <Button
        type="button"
        className="h-10 w-full"
        onClick={() => setStartOpen(true)}
      >
        セッションを開始
      </Button>

      <div>
        <p className="text-sm font-medium">直近のセッション</p>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            まだセッションの記録がありません。
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className="flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {s.venueName}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {s.sessionDate}
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
        {sessions.length > 0 ? (
          <Button asChild variant="ghost" className="mt-2 h-10">
            <Link href="/sessions">すべての履歴を見る →</Link>
          </Button>
        ) : null}
      </div>

      <StartSessionSheet open={startOpen} onOpenChange={setStartOpen} />
    </div>
  );
}
