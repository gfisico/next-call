"use client";

/**
 * セッション開始シート（criterion 2: 新規店舗登録時のみ母店判定を表示）。
 */
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import {
  ApiClientError,
  createSession,
  createVenue,
} from "@/lib/api/client";
import { SWR_KEYS, useVenues } from "@/lib/api/hooks";
import type { SessionDetail, Venue } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Segment } from "./segment";
import { Toggle } from "./toggle";

interface StartSessionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted?: (session: SessionDetail) => void;
}

export function StartSessionSheet({
  open,
  onOpenChange,
  onStarted,
}: StartSessionSheetProps) {
  const { venues } = useVenues();
  const { mutate } = useSWRConfig();

  const [selectedVenueId, setSelectedVenueId] = useState<number | null>(null);
  const [newVenueName, setNewVenueName] = useState("");
  const [isHome, setIsHome] = useState(false);
  const [hasListeners, setHasListeners] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = newVenueName.trim();
  const canStart = selectedVenueId !== null || trimmedName.length > 0;

  function selectVenue(id: number) {
    setSelectedVenueId(id);
    setNewVenueName("");
    setError(null);
  }

  function changeName(value: string) {
    setNewVenueName(value);
    if (value.trim().length > 0) setSelectedVenueId(null);
    setError(null);
  }

  async function handleStart() {
    if (!canStart || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let venueId: number;
      if (trimmedName.length > 0) {
        // 新規店舗: 先に venue を作成（name 重複 409 は既存 venue にフォールバック）
        try {
          const venue = await createVenue({ name: trimmedName, isHome });
          venueId = venue.id;
        } catch (e) {
          if (
            e instanceof ApiClientError &&
            e.status === 409 &&
            e.details &&
            typeof e.details === "object" &&
            "venue" in e.details
          ) {
            venueId = (e.details as { venue: Venue }).venue.id;
          } else {
            throw e;
          }
        }
        await mutate(SWR_KEYS.venues);
      } else {
        venueId = selectedVenueId as number;
      }

      const session = await createSession({ venueId, hasListeners });
      await Promise.all([
        mutate(SWR_KEYS.activeSession),
        mutate(SWR_KEYS.sessions),
      ]);
      onStarted?.(session);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        // ACTIVE 二重開始: 進行中セッションへ誘導
        toast.info("すでに進行中のセッションがあります", {
          description: "こちらの記録画面に切り替えます。",
        });
        await mutate(SWR_KEYS.activeSession);
        onOpenChange(false);
      } else {
        setError(
          e instanceof ApiClientError
            ? e.message
            : "セッションの開始に失敗しました",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl"
      >
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="text-lg font-semibold">
            セッションを開始
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {/* --- 既存店舗の選択 --- */}
          <div>
            <p className="text-sm font-medium">店舗を選択</p>
            {venues.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {venues.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => selectVenue(v.id)}
                      aria-pressed={selectedVenueId === v.id}
                      className={cn(
                        "flex min-h-10 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        selectedVenueId === v.id
                          ? "border-primary bg-muted"
                          : "border-border bg-card hover:bg-muted/50",
                      )}
                    >
                      <span className="flex-1 text-sm font-semibold">
                        {v.name}
                      </span>
                      {v.isHome ? <Badge variant="info">母店</Badge> : null}
                      {selectedVenueId === v.id ? (
                        <Badge variant="success">選択中</Badge>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                登録済みの店舗はまだありません。
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            または
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* --- 新規店舗 --- */}
          <div>
            <label htmlFor="new-venue" className="text-sm font-medium">
              新しい店舗名
            </label>
            <Input
              id="new-venue"
              className="mt-2 h-10"
              placeholder="新しい店舗名を入力…"
              value={newVenueName}
              onChange={(e) => changeName(e.target.value)}
              autoComplete="off"
            />
          </div>

          {/* --- 母店判定（criterion 2: 新規店舗名を入力した時のみ） --- */}
          {trimmedName.length > 0 ? (
            <div>
              <p className="text-sm font-medium">
                この店舗はいつも通っている母店ですか？
              </p>
              <Segment
                className="mt-2"
                ariaLabel="母店判定"
                options={[
                  { value: "home", label: "はい（母店）" },
                  { value: "not", label: "いいえ" },
                ]}
                value={isHome ? "home" : "not"}
                onChange={(v) => setIsHome(v === "home")}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                この設定はあとから「設定 &gt; 母店設定」で変更できます。
              </p>
            </div>
          ) : null}

          {/* --- リスナー客 --- */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">リスナー客</span>
            <Toggle
              ariaLabel="リスナー客の有無"
              value={hasListeners}
              onChange={setHasListeners}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            className="mt-2 h-10 w-full"
            disabled={!canStart || submitting}
            onClick={handleStart}
          >
            {trimmedName.length > 0 ? "この店舗で開始する" : "開始する"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
