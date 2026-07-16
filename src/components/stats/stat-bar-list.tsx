"use client";

import { cn } from "@/lib/utils";

export interface StatBarItem {
  /** バーのラベル（ジャンル名 / キー / 構成 / 季節 / 店名 など） */
  label: string;
  /** 件数（バー幅と併記数値の両方に使う） */
  count: number;
}

interface StatBarListProps {
  items: StatBarItem[];
  /** 空配列時に出す小注記 */
  emptyLabel?: string;
  className?: string;
}

/**
 * 分布・傾向の共通横バー表示。
 *
 * design_rule §8.2/§8.4 準拠のため **単色トークンバー**（`bg-muted` トラック +
 * `bg-primary` フィル）で統一し、カテゴリ多色パレットは使わない。各バーはラベル +
 * 数値を常に併記するので色は非情報（色だけに依存しない）。raw hex 不使用・ダーク
 * モードでもトークンで破綻しない。
 */
export function StatBarList({
  items,
  emptyLabel = "データがありません",
  className,
}: StatBarListProps) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item) => {
        const pct = Math.round((item.count / max) * 100);
        return (
          <li key={item.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-foreground">{item.label}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {item.count}
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="presentation"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
