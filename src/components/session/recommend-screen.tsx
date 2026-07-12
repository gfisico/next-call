"use client";

/**
 * 選曲支援・推薦結果画面（unit-06）。1 画面で「条件（上）→ 結果（下）」を上下に配置する。
 *
 * - 初期値は GET defaults（前回意図値・条件既定）。1曲目（suggestSeasonalOn=true）のとき
 *   季節感を推奨 ON で初期化する（ユーザーは OFF に変更可・仕様§9.7）。
 * - 「候補を出す」→ POST recommendations（二重実行防止 + 結果へ自動スクロール）。
 * - 「この曲をコール」/「コール」→ unit-05 の SongPerformanceSheet を
 *   mode="create" + initialSong 固定 + initialCalledByMe=true で開き、保存後セッション画面へ戻る。
 * - 保留曲枠は recommendation.pendingSongs（現在条件で再評価済みの警告）を情報源に常時表示する。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addPendingSong,
  ApiClientError,
  postRecommendation,
  removePendingSong,
} from "@/lib/api/client";
import { useRecommendationDefaults, useSession } from "@/lib/api/hooks";
import type {
  BeginnerCondition,
  ConditionalCandidateView,
  Genre,
  HornsCondition,
  PendingWarning,
  RecommendationCandidateView,
  RecommendationIntent,
  RecommendationRequestPayload,
  RecommendationResult,
  Song,
} from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IosSlider } from "@/components/ui/ios-slider";
import { Segment, type SegmentOption } from "./segment";
import { SongPerformanceSheet } from "./song-performance-sheet";

const NEUTRAL_INTENT: RecommendationIntent = {
  rare: 0,
  fresh: 0,
  safety: 0,
  mood: 0,
  ballad: 0,
  seasonal: false,
  listener: false,
};

const HORNS_OPTIONS: SegmentOption<HornsCondition>[] = [
  { value: "ONE", label: "1人" },
  { value: "MULTI", label: "複数" },
  { value: "UNKNOWN", label: "わからない" },
];

const BEGINNER_OPTIONS: SegmentOption<BeginnerCondition>[] = [
  { value: "NONE", label: "いない" },
  { value: "PRESENT", label: "いる" },
  { value: "UNKNOWN", label: "わからない" },
];

const KUROBON1_OPTIONS: SegmentOption<"false" | "true">[] = [
  { value: "false", label: "制限なし" },
  { value: "true", label: "黒本1曲載のみ" },
];

/** ジャンル上書きチップ（バラードは独立スライダー・「キメが多い曲」は UI 非対象） */
const GENRE_CHIPS: Genre[] = [
  "ボサノバ",
  "3拍子",
  "モード",
  "ファンク",
  "ブルース",
  "歌もの",
  "循環",
];

const PENDING_WARNING_LABEL: Record<PendingWarning, string> = {
  PLAYED_TODAY: "本日演奏済み",
  SAME_FORM: "直前と同じ構成",
  KUROBON1_MISMATCH: "黒本1条件外",
  FORMATION_MISMATCH: "編成に合いにくい",
};

/** セッション日付（YYYY-MM-DD）→ 季節ラベル（既定の月境界。season_months はサーバ非公開） */
function seasonLabel(sessionDate: string | undefined): string {
  if (!sessionDate) return "季節";
  const month = Number(sessionDate.slice(5, 7));
  if (month >= 3 && month <= 5) return "春";
  if (month >= 6 && month <= 8) return "夏";
  if (month >= 9 && month <= 11) return "秋";
  return "冬";
}

/** メタ行: key: {songKey} ・ {form} ・ {composer} */
function metaLine(song: Song): string {
  const parts = [`key: ${song.songKey ?? "—"}`, song.form];
  if (song.composer) parts.push(song.composer);
  return parts.join(" ・ ");
}

interface RecommendScreenProps {
  sessionId: number;
}

