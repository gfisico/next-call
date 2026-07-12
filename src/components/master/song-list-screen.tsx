"use client";

/**
 * 曲マスター一覧 "/songs"。
 * - 検索（title 部分一致・debounce 250ms）+ フィルタチップ（AND）
 * - needsReview/hasPlayed/season/genre はサーバ側パラメータ、黒本1 はクライアント側フィルタ
 * - 「属性未整備 n曲」バナー → 1タップで needsReview フィルタ（補完導線）
 * - モバイル=カードリスト / sm+=テーブル（overflow-x-auto・lg+ フルブリード）
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useSongs } from "@/lib/api/hooks";
import type { Genre, Season, Song } from "@/lib/api/types";
import { GENRES, SEASONS, formLabel } from "@/lib/master-labels";
import { cn } from "@/lib/utils";

function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** 状態バッジ（needsReview 優先 → hasPlayed） */
function StatusBadge({ song }: { song: Song }) {
  if (song.needsReview) return <Badge variant="warning">属性未整備</Badge>;
  if (song.hasPlayed) return <Badge variant="success">コール可能</Badge>;
  return <Badge variant="neutral">未演奏</Badge>;
}

const filterSelectClass =
  "h-8 rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

export function SongListScreen() {
  const router = useRouter();

  const [term, setTerm] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [kurobon1, setKurobon1] = useState(false); // クライアント側フィルタ
  const [season, setSeason] = useState<Season | "">("");
  const [genre, setGenre] = useState<Genre | "">("");

  const debouncedTerm = useDebounced(term, 250);

  const { songs, isLoading, error } = useSongs({
    q: debouncedTerm || undefined,
    needsReview: needsReview || undefined,
    hasPlayed: hasPlayed || undefined,
    season: season || undefined,
    genre: genre || undefined,
    sort: "title",
  });

  // needsReview 件数（補完バナー用の別クエリ）
  const { songs: reviewSongs } = useSongs({ needsReview: true });
  const reviewCount = reviewSongs.length;

  // 黒本1 はクライアント側で AND フィルタ（API パラメータ非対応）
  const visible = kurobon1 ? songs.filter((s) => s.inKurobon1) : songs;

  const openSong = (id: number) => router.push(`/songs/${id}`);

  return (
    <div className="space-y-4 lg:relative lg:left-1/2 lg:w-screen lg:max-w-[1024px] lg:-translate-x-1/2 lg:px-6">
      {/* ヘッダ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          曲マスター{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({visible.length})
          </span>
        </h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href="/songs/new">＋ 新規追加</Link>
          </Button>
          <Button asChild variant="secondary" size="sm" className="hidden sm:inline-flex">
            <Link href="/settings/import">インポート</Link>
          </Button>
        </div>
      </div>

      {/* 属性未整備バナー（補完ショートカット） */}
      {reviewCount > 0 && !needsReview ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          <span>
            <strong className="font-semibold">属性未整備 {reviewCount}曲</strong>{" "}
            — クイック登録された曲
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setNeedsReview(true)}
          >
            補完する →
          </Button>
        </div>
      ) : null}

      {/* 検索 */}
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="曲名で検索…（部分一致）"
        aria-label="曲名で検索"
        className="h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />

      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip selected={needsReview} onClick={() => setNeedsReview((v) => !v)}>
          属性未整備
        </Chip>
        <Chip selected={hasPlayed} onClick={() => setHasPlayed((v) => !v)}>
          コール可能
        </Chip>
        <Chip selected={kurobon1} onClick={() => setKurobon1((v) => !v)}>
          黒本1
        </Chip>
        <select
          aria-label="季節で絞り込み"
          value={season}
          onChange={(e) => setSeason(e.target.value as Season | "")}
          className={cn(filterSelectClass, season && "bg-muted font-semibold text-foreground")}
        >
          <option value="">季節</option>
          {SEASONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          aria-label="ジャンルで絞り込み"
          value={genre}
          onChange={(e) => setGenre(e.target.value as Genre | "")}
          className={cn(filterSelectClass, genre && "bg-muted font-semibold text-foreground")}
        >
          <option value="">ジャンル</option>
          {GENRES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {/* 一覧 */}
      {error ? (
        <p className="text-sm text-destructive">一覧の取得に失敗しました。</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          条件に一致する曲がありません。
        </p>
      ) : (
        <>
          {/* モバイル: カードリスト */}
          <ul className="space-y-2 sm:hidden">
            {visible.map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  onClick={() => openSong(song.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl border bg-card p-3 text-left shadow-sm outline-none transition-colors",
                    "hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                    song.needsReview ? "border-amber-500/40" : "border-border",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{song.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {song.needsReview ? (
                        <Badge variant="warning">属性未整備</Badge>
                      ) : (
                        <>
                          {song.songKey ? (
                            <Badge variant="neutral">key: {song.songKey}</Badge>
                          ) : null}
                          <Badge variant="neutral">{formLabel(song.form)}</Badge>
                          {song.inKurobon1 ? (
                            <Badge variant="neutral">黒本1</Badge>
                          ) : null}
                          {song.genreTags.map((g) => (
                            <Badge key={g} variant="info">
                              {g}
                            </Badge>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                  <span aria-hidden className="text-muted-foreground">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* sm+: テーブル */}
          <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">曲名</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">キー</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">構成</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">リスナー受け</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">盛り上がり</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ジャンル</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">状態</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((song) => (
                  <tr
                    key={song.id}
                    onClick={() => openSong(song.id)}
                    className="cursor-pointer border-t border-border hover:bg-accent/50"
                  >
                    <td className="px-4 py-3 align-top font-medium">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSong(song.id);
                        }}
                        className="text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {song.title}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-top">{song.songKey ?? "—"}</td>
                    <td className="px-4 py-3 align-top">{formLabel(song.form)}</td>
                    <td className="px-4 py-3 align-top">{song.listenerLevel}</td>
                    <td className="px-4 py-3 align-top">{song.energyLevel}</td>
                    <td className="px-4 py-3 align-top">
                      {song.genreTags.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {song.genreTags.map((g) => (
                            <Badge key={g} variant="info">
                              {g}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusBadge song={song} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
