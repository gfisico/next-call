"use client";

/**
 * メモ一括移行 UI（unit-03 要件7）。
 * 貼付 → preview（解析）→ 解決済み/要確認(needsReview)/警告(warnings) を表示 →
 * ユーザー補正（venue existing/new・曲 match/create_stub・日付欠落補完）→ commit。
 * commit は補正済みペイロードのみ送る（テキストは送らない＝サーバは再パースしない）。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import {
  ApiClientError,
  commitMemoImport,
  previewMemoImport,
} from "@/lib/api/client";
import { SWR_KEYS, useVenues } from "@/lib/api/hooks";
import type {
  MemoCommitSession,
  MemoCommitSongRef,
  MemoCommitVenueRef,
  MemoPreviewResult,
} from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SessionCorrection {
  date: string;
  venue: MemoCommitVenueRef;
  songs: MemoCommitSongRef[];
}

const SELECT_CLASS =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

function initCorrections(preview: MemoPreviewResult): SessionCorrection[] {
  return preview.sessions.map((s) => ({
    date: s.date ?? "",
    venue:
      s.venueMatch.kind === "existing"
        ? { kind: "existing", id: s.venueMatch.id }
        : { kind: "new", name: s.venueName ?? "", isHome: false },
    songs: s.songs.map((song) =>
      song.songMatch.kind === "existing"
        ? { kind: "existing", id: song.songMatch.id }
        : { kind: "new", title: song.title, needsReview: true },
    ),
  }));
}

export function MemoImport() {
  const router = useRouter();
  const { venues } = useVenues();
  const { mutate } = useSWRConfig();

  const [text, setText] = useState("");
  const [preview, setPreview] = useState<MemoPreviewResult | null>(null);
  const [corrections, setCorrections] = useState<SessionCorrection[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    if (text.trim() === "" || previewing) return;
    setPreviewing(true);
    setError(null);
    try {
      const result = await previewMemoImport(text);
      setPreview(result);
      setCorrections(initCorrections(result));
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "プレビューに失敗しました",
      );
    } finally {
      setPreviewing(false);
    }
  }

  function updateCorrection(index: number, patch: Partial<SessionCorrection>) {
    setCorrections((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  }

  function updateSongRef(
    sessionIndex: number,
    songIndex: number,
    ref: MemoCommitSongRef,
  ) {
    setCorrections((prev) =>
      prev.map((c, i) =>
        i === sessionIndex
          ? { ...c, songs: c.songs.map((s, j) => (j === songIndex ? ref : s)) }
          : c,
      ),
    );
  }

  function buildCommitSessions(): MemoCommitSession[] | null {
    if (!preview) return null;
    const sessions: MemoCommitSession[] = [];
    for (let i = 0; i < preview.sessions.length; i++) {
      const s = preview.sessions[i];
      const c = corrections[i];
      if (c.date.trim() === "") {
        setError(`${i + 1} 件目: セッション日を入力してください`);
        return null;
      }
      if (c.venue.kind === "new" && c.venue.name.trim() === "") {
        setError(`${i + 1} 件目: 店舗名を入力してください`);
        return null;
      }
      sessions.push({
        sessionDate: c.date,
        venue: c.venue,
        hostInstrumentCode: s.host?.code ?? null,
        participants: s.participants.map((p) => ({
          instrumentCode: p.code,
          count: p.count,
        })),
        performances: s.songs.map((song, j) => ({
          order: song.order,
          songRef: c.songs[j],
          frontInstruments: song.front.map((f) => f.code),
          participated: song.played,
          instrument: song.instrument,
          calledByMe: song.calledByMe,
          noChart: false,
          note: song.note,
        })),
      });
    }
    return sessions;
  }

  async function handleCommit() {
    if (committing) return;
    setError(null);
    const sessions = buildCommitSessions();
    if (!sessions) return;
    setCommitting(true);
    try {
      const summary = await commitMemoImport({ sessions });
      await mutate(SWR_KEYS.sessions);
      toast.success("メモを取り込みました", {
        description: `セッション ${summary.sessionsCreated} 件・演奏 ${summary.performancesCreated} 件を作成しました`,
      });
      router.push("/sessions");
    } catch (e) {
      const msg =
        e instanceof ApiClientError ? e.message : "取込に失敗しました";
      setError(msg);
      toast.error(msg);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* --- 貼付 --- */}
      <div className="grid gap-2">
        <label htmlFor="memo-text" className="text-sm font-medium">
          セッションメモを貼り付け
        </label>
        <textarea
          id="memo-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="日付・店舗・曲順などを含むメモを貼り付けてください…"
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button
          type="button"
          variant="secondary"
          className="h-10 w-full"
          disabled={text.trim() === "" || previewing}
          onClick={handlePreview}
        >
          {previewing ? "解析中…" : "プレビュー"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* --- プレビュー --- */}
      {preview ? (
        <div className="space-y-4">
          {preview.warnings.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {preview.warnings.map((w, i) => (
                <Badge key={`gw-${i}`} variant="info">
                  {w}
                </Badge>
              ))}
            </div>
          ) : null}

          {preview.unknownInstrumentCodes.length > 0 ? (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              未知の楽器コード:{" "}
              {preview.unknownInstrumentCodes.join(", ")}
              （取込前に「設定 &gt; 楽器」で追加するか、該当セッションを見直してください）
            </p>
          ) : null}

          {preview.sessions.map((s, si) => {
            const c = corrections[si];
            if (!c) return null;
            return (
              <section
                key={si}
                className="rounded-xl border border-border bg-card p-4 shadow-sm"
              >
                <header className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold">
                    {si + 1} 件目
                  </h2>
                  {s.needsReview.length > 0 ? (
                    <Badge variant="warning">
                      要確認 {s.needsReview.length} 件
                    </Badge>
                  ) : (
                    <Badge variant="success">解決済み</Badge>
                  )}
                </header>

                {/* 要確認 / 警告 */}
                {s.needsReview.length > 0 ? (
                  <ul className="mb-3 space-y-1">
                    {s.needsReview.map((r, ri) => (
                      <li key={ri} className="flex items-start gap-1.5">
                        <Badge variant="warning">要確認</Badge>
                        <span className="text-xs text-muted-foreground">
                          {r}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {s.warnings.map((w, wi) => (
                  <p
                    key={`w-${wi}`}
                    className="mb-1 text-xs text-muted-foreground"
                  >
                    <Badge variant="info">警告</Badge> {w}
                  </p>
                ))}

                {/* 日付 */}
                <div className="mt-3 grid gap-2">
                  <label
                    htmlFor={`date-${si}`}
                    className="text-sm font-medium"
                  >
                    セッション日
                  </label>
                  <input
                    id={`date-${si}`}
                    type="date"
                    value={c.date}
                    onChange={(e) =>
                      updateCorrection(si, { date: e.target.value })
                    }
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>

                {/* 店舗 */}
                <div className="mt-3 grid gap-2">
                  <label
                    htmlFor={`venue-${si}`}
                    className="text-sm font-medium"
                  >
                    店舗
                  </label>
                  <select
                    id={`venue-${si}`}
                    aria-label={`${si + 1} 件目の店舗`}
                    className={SELECT_CLASS}
                    value={c.venue.kind === "existing" ? String(c.venue.id) : "new"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "new") {
                        updateCorrection(si, {
                          venue: {
                            kind: "new",
                            name: s.venueName ?? "",
                            isHome: false,
                          },
                        });
                      } else {
                        updateCorrection(si, {
                          venue: { kind: "existing", id: Number(v) },
                        });
                      }
                    }}
                  >
                    <option value="new">新規作成</option>
                    {venues.map((v) => (
                      <option key={v.id} value={String(v.id)}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  {c.venue.kind === "new" ? (
                    <div className="grid gap-2">
                      <input
                        aria-label={`${si + 1} 件目の新規店舗名`}
                        value={c.venue.name}
                        placeholder="新しい店舗名"
                        onChange={(e) =>
                          updateCorrection(si, {
                            venue: {
                              kind: "new",
                              name: e.target.value,
                              isHome:
                                c.venue.kind === "new"
                                  ? c.venue.isHome
                                  : false,
                            },
                          })
                        }
                        className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={c.venue.kind === "new" && c.venue.isHome}
                          onChange={(e) =>
                            updateCorrection(si, {
                              venue: {
                                kind: "new",
                                name:
                                  c.venue.kind === "new" ? c.venue.name : "",
                                isHome: e.target.checked,
                              },
                            })
                          }
                        />
                        母店として登録する
                      </label>
                    </div>
                  ) : null}
                </div>

                {/* 曲 */}
                <p className="mt-4 text-sm font-medium">
                  セットリスト（{s.songs.length}曲）
                </p>
                <ul className="mt-2 space-y-2">
                  {s.songs.map((song, sidx) => {
                    const songRef = c.songs[sidx];
                    return (
                      <li
                        key={sidx}
                        className="rounded-lg border border-border p-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            {song.order}.
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                            {song.title}
                          </span>
                          {song.songMatch.kind === "existing" ? (
                            <Badge variant="success">曲一致</Badge>
                          ) : (
                            <Badge variant="warning">未一致</Badge>
                          )}
                        </div>
                        {song.front.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {song.front.map((f, fi) => (
                              <Badge
                                key={fi}
                                variant={f.known ? "neutral" : "warning"}
                              >
                                {f.code}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        {song.songMatch.kind === "new" ? (
                          <div className="mt-2">
                            <label
                              htmlFor={`song-${si}-${sidx}`}
                              className="sr-only"
                            >
                              {song.title} の解決方法
                            </label>
                            <select
                              id={`song-${si}-${sidx}`}
                              aria-label={`${song.title} の解決方法`}
                              className={`${SELECT_CLASS} w-full`}
                              value={
                                songRef.kind === "existing"
                                  ? String(songRef.id)
                                  : "new"
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "new") {
                                  updateSongRef(si, sidx, {
                                    kind: "new",
                                    title: song.title,
                                    needsReview: true,
                                  });
                                } else {
                                  updateSongRef(si, sidx, {
                                    kind: "existing",
                                    id: Number(v),
                                  });
                                }
                              }}
                            >
                              <option value="new">
                                新規作成（要確認で登録）
                              </option>
                              {song.candidates.map((cand) => (
                                <option
                                  key={cand.songId}
                                  value={String(cand.songId)}
                                >
                                  既存: {cand.title}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <Button
            type="button"
            className="h-10 w-full"
            disabled={committing || preview.sessions.length === 0}
            onClick={handleCommit}
          >
            {committing ? "取込中…" : "取込を確定する"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