export function RecommendScreen({ sessionId }: RecommendScreenProps) {
  const router = useRouter();
  const { session, error: sessionError } = useSession(sessionId);
  const { defaults } = useRecommendationDefaults(sessionId);

  const [initialized, setInitialized] = useState(false);
  const [intent, setIntent] = useState<RecommendationIntent>(NEUTRAL_INTENT);
  const [horns, setHorns] = useState<HornsCondition>("UNKNOWN");
  const [beginner, setBeginner] = useState<BeginnerCondition>("UNKNOWN");
  const [kurobon1Only, setKurobon1Only] = useState(false);
  const [genreOverride, setGenreOverride] = useState<Genre[]>([]);
  const [genreOpen, setGenreOpen] = useState(false);

  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBusy, setPendingBusy] = useState<number[]>([]);
  const [callTarget, setCallTarget] = useState<{
    id: number;
    title: string;
  } | null>(null);

  const intentRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // defaults 到着時に一度だけ初期化（前回意図値の引き継ぎ + 1曲目の季節感推奨 ON）
  useEffect(() => {
    if (!defaults || initialized) return;
    setIntent({
      ...defaults.intent,
      seasonal: defaults.suggestSeasonalOn ? true : defaults.intent.seasonal,
    });
    setHorns(defaults.conditions.horns);
    setBeginner(defaults.conditions.beginner);
    setKurobon1Only(defaults.conditions.kurobon1Only);
    setGenreOverride(defaults.conditions.genreOverride);
    setInitialized(true);
  }, [defaults, initialized]);

  // 結果確定時に結果セクションへ自動スクロール（結果待ちの体感対策）
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [result]);

  if (sessionError) {
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

  const songNumber = session ? session.performances.length + 1 : null;
  const season = seasonLabel(session?.sessionDate);
  const setBusy = (id: number, busy: boolean) =>
    setPendingBusy((prev) =>
      busy ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
    );

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    // スケルトンが見えるよう結果領域へ移動
    requestAnimationFrame(() =>
      resultRef.current?.scrollIntoView({ behavior: "smooth" }),
    );
    const payload: RecommendationRequestPayload = {
      conditions: { horns, beginner },
      constraints: {
        kurobon1Only,
        genreOverride: genreOverride.length > 0 ? genreOverride : undefined,
      },
      intent,
    };
    try {
      const res = await postRecommendation(sessionId, payload);
      setResult(res);
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : "推薦の実行に失敗しました（通信エラー）",
      );
      toast.error("候補の取得に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReroll() {
    setResult(null);
    intentRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function openCall(song: Song) {
    setCallTarget({ id: song.id, title: song.title });
  }

  async function handleAddPending(song: Song) {
    setBusy(song.id, true);
    try {
      await addPendingSong(song.id);
      setResult((r) =>
        r
          ? {
              ...r,
              candidates: r.candidates.map((c) =>
                c.song.id === song.id ? { ...c, isPending: true } : c,
              ),
              pendingSongs: r.pendingSongs.some((p) => p.song.id === song.id)
                ? r.pendingSongs
                : [...r.pendingSongs, { song, warnings: [] }],
            }
          : r,
      );
    } catch {
      toast.error("保留への追加に失敗しました");
    } finally {
      setBusy(song.id, false);
    }
  }

  async function handleRemovePending(songId: number) {
    setBusy(songId, true);
    try {
      await removePendingSong(songId);
      setResult((r) =>
        r
          ? {
              ...r,
              candidates: r.candidates.map((c) =>
                c.song.id === songId ? { ...c, isPending: false } : c,
              ),
              pendingSongs: r.pendingSongs.filter((p) => p.song.id !== songId),
            }
          : r,
      );
    } catch {
      toast.error("保留解除に失敗しました");
    } finally {
      setBusy(songId, false);
    }
  }

  function toggleGenre(g: Genre) {
    setGenreOverride((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }

  return (
    <div className="pb-24">
      {/* --- ヘッダ --- */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link
            href={`/sessions/${sessionId}`}
            className="inline-flex items-center text-base font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            ‹ 次の曲を考える
          </Link>
          {session ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {session.venueName}
              {songNumber !== null ? ` ・ ${songNumber}曲目` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {/* --- 編成条件 --- */}
      <h2 className="mt-6 text-sm font-semibold">編成条件（次の1曲）</h2>
      <div className="mt-2 space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">管楽器</p>
          <Segment
            ariaLabel="管楽器"
            options={HORNS_OPTIONS}
            value={horns}
            onChange={setHorns}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">初心者</p>
          <Segment
            ariaLabel="初心者"
            options={BEGINNER_OPTIONS}
            value={beginner}
            onChange={setBeginner}
          />
        </div>
      </div>

      {/* --- 制約 --- */}
      <h2 className="mt-6 text-sm font-semibold">制約</h2>
      <div className="mt-2 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">黒本1</p>
        <Segment
          ariaLabel="黒本1"
          options={KUROBON1_OPTIONS}
          value={kurobon1Only ? "true" : "false"}
          onChange={(v) => setKurobon1Only(v === "true")}
        />
        <p className="text-xs text-muted-foreground">
          次の曲を選ぶ都度、変更できます。
        </p>
      </div>

      {/* --- ジャンル上書き（任意・折りたたみ） --- */}
      <div className="mt-3">
        <button
          type="button"
          aria-expanded={genreOpen}
          onClick={() => setGenreOpen((v) => !v)}
          className="flex min-h-10 w-full items-center justify-between rounded-lg border border-border px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>
            ジャンル上書き（任意）
            {genreOverride.length > 0 ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {genreOverride.length} 件
              </span>
            ) : null}
          </span>
          <span aria-hidden="true">{genreOpen ? "▾" : "▸"}</span>
        </button>
        {genreOpen ? (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {GENRE_CHIPS.map((g) => {
                const on = genreOverride.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleGenre(g)}
                    className={
                      on
                        ? "inline-flex h-10 items-center rounded-full border border-border bg-muted px-3 text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : "inline-flex h-10 items-center rounded-full border border-border bg-background px-3 text-xs text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                    }
                  >
                    {g}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              指定すると該当ジャンルを<strong className="font-semibold">強く優先</strong>
              します（絞り込みではありません）。複数選択可。バラードは下のスライダーで指定します。
            </p>
          </div>
        ) : null}
      </div>

      {/* --- 今回の意図 --- */}
      <h2 ref={intentRef} className="mt-6 scroll-mt-4 text-sm font-semibold">
        今回の意図
      </h2>
      <div className="mt-2 space-y-3">
        <IosSlider
          name="珍しい曲"
          leftLabel="強い減点"
          rightLabel="強い加点"
          value={intent.rare}
          onChange={(v) => setIntent((p) => ({ ...p, rare: v }))}
        />
        <IosSlider
          name="久しぶりの曲"
          leftLabel="強い減点"
          rightLabel="強い加点"
          value={intent.fresh}
          onChange={(v) => setIntent((p) => ({ ...p, fresh: v }))}
        />
        <IosSlider
          name="攻め方"
          leftLabel="安全に行く"
          rightLabel="攻める"
          value={intent.safety}
          onChange={(v) => setIntent((p) => ({ ...p, safety: v }))}
        />
        <IosSlider
          name="場の温度"
          leftLabel="落ち着かせる"
          rightLabel="盛り上げる"
          value={intent.mood}
          onChange={(v) => setIntent((p) => ({ ...p, mood: v }))}
        />
        <IosSlider
          name="バラード"
          leftLabel="避けたい"
          rightLabel="やりたい"
          value={intent.ballad}
          onChange={(v) => setIntent((p) => ({ ...p, ballad: v }))}
        />
      </div>

      {/* --- チェック --- */}
      <div className="mt-3 space-y-1">
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <Checkbox
            checked={intent.seasonal}
            onCheckedChange={(v) =>
              setIntent((p) => ({ ...p, seasonal: v === true }))
            }
          />
          <span>季節感（{season}の曲を重視）</span>
          {defaults?.suggestSeasonalOn ? (
            <Badge variant="info">推奨</Badge>
          ) : null}
        </label>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <Checkbox
            checked={intent.listener}
            onCheckedChange={(v) =>
              setIntent((p) => ({ ...p, listener: v === true }))
            }
          />
          <span>リスナー受けを重視</span>
        </label>
        <p className="text-xs text-muted-foreground">
          季節ラベルはセッション日付から自動表示（季節は選べません）。
        </p>
      </div>

      {/* --- 結果セクション --- */}
      {submitting || result ? (
        <section ref={resultRef} className="mt-6 scroll-mt-4">
          <div className="-mx-4 mb-4 border-t border-border" />
          {submitting ? (
            <ResultsSkeleton />
          ) : result ? (
            <ResultsView
              result={result}
              pendingBusy={pendingBusy}
              onCall={openCall}
              onAddPending={handleAddPending}
              onRemovePending={handleRemovePending}
            />
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* --- 下部固定バー --- */}
      <div className="fixed inset-x-0 bottom-14 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          {result ? (
            <Button
              type="button"
              variant="secondary"
              className="h-10 w-full"
              onClick={handleReroll}
            >
              条件を変えて再抽選
            </Button>
          ) : (
            <Button
              type="button"
              className="h-10 w-full"
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting ? "候補を出す…" : "候補を出す"}
            </Button>
          )}
        </div>
      </div>

      {/* --- コール登録シート（unit-05 再利用・曲確定 + calledByMe=true） --- */}
      {callTarget ? (
        <SongPerformanceSheet
          key={callTarget.id}
          sessionId={sessionId}
          mode="create"
          initialSong={callTarget}
          initialCalledByMe={true}
          open={true}
          onOpenChange={(o) => {
            if (!o) setCallTarget(null);
          }}
          onSaved={() => {
            router.push(`/sessions/${sessionId}`);
          }}
        />
      ) : null}
    </div>
  );
}

/** 結果待ちスケルトン（二重実行防止のボタン無効化と併用） */
function ResultsSkeleton() {
  return (
    <div>
      <p className="text-sm font-medium">候補</p>
      <div className="mt-2 space-y-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-border bg-muted/50"
          />
        ))}
      </div>
    </div>
  );
}

interface ResultsViewProps {
  result: RecommendationResult;
  pendingBusy: number[];
  onCall: (song: Song) => void;
  onAddPending: (song: Song) => void;
  onRemovePending: (songId: number) => void;
}

function ResultsView({
  result,
  pendingBusy,
  onCall,
  onAddPending,
  onRemovePending,
}: ResultsViewProps) {
  return (
    <div className="space-y-6">
      {/* --- 通常候補 --- */}
      <div>
        <p className="text-sm font-medium">候補（{result.candidates.length}曲）</p>
        {result.isSparse ? (
          <div className="mt-2 rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 text-xs leading-5 text-sky-700 dark:text-sky-300">
            条件が強く、候補が{result.candidates.length}
            曲に絞られました。条件を緩めるとさらに提案できます。
          </div>
        ) : null}
        {result.candidates.length === 0 && !result.isSparse ? (
          <p className="mt-2 text-sm text-muted-foreground">
            候補がありませんでした。条件を緩めてお試しください。
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {result.candidates.map((c) => (
              <CandidateCard
                key={c.song.id}
                candidate={c}
                busy={pendingBusy.includes(c.song.id)}
                onCall={onCall}
                onAddPending={onAddPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* --- 条件別候補（存在時のみ） --- */}
      {result.conditionalCandidates.length > 0 ? (
        <div>
          <p className="text-sm font-medium">条件別候補</p>
          <div className="mt-2 space-y-2">
            {result.conditionalCandidates.map((c) => (
              <ConditionalCard
                key={`${c.branch}-${c.song.id}`}
                candidate={c}
                busy={pendingBusy.includes(c.song.id)}
                onCall={onCall}
                onAddPending={onAddPending}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* --- 保留曲枠（常時表示・条件に関係なく全件） --- */}
      <div>
        <p className="text-sm font-medium">
          保留中の曲（{result.pendingSongs.length}曲）
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          条件に関係なく、保留中の曲をすべて表示します。
        </p>
        {result.pendingSongs.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            保留中の曲はありません。
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {result.pendingSongs.map((p) => (
              <div
                key={p.song.id}
                className="rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-base font-semibold">
                    {p.song.title}
                  </span>
                  {p.warnings.map((w) => (
                    <Badge key={w} variant="warning">
                      {PENDING_WARNING_LABEL[w]}
                    </Badge>
                  ))}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {metaLine(p.song)}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 flex-1"
                    onClick={() => onCall(p.song)}
                  >
                    コール
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 flex-1"
                    disabled={pendingBusy.includes(p.song.id)}
                    onClick={() => onRemovePending(p.song.id)}
                  >
                    保留解除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface CandidateCardProps {
  candidate: RecommendationCandidateView;
  busy: boolean;
  onCall: (song: Song) => void;
  onAddPending: (song: Song) => void;
}

function CandidateCard({
  candidate,
  busy,
  onCall,
  onAddPending,
}: CandidateCardProps) {
  const { song, reasons, isPending } = candidate;
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-base font-semibold">{song.title}</span>
        {isPending ? <Badge variant="warning">保留中</Badge> : null}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{metaLine(song)}</p>
      <ul className="mt-2 space-y-0.5 text-xs leading-5 text-foreground/80">
        {reasons.map((r, i) => (
          <li key={`${r.code}-${i}`} className="flex gap-1">
            <span aria-hidden="true" className="text-muted-foreground">
              ・
            </span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-10 flex-1"
          onClick={() => onCall(song)}
        >
          この曲をコール
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-10 flex-1"
          disabled={isPending || busy}
          onClick={() => onAddPending(song)}
        >
          保留に追加
        </Button>
      </div>
    </div>
  );
}

interface ConditionalCardProps {
  candidate: ConditionalCandidateView;
  busy: boolean;
  onCall: (song: Song) => void;
  onAddPending: (song: Song) => void;
}

function ConditionalCard({
  candidate,
  busy,
  onCall,
  onAddPending,
}: ConditionalCardProps) {
  const { song, reasons, conditionLabel } = candidate;
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 text-card-foreground shadow-sm">
      <Badge variant="info">{conditionLabel}</Badge>
      <p className="mt-1 text-sm font-semibold">{song.title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{metaLine(song)}</p>
      <ul className="mt-2 space-y-0.5 text-xs leading-5 text-foreground/80">
        {reasons.map((r, i) => (
          <li key={`${r.code}-${i}`} className="flex gap-1">
            <span aria-hidden="true" className="text-muted-foreground">
              ・
            </span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-10 flex-1"
          onClick={() => onCall(song)}
        >
          この曲をコール
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-10 flex-1"
          disabled={busy}
          onClick={() => onAddPending(song)}
        >
          保留に追加
        </Button>
      </div>
    </div>
  );
}
