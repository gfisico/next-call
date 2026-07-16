"use client";

/**
 * セッション情報編集シート（unit-03 要件5=日付・店舗）。
 * 日付は <input type="date">、店舗は既存 Venue から選択。
 * 保存で PATCH /api/sessions/:id（{ sessionDate, venueId }）。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { ApiClientError, patchSession } from "@/lib/api/client";
import { SWR_KEYS, useVenues } from "@/lib/api/hooks";
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

interface SessionEditSheetProps {
  sessionId: number;
  initialDate: string;
  initialVenueId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function SessionEditSheet({
  sessionId,
  initialDate,
  initialVenueId,
  open,
  onOpenChange,
  onSaved,
}: SessionEditSheetProps) {
  const { venues } = useVenues();
  const { mutate } = useSWRConfig();

  const [date, setDate] = useState(initialDate);
  const [venueId, setVenueId] = useState(initialVenueId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDate(initialDate);
      setVenueId(initialVenueId);
      setError(null);
    }
  }, [open, initialDate, initialVenueId]);

  const canSave = date.trim() !== "" && venueId > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await patchSession(sessionId, { sessionDate: date, venueId });
      await Promise.all([
        mutate(SWR_KEYS.sessions),
        mutate(SWR_KEYS.activeSession),
      ]);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "セッションの更新に失敗しました",
      );
      toast.error("セッションの更新に失敗しました");
    } finally {
      setSaving(false);
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
            セッション情報を編集
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <div className="grid gap-2">
            <label htmlFor="session-date" className="text-sm font-medium">
              セッション日
            </label>
            <Input
              id="session-date"
              type="date"
              className="h-10"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setError(null);
              }}
            />
          </div>

          <div>
            <p className="text-sm font-medium">店舗</p>
            {venues.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {venues.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setVenueId(v.id);
                        setError(null);
                      }}
                      aria-pressed={venueId === v.id}
                      className={cn(
                        "flex min-h-10 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        venueId === v.id
                          ? "border-primary bg-muted"
                          : "border-border bg-card hover:bg-muted/50",
                      )}
                    >
                      <span className="flex-1 text-sm font-semibold">
                        {v.name}
                      </span>
                      {v.isHome ? <Badge variant="info">母店</Badge> : null}
                      {venueId === v.id ? (
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

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            className="h-10 w-full"
            disabled={!canSave || saving}
            onClick={handleSave}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
