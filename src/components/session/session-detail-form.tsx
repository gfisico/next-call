"use client";

/**
 * セッション詳細記録シート（unit-03 要件7=参加者/リスナー/ホスト/メモ）。
 * - パート別参加者数（楽器マスタから行追加 + 人数）
 * - リスナー数
 * - ホストパート（楽器マスタから選択・なし可）
 * - セッションメモ
 * 保存: 参加者/リスナー/ホストは PUT /api/sessions/:id/participants、
 * メモ（note）は PATCH /api/sessions/:id を 1 保存操作で順に呼ぶ。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import {
  ApiClientError,
  patchSession,
  putSessionParticipants,
} from "@/lib/api/client";
import { SWR_KEYS, useInstruments } from "@/lib/api/hooks";
import type { SessionDetail, SessionParticipant } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface SessionDetailFormProps {
  session: SessionDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const SELECT_CLASS =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

export function SessionDetailForm({
  session,
  open,
  onOpenChange,
  onSaved,
}: SessionDetailFormProps) {
  const { instruments } = useInstruments();
  const { mutate } = useSWRConfig();

  const [participants, setParticipants] = useState<SessionParticipant[]>(
    session.participants,
  );
  const [listenerCount, setListenerCount] = useState<number>(
    session.listenerCount ?? 0,
  );
  const [hostCode, setHostCode] = useState<string>(
    session.hostInstrumentCode ?? "",
  );
  const [note, setNote] = useState<string>(session.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // シートを開くたびにセッションの現在値へ復元する（再表示で反映）
  useEffect(() => {
    if (open) {
      setParticipants(session.participants);
      setListenerCount(session.listenerCount ?? 0);
      setHostCode(session.hostInstrumentCode ?? "");
      setNote(session.note ?? "");
      setError(null);
    }
  }, [open, session]);

  const usedCodes = new Set(participants.map((p) => p.instrumentCode));
  const addable = instruments.filter((i) => !usedCodes.has(i.code));

  function labelFor(code: string): string {
    return instruments.find((i) => i.code === code)?.label ?? code;
  }

  function addParticipant(code: string) {
    if (code === "" || usedCodes.has(code)) return;
    setParticipants((prev) => [...prev, { instrumentCode: code, count: 1 }]);
    setError(null);
  }

  function setCount(code: string, count: number) {
    setParticipants((prev) =>
      prev.map((p) => (p.instrumentCode === code ? { ...p, count } : p)),
    );
  }

  function removeParticipant(code: string) {
    setParticipants((prev) =>
      prev.filter((p) => p.instrumentCode !== code),
    );
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await putSessionParticipants(session.id, {
        participants,
        listenerCount,
        hostInstrumentCode: hostCode === "" ? null : hostCode,
      });
      const nextNote = note.trim() === "" ? null : note;
      if (nextNote !== session.note) {
        await patchSession(session.id, { note: nextNote });
      }
      await Promise.all([
        mutate(SWR_KEYS.sessions),
        mutate(SWR_KEYS.activeSession),
      ]);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "詳細の保存に失敗しました",
      );
      toast.error("詳細の保存に失敗しました");
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
          <SheetTitle className="text-lg font-semibold">詳細を記録</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-4">
          {/* --- パート別参加者数 --- */}
          <div>
            <p className="text-sm font-medium">パート別参加者数</p>
            {participants.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {participants.map((p) => (
                  <li
                    key={p.instrumentCode}
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {labelFor(p.instrumentCode)}
                    </span>
                    <label className="sr-only" htmlFor={`count-${p.instrumentCode}`}>
                      {labelFor(p.instrumentCode)} の人数
                    </label>
                    <input
                      id={`count-${p.instrumentCode}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={p.count}
                      aria-label={`${labelFor(p.instrumentCode)} の人数`}
                      onChange={(e) =>
                        setCount(
                          p.instrumentCode,
                          Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        )
                      }
                      className="h-10 w-20 shrink-0 rounded-lg border border-input bg-background px-2.5 text-right text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      aria-label={`${labelFor(p.instrumentCode)} を削除`}
                      onClick={() => removeParticipant(p.instrumentCode)}
                    >
                      <span aria-hidden="true" className="text-lg">
                        ×
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                参加パートを追加してください。
              </p>
            )}
            <div className="mt-2">
              <label htmlFor="add-participant" className="sr-only">
                参加パートを追加
              </label>
              <select
                id="add-participant"
                aria-label="参加パートを追加"
                className={`${SELECT_CLASS} w-full`}
                value=""
                disabled={addable.length === 0}
                onChange={(e) => addParticipant(e.target.value)}
              >
                <option value="">＋ 参加パートを追加…</option>
                {addable.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* --- リスナー数 --- */}
          <NumberField
            label="リスナー客数"
            value={listenerCount}
            min={0}
            onChange={setListenerCount}
          />

          {/* --- ホストパート --- */}
          <div className="grid gap-2">
            <label htmlFor="host-code" className="text-sm font-medium">
              ホストパート
            </label>
            <select
              id="host-code"
              aria-label="ホストパート"
              className={SELECT_CLASS}
              value={hostCode}
              onChange={(e) => setHostCode(e.target.value)}
            >
              <option value="">なし</option>
              {instruments.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>

          {/* --- セッションメモ --- */}
          <div className="grid gap-2">
            <label htmlFor="session-note" className="text-sm font-medium">
              セッションメモ
            </label>
            <textarea
              id="session-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

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
            {saving ? "保存中…" : "詳細を保存"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
