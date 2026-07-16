"use client";

/**
 * 曲順編集シート（unit-03 要件3）。
 * 各行の △▽ ボタンでローカル順序を編集し、明示「並び順を保存」で
 * PATCH /api/sessions/:id/performances/order（performance.id の新しい並び）を呼ぶ。
 * ドラッグではなく上下ボタン方式（design_rule §8.3 タップ領域・キーボード到達性）。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { ApiClientError, reorderPerformances } from "@/lib/api/client";
import { SWR_KEYS } from "@/lib/api/hooks";
import type { PerformanceWithFront } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface SetlistReorderProps {
  sessionId: number;
  performances: PerformanceWithFront[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function SetlistReorder({
  sessionId,
  performances,
  open,
  onOpenChange,
  onSaved,
}: SetlistReorderProps) {
  const { mutate } = useSWRConfig();
  const [order, setOrder] = useState<PerformanceWithFront[]>(performances);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // シートを開くたびに現在の並びで初期化する（保存前のローカル編集のみ）
  useEffect(() => {
    if (open) {
      setOrder(performances);
      setError(null);
    }
  }, [open, performances]);

  function move(index: number, dir: -1 | 1) {
    setError(null);
    setOrder((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await reorderPerformances(
        sessionId,
        order.map((p) => p.id),
      );
      await Promise.all([mutate(SWR_KEYS.sessions)]);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "並び順の保存に失敗しました",
      );
      toast.error("並び順の保存に失敗しました");
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
          <SheetTitle className="text-lg font-semibold">曲順を編集</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <ol className="space-y-2">
            {order.map((p, i) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-border bg-card p-3"
              >
                <span className="w-6 shrink-0 text-right text-sm text-muted-foreground">
                  {i + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {p.songTitle}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  aria-label={`${i + 1}番目を上へ`}
                  disabled={i === 0 || saving}
                  onClick={() => move(i, -1)}
                >
                  <span aria-hidden="true">△</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  aria-label={`${i + 1}番目を下へ`}
                  disabled={i === order.length - 1 || saving}
                  onClick={() => move(i, 1)}
                >
                  <span aria-hidden="true">▽</span>
                </Button>
              </li>
            ))}
          </ol>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            className="h-10 w-full"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "保存中…" : "並び順を保存"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
