"use client";

/**
 * セッション記録画面（ACTIVE 時のホーム本体 / 履歴詳細で再利用）。
 * - ACTIVE: リスナートグル即 PATCH、曲を追加、次の曲を考える、終了メニュー
 * - ENDED : 読み取り中心。ただし各行の編集・削除は可能（曲追加/次の曲は非表示）
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import {
  ApiClientError,
  deletePerformance,
  patchSession,
} from "@/lib/api/client";
import { SWR_KEYS } from "@/lib/api/hooks";
import type { PerformanceWithFront, SessionDetail } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./confirm-dialog";
import { SongPerformanceSheet } from "./song-performance-sheet";
import { Toggle } from "./toggle";

interface SessionRecordScreenProps {
  session: SessionDetail;
  /** 元データ（active / session(id)）の再検証 */
  refresh: () => Promise<unknown>;
  /** 店舗が母店か（venue.isHome。SessionDetail には無いため呼び出し側が付与） */
  isHome?: boolean;
}

function participationLabel(p: PerformanceWithFront): string {
  if (!p.participated) return "不参加";
  if (p.instrument === "SAX") return "SAX";
  if (p.instrument === "PIANO") return "PIANO";
  return "参加";
}

export function SessionRecordScreen({
  session,
  refresh,
  isHome = false,
}: SessionRecordScreenProps) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const isActive = session.status === "ACTIVE";

  const [listeners, setListeners] = useState(session.hasListeners);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PerformanceWithFront | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PerformanceWithFront | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleListenerChange(next: boolean) {
    const prev = listeners;
    setListeners(next); // 楽観更新
    try {
      await patchSession(session.id, { hasListeners: next });
      await Promise.all([refresh(), mutate(SWR_KEYS.sessions)]);
    } catch {
      setListeners(prev);
      toast.error("リスナー客の更新に失敗しました");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePerformance(deleteTarget.id);
      await Promise.all([refresh(), mutate(SWR_KEYS.sessions)]);
      setDeleteTarget(null);
    } catch {
      toast.error("演奏記録の削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }

  async function handleEnd() {
    setEnding(true);
    try {
      await patchSession(session.id, { status: "ENDED" });
      await Promise.all([
        mutate(SWR_KEYS.activeSession),
        mutate(SWR_KEYS.sessions),
        refresh(),
      ]);
      setEndOpen(false);
      router.push(`/sessions/${session.id}`);
    } catch (e) {
      toast.error(
        e instanceof ApiClientError ? e.message : "セッションの終了に失敗しました",
      );
    } finally {
      setEnding(false);
    }
  }

  const performances = session.performances;

  return (
    <div className={isActive ? "pb-16" : undefined}>
      {/* --- ヘッダ --- */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {session.venueName}
            {isHome ? <Badge variant="info">母店</Badge> : null}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {session.sessionDate}
            {!isActive ? " ・ 終了済み" : ""}
            {!isActive
              ? ` ・ リスナー客${session.hasListeners ? "あり" : "なし"}`
              : ""}
          </p>
        </div>

        {isActive ? (
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="セッション操作メニュー"
              aria-expanded={menuOpen}
              className="h-10 w-10"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span aria-hidden="true" className="text-lg">
                ⋯
              </span>
            </Button>
            {menuOpen ? (
              <>
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-popover shadow-md">
                  <button
                    type="button"
                    className="flex h-10 w-full items-center px-3 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    onClick={() => {
                      setMenuOpen(false);
                      setEndOpen(true);
                    }}
                  >
                    セッションを終了
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* --- リスナー客トグル（ACTIVE のみ即 PATCH） --- */}
      {isActive ? (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-medium">リスナー客</span>
          <Toggle
            ariaLabel="リスナー客の有無"
            value={listeners}
            onChange={handleListenerChange}
          />
        </div>
      ) : null}

      {/* --- セットリスト --- */}
      <p className="mt-6 text-sm font-medium">
        セットリスト（{performances.length}曲）
      </p>
      {performances.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          まだ曲が登録されていません。
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {performances.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-border bg-card p-3"
            >
              <div className="flex items-start gap-2">
                <span className="w-6 shrink-0 pt-0.5 text-right text-sm text-muted-foreground">
                  {p.orderIndex}.
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${p.songTitle} を編集`}
                >
                  <span className="block text-sm font-semibold">
                    {p.songTitle}
                  </span>
                  {p.frontInstruments.length > 0 ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      フロント: {p.frontInstruments.map((f) => f.code).join(" → ")}
                    </span>
                  ) : null}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  aria-label={`${p.songTitle} を削除`}
                  onClick={() => setDeleteTarget(p)}
                >
                  <span aria-hidden="true" className="text-lg">
                    ⋯
                  </span>
                </Button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1 pl-8">
                <Badge variant="neutral">{participationLabel(p)}</Badge>
                {p.calledByMe ? <Badge variant="success">コール</Badge> : null}
                {p.noChart ? <Badge variant="warning">譜面なし</Badge> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* --- 曲を追加（ACTIVE のみ・secondary） --- */}
      {isActive ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3 h-10 w-full"
          onClick={() => setAddOpen(true)}
        >
          ＋ 曲を追加
        </Button>
      ) : null}

      {/* --- 下部固定バー: 次の曲を考える（画面内唯一の Primary） --- */}
      {isActive ? (
        <div className="fixed inset-x-0 bottom-14 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <Button
              type="button"
              className="h-10 w-full"
              onClick={() => router.push("/suggest")}
            >
              次の曲を考える
            </Button>
          </div>
        </div>
      ) : null}

      {/* --- 曲追加シート --- */}
      {isActive ? (
        <SongPerformanceSheet
          sessionId={session.id}
          mode="create"
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            void Promise.all([refresh(), mutate(SWR_KEYS.sessions)]);
          }}
        />
      ) : null}

      {/* --- 編集シート（ENDED でも可） --- */}
      {editing ? (
        <SongPerformanceSheet
          key={editing.id}
          sessionId={session.id}
          mode="edit"
          performanceId={editing.id}
          initialSong={{ id: editing.songId, title: editing.songTitle }}
          initialParticipated={editing.participated}
          initialInstrument={editing.instrument}
          initialCalledByMe={editing.calledByMe}
          initialNoChart={editing.noChart}
          initialNote={editing.note}
          initialFrontInstruments={editing.frontInstruments}
          open={true}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onSaved={() => {
            void Promise.all([refresh(), mutate(SWR_KEYS.sessions)]);
            setEditing(null);
          }}
        />
      ) : null}

      {/* --- 削除確認（破壊的操作） --- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="この曲を削除しますか？"
        description={deleteTarget?.songTitle}
        confirmLabel="削除する"
        confirmVariant="destructive"
        pending={deleting}
        onConfirm={handleDelete}
      />

      {/* --- 終了確認（非破壊 → 通常ボタン） --- */}
      <ConfirmDialog
        open={endOpen}
        onOpenChange={setEndOpen}
        title="セッションを終了しますか？"
        description="終了後は履歴に移動します。演奏記録はあとから修正できます。"
        confirmLabel="終了する"
        pending={ending}
        onConfirm={handleEnd}
      />
    </div>
  );
}
