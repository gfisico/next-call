"use client";

/**
 * 統計画面（要件6フロント）。unit-04 の `GET /api/stats`（`StatsResponse`）を
 * 表示専任で可視化する（集計は書かない）。店/季節フィルタの変更で SWR キーが
 * 変わり自動再取得する。
 *
 * 可視化方針: カテゴリ多色パレットは使わず、`StatBarList` の単色トークンバー
 * （bg-muted トラック + bg-primary フィル）で統一（design_rule §8.2/§8.4）。
 */
import { useMemo, useState } from "react";
import { useStats, useVenues } from "@/lib/api/hooks";
import type { StatsQueryParams } from "@/lib/api/client";
import type { Season } from "@/lib/api/types";
import { seasonLabel } from "@/lib/master-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Segment, type SegmentOption } from "@/components/session/segment";
import { StatBarList } from "./stat-bar-list";

type VenueFilter = NonNullable<StatsQueryParams["venue"]>;

const SEASON_OPTIONS: SegmentOption<Season>[] = [
  { value: "ALL", label: "全て" },
  { value: "SPRING", label: "春" },
  { value: "SUMMER", label: "夏" },
  { value: "AUTUMN", label: "秋" },
  { value: "WINTER", label: "冬" },
];

const filterSelectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** セクション見出し + 本文の共通ラッパ（design_rule §6.2 のカード） */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <div className="space-y-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** サブブロック見出し（分布/傾向の各内訳） */
function SubBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export function StatsScreen() {
  const [venue, setVenue] = useState<VenueFilter>("all");
  const [season, setSeason] = useState<Season>("ALL");

  const { stats, error, isLoading, mutate } = useStats({ venue, season });
  const { venues } = useVenues();

  // 「久しぶりの曲」: 最終演奏日が古い順（未演奏は除外）に上位 5 件を導出
  const rareSongIds = useMemo(() => {
    if (!stats) return new Set<number>();
    const played = stats.songs
      .filter((s) => s.lastPlayedDate != null)
      .sort((a, b) =>
        (a.lastPlayedDate as string).localeCompare(b.lastPlayedDate as string),
      )
      .slice(0, 5);
    return new Set(played.map((s) => s.songId));
  }, [stats]);

  const onVenueChange = (value: string) => {
    if (value === "all" || value === "home" || value === "non_home") {
      setVenue(value);
    } else {
      setVenue(Number(value));
    }
  };

  const isEmpty =
    stats != null &&
    stats.songs.length === 0 &&
    stats.distributions.byGenre.length === 0 &&
    stats.distributions.byKey.length === 0 &&
    stats.distributions.byForm.length === 0 &&
    stats.monthly.length === 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">統計</h1>
        <p className="text-sm text-muted-foreground">
          コール曲・セットリスト全体の傾向を、店/季節で絞り込んで確認できます。
        </p>
      </header>

      {/* フィルタ */}
      <div className="space-y-3">
        <div className="grid gap-2">
          <label
            htmlFor="stats-venue"
            className="text-sm font-medium text-foreground"
          >
            店
          </label>
          <select
            id="stats-venue"
            aria-label="店で絞り込み"
            value={typeof venue === "number" ? String(venue) : venue}
            onChange={(e) => onVenueChange(e.target.value)}
            className={filterSelectClass}
          >
            <option value="all">全体</option>
            <option value="home">母店</option>
            <option value="non_home">母店以外</option>
            {venues.map((v) => (
              <option key={v.id} value={String(v.id)}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium text-foreground">季節</span>
          <Segment
            ariaLabel="季節で絞り込み"
            options={SEASON_OPTIONS}
            value={season}
            onChange={setSeason}
          />
        </div>
      </div>

      {/* 状態: 初回読込 / エラー / 空 */}
      {isLoading && !stats ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : error ? (
        <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-sm text-destructive">
            統計の取得に失敗しました。時間をおいて再度お試しください。
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={() => mutate()}
          >
            再読み込み
          </Button>
        </div>
      ) : isEmpty ? (
        <div className="rounded-xl bg-card p-6 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">
            該当するデータがありません。フィルタを緩めてお試しください。
          </p>
        </div>
      ) : stats ? (
        <div className="space-y-6">
          {/* 1. 曲別ランキング */}
          <Section
            title="曲別"
            description="コール回数の多い順。久しぶりの曲にはバッジを表示します。"
          >
            {rareSongIds.size > 0 ? (
              <p className="text-xs text-muted-foreground">
                <Badge variant="info" className="mr-1 align-middle">
                  久しぶり
                </Badge>
                最終演奏日が最も古い曲（上位5件）
              </p>
            ) : null}
            {stats.songs.length === 0 ? (
              <p className="text-xs text-muted-foreground">データがありません</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table className="min-w-full text-sm">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="text-left">曲名</TableHead>
                      <TableHead className="text-right">コール</TableHead>
                      <TableHead className="text-right">演奏</TableHead>
                      <TableHead className="text-right">最終演奏日</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.songs.map((s) => (
                      <TableRow key={s.songId} className="hover:bg-accent/50">
                        <TableCell className="align-top">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate">{s.title}</span>
                            {rareSongIds.has(s.songId) ? (
                              <Badge variant="info" className="shrink-0">
                                久しぶり
                              </Badge>
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {s.callCount}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {s.playCount}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {s.lastPlayedDate ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          {/* 2. 分布 */}
          <Section title="分布" description="演奏件数の内訳（ジャンル/キー/構成）">
            <div className="space-y-4">
              <SubBlock title="ジャンル別">
                <StatBarList
                  items={stats.distributions.byGenre.map((b) => ({
                    label: b.key,
                    count: b.count,
                  }))}
                />
              </SubBlock>
              <SubBlock title="キー別">
                <StatBarList
                  items={stats.distributions.byKey.map((b) => ({
                    label: b.key,
                    count: b.count,
                  }))}
                />
              </SubBlock>
              <SubBlock title="構成別">
                <StatBarList
                  items={stats.distributions.byForm.map((b) => ({
                    label: b.key,
                    count: b.count,
                  }))}
                />
              </SubBlock>
            </div>
          </Section>

          {/* 3. 傾向 */}
          <Section title="傾向" description="季節別・店別・母店/母店以外別の比較">
            <div className="space-y-4">
              <SubBlock title="季節別">
                <StatBarList
                  items={stats.trends.bySeason.map((t) => ({
                    label: seasonLabel(t.season),
                    count: t.count,
                  }))}
                />
              </SubBlock>
              <SubBlock title="店別">
                <StatBarList
                  items={stats.trends.byVenue.map((t) => ({
                    label: t.venueName,
                    count: t.count,
                  }))}
                />
              </SubBlock>
              <SubBlock title="母店 / 母店以外">
                <StatBarList
                  items={[
                    { label: "母店", count: stats.trends.byHome.home },
                    { label: "母店以外", count: stats.trends.byHome.nonHome },
                  ]}
                />
              </SubBlock>
            </div>
          </Section>

          {/* 4. 月別推移 */}
          <Section
            title="月別推移"
            description="月ごとの演奏曲数・新曲率・多様性"
          >
            {stats.monthly.length === 0 ? (
              <p className="text-xs text-muted-foreground">データがありません</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table className="min-w-full text-sm">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="text-left">月</TableHead>
                      <TableHead className="text-left">演奏曲数</TableHead>
                      <TableHead className="text-right">新曲率</TableHead>
                      <TableHead className="text-right">多様性</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const maxSongs = Math.max(
                        ...stats.monthly.map((m) => m.songsPlayed),
                        1,
                      );
                      return stats.monthly.map((m) => (
                        <TableRow key={m.month} className="hover:bg-accent/50">
                          <TableCell className="whitespace-nowrap align-middle font-mono">
                            {m.month}
                          </TableCell>
                          <TableCell className="align-middle">
                            <span className="flex items-center gap-2">
                              <span
                                className="h-2 min-w-1 rounded-full bg-primary"
                                style={{
                                  width: `${Math.round(
                                    (m.songsPlayed / maxSongs) * 100,
                                  )}%`,
                                }}
                                role="presentation"
                              />
                              <span className="shrink-0 font-mono tabular-nums text-xs text-muted-foreground">
                                {m.songsPlayed}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {Math.round(m.newSongRate * 100)}%
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {Math.round(m.diversity * 100)}%
                          </TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}
