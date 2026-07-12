"use client";

/**
 * 曲追加/編集シート（unit-05 の中核・unit-06 再利用契約）。
 *
 * unit-06 は「この曲をコール」から initialSong 固定 + initialCalledByMe=true で本シートを再利用する。
 * その場合、曲名検索 UI は表示せず選択済み表示になる（criterion 7）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addPerformance,
  ApiClientError,
  quickCreateSong,
  updatePerformance,
} from "@/lib/api/client";
import { useInstruments, useSongSearch } from "@/lib/api/hooks";
import type {
  FrontInstrument,
  ParticipationInstrument,
  PerformanceWithFront,
  Song,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Segment, type SegmentOption } from "./segment";

/** 参加セグメントの値。NONE=不参加, SAX/PIANO=参加+担当楽器 */
type ParticipationChoice = "NONE" | "SAX" | "PIANO";

const PARTICIPATION_OPTIONS: SegmentOption<ParticipationChoice>[] = [
  { value: "NONE", label: "不参加" },
  { value: "SAX", label: "サックス" },
  { value: "PIANO", label: "ピアノ" },
];

interface SelectedSong {
  id: number;
  title: string;
  songKey?: string | null;
  form?: string;
  needsReview?: boolean;
}

export interface SongPerformanceSheetProps {
  sessionId: number;
  mode: "create" | "edit";
  /** edit 時のみ必須 */
  performanceId?: number;
  /** 固定曲（渡された場合は検索 UI を出さず選択済み表示。unit-06 の「この曲をコール」） */
  initialSong?: { id: number; title: string };
  initialCalledByMe?: boolean;
  initialInstrument?: ParticipationInstrument;
  initialParticipated?: boolean;
  initialFrontInstruments?: FrontInstrument[];
  initialNoChart?: boolean;
  initialNote?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (performance: PerformanceWithFront) => void;
  onQuickCreated?: (song: Song) => void;
}

function deriveChoice(
  participated: boolean | undefined,
  instrument: ParticipationInstrument | undefined,
): ParticipationChoice {
  if (participated === false) return "NONE";
  if (instrument === "PIANO") return "PIANO";
  if (instrument === "NONE") return participated ? "SAX" : "NONE";
  return instrument ?? "SAX";
}

