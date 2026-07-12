"use client";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** スクリーンリーダ向けのグループ名 */
  ariaLabel: string;
  className?: string;
}

/**
 * セグメント選択（radiogroup）。design_rule §8:
 * - 選択状態は色だけでなく太字テキスト + aria-checked で表現
 * - focus-visible リング / タップ領域 h-10
 */
export function Segment<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "flex overflow-hidden rounded-lg border border-border",
        className,
      )}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-10 flex-1 px-2 text-sm outline-none transition-colors",
              "border-r border-border last:border-r-0",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              selected
                ? "bg-muted font-semibold text-foreground"
                : "bg-background text-muted-foreground hover:bg-muted/50",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