export function SongPerformanceSheet({
  sessionId,
  mode,
  performanceId,
  initialSong,
  initialCalledByMe = false,
  initialInstrument = "SAX",
  initialParticipated,
  initialFrontInstruments,
  initialNoChart = false,
  initialNote = null,
  open,
  onOpenChange,
  onSaved,
  onQuickCreated,
}: SongPerformanceSheetProps) {
  const fixedSong = initialSong ?? null;

  const [selectedSong, setSelectedSong] = useState<SelectedSong | null>(
    initialSong ? { id: initialSong.id, title: initialSong.title } : null,
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [choice, setChoice] = useState<ParticipationChoice>(
    deriveChoice(initialParticipated, initialInstrument),
  );
  const [calledByMe, setCalledByMe] = useState(initialCalledByMe);
  const [noChart, setNoChart] = useState(initialNoChart);
  const [front, setFront] = useState<string[]>(
    initialFrontInstruments
      ? [...initialFrontInstruments]
          .sort((a, b) => a.position - b.position)
          .map((f) => f.code)
      : [],
  );
  const [note, setNote] = useState(initialNote ?? "");
  const [frontOpen, setFrontOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quickPending, setQuickPending] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  const { songs, query, isValidating } = useSongSearch(searchTerm);
  const { instruments } = useInstruments();

  const noHits =
    !fixedSong &&
    query.length > 0 &&
    !isValidating &&
    songs.length === 0;

  // 開いた時点の初期状態に戻す（連続追加リセット / シート再オープン時のリセットで共用）
  const resetToInitial = useCallback(() => {
    setSelectedSong(
      initialSong ? { id: initialSong.id, title: initialSong.title } : null,
    );
    setSearchTerm("");
    setChoice(deriveChoice(initialParticipated, initialInstrument));
    setCalledByMe(initialCalledByMe);
    setNoChart(initialNoChart);
    setFront(
      initialFrontInstruments
        ? [...initialFrontInstruments]
            .sort((a, b) => a.position - b.position)
            .map((f) => f.code)
        : [],
    );
    setNote(initialNote ?? "");
    setFrontOpen(false);
    setSaveError(null);
    setQuickError(null);
  }, [
    initialSong,
    initialParticipated,
    initialInstrument,
    initialCalledByMe,
    initialNoChart,
    initialFrontInstruments,
    initialNote,
  ]);

  // シートが閉→開に変わったら初期状態へリセットする（インスタンス再利用でも stale を残さない）。
  // 初回マウント（open=true 直接レンダ）は初期化子の値を尊重するためリセットしない。
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) resetToInitial();
    prevOpen.current = open;
  }, [open, resetToInitial]);

  async function handleQuickRegister() {
    setQuickPending(true);
    setQuickError(null);
    try {
      const song = await quickCreateSong(query);
      setSelectedSong({
        id: song.id,
        title: song.title,
        songKey: song.songKey,
        form: song.form,
        needsReview: song.needsReview,
      });
      onQuickCreated?.(song);
    } catch (e) {
      // 正規化同名の既存曲は 409 + details.song → そのまま選択状態に流用（criterion 4 の一連性）
      if (
        e instanceof ApiClientError &&
        e.status === 409 &&
        e.details &&
        typeof e.details === "object" &&
        "song" in e.details
      ) {
        const existing = (e.details as { song: Song }).song;
        setSelectedSong({
          id: existing.id,
          title: existing.title,
          songKey: existing.songKey,
          form: existing.form,
          needsReview: existing.needsReview,
        });
      } else {
        setQuickError(
          e instanceof ApiClientError ? e.message : "登録に失敗しました",
        );
      }
    } finally {
      setQuickPending(false);
    }
  }

  async function doSave(closeAfter: boolean) {
    if (!selectedSong || submitting) return;
    setSubmitting(true);
    setSaveError(null);

    const participated = choice !== "NONE";
    const instrument: ParticipationInstrument =
      choice === "NONE" ? "NONE" : choice;
    const frontInstruments: FrontInstrument[] = front.map((code, index) => ({
      code,
      position: index,
    }));
    const trimmedNote = note.trim();

    try {
      let performance: PerformanceWithFront;
      if (mode === "edit" && performanceId !== undefined) {
        performance = await updatePerformance(performanceId, {
          participated,
          instrument,
          calledByMe,
          noChart,
          note: trimmedNote ? trimmedNote : null,
          frontInstruments,
        });
      } else {
        performance = await addPerformance(sessionId, {
          songId: selectedSong.id,
          participated,
          instrument,
          calledByMe,
          noChart,
          note: trimmedNote ? trimmedNote : null,
          frontInstruments,
        });
      }
      onSaved?.(performance);
      if (closeAfter) {
        onOpenChange(false);
      } else {
        resetToInitial();
      }
    } catch (e) {
      // 送信失敗: 入力値は保持したままエラー表示（criterion 5）
      setSaveError(
        e instanceof ApiClientError
          ? e.message
          : "保存に失敗しました（通信エラー）",
      );
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
            {mode === "edit" ? "演奏記録を編集" : "曲を追加"}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {/* --- 曲名（固定曲でない場合は検索 UI） --- */}
          {fixedSong ? (
            <div>
              <p className="text-sm font-medium">曲名</p>
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3">
                <span className="flex-1 text-sm font-semibold">
                  {selectedSong?.title}
                </span>
                <Badge variant="success">選択中</Badge>
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="song-search" className="text-sm font-medium">
                曲名
              </label>
              <Input
                id="song-search"
                className="mt-2 h-10"
                placeholder="曲名で検索…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                インクリメンタル検索（title 部分一致・debounce 250ms）。候補をタップで選択。
              </p>

              {/* 選択中の曲 */}
              {selectedSong ? (
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3">
                  <span className="flex-1 text-sm font-semibold">
                    {selectedSong.title}
                    {selectedSong.songKey ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        key: {selectedSong.songKey}
                        {selectedSong.form ? ` ・ ${selectedSong.form}` : ""}
                      </span>
                    ) : null}
                  </span>
                  {selectedSong.needsReview ? (
                    <Badge variant="warning">属性未整備</Badge>
                  ) : null}
                  <Badge variant="success">選択中</Badge>
                </div>
              ) : null}

              {/* 検索候補 */}
              {songs.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {songs.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedSong({
                            id: s.id,
                            title: s.title,
                            songKey: s.songKey,
                            form: s.form,
                            needsReview: s.needsReview,
                          })
                        }
                        aria-pressed={selectedSong?.id === s.id}
                        className={cn(
                          "flex min-h-10 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left outline-none transition-colors",
                          "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <span className="flex-1 text-sm font-medium">
                          {s.title}
                          {s.songKey ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              key: {s.songKey} ・ {s.form}
                            </span>
                          ) : null}
                        </span>
                        {s.needsReview ? (
                          <Badge variant="warning">属性未整備</Badge>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* ヒットなし → クイック登録 */}
              {noHits ? (
                <div className="mt-2 space-y-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    一致する曲が見つかりません
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 w-full"
                    disabled={quickPending}
                    onClick={handleQuickRegister}
                  >
                    「{query}」を新規登録
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    クイック登録: 曲名のみで曲マスターに作成（属性未整備）。あとで「マスター」画面から属性を整備できます。
                  </p>
                  {quickError ? (
                    <p className="text-xs text-destructive">{quickError}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {/* --- 自分の参加 --- */}
          <div>
            <p className="text-sm font-medium">自分の参加</p>
            <Segment
              className="mt-2"
              ariaLabel="自分の参加"
              options={PARTICIPATION_OPTIONS}
              value={choice}
              onChange={setChoice}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              既定=サックス。必須入力は曲名のみ（他は既定値のまま保存可）。
            </p>
          </div>

          {/* --- チェック --- */}
          <div className="space-y-1">
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <Checkbox
                checked={calledByMe}
                onCheckedChange={(v) => setCalledByMe(v === true)}
              />
              自分がコールした
            </label>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <Checkbox
                checked={noChart}
                onCheckedChange={(v) => setNoChart(v === true)}
              />
              譜面なしだった
            </label>
          </div>

          {/* --- フロント編成（任意・折りたたみ） --- */}
          <div>
            <button
              type="button"
              aria-expanded={frontOpen}
              onClick={() => setFrontOpen((v) => !v)}
              className="flex min-h-10 w-full items-center justify-between rounded-lg text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>
                フロント編成（任意）
                {front.length > 0 ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {front.length} 件
                  </span>
                ) : null}
              </span>
              <span aria-hidden="true">{frontOpen ? "▾" : "▸"}</span>
            </button>

            {frontOpen ? (
              <div className="mt-2 space-y-2">
                {front.length > 0 ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      選択済み（追加順 = position。タップで削除）:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {front.map((code, index) => (
                        <button
                          key={`${code}-${index}`}
                          type="button"
                          aria-label={`${index + 1}. ${code} を削除`}
                          onClick={() =>
                            setFront((prev) =>
                              prev.filter((_, i) => i !== index),
                            )
                          }
                          className="inline-flex h-10 items-center gap-1 rounded-full border border-border bg-muted px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {index + 1}. {code} ✕
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  楽器コードをタップで順に追加（同一楽器の複数追加可）:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {instruments.map((ins) => (
                    <button
                      key={ins.code}
                      type="button"
                      aria-label={`${ins.code} を追加`}
                      onClick={() => setFront((prev) => [...prev, ins.code])}
                      className="inline-flex h-10 items-center rounded-full border border-border bg-background px-3 text-xs outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {ins.code}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* --- メモ --- */}
          <div>
            <label htmlFor="perf-note" className="text-sm font-medium">
              メモ（任意）
            </label>
            <textarea
              id="perf-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例: テンポ速め、2管でハモった…"
              rows={2}
              className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* --- 送信失敗（入力保持 + リトライ） --- */}
          {saveError ? (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <p className="font-semibold">保存に失敗しました</p>
              <p className="text-xs">
                {saveError} 入力内容は保持されています。もう一度お試しください。
              </p>
              <Button
                type="button"
                variant="secondary"
                className="h-10"
                disabled={submitting}
                onClick={() => doSave(true)}
              >
                リトライ
              </Button>
            </div>
          ) : null}

          {/* --- フッタ --- */}
          <div className="flex gap-2 pt-1">
            {mode === "create" ? (
              <Button
                type="button"
                variant="secondary"
                className="h-10 flex-1"
                disabled={!selectedSong || submitting}
                onClick={() => doSave(false)}
              >
                保存して次へ
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-10 flex-1"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                キャンセル
              </Button>
            )}
            {/* シートは overlay の独立コンテキスト → 記録画面本体の Primary と両立可 */}
            <Button
              type="button"
              className="h-10 flex-1"
              disabled={!selectedSong || submitting}
              onClick={() => doSave(true)}
            >
              保存
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
