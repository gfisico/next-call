"use client";

import { cn } from "@/lib/utils";

interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * 2状態トグル（あり/なし 等）。pill 形状。radiogroup として実装し
 * 色だけに依存しない（太字ラベル + aria-checked）。タップ領域 h-10。
 */
export function Toggle({
  value,
  onChange,
  ariaLabel,
  onLabel = "あり",
  offLabel = "なし",
  disabled = false,
  className,
}: ToggleProps) {
  const options: { on: boolean; label: string }[] = [
    { on: true, label: onLabel },
    { on: false, label: offLabel },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex overflow-hidden rounded-full border border-border",
        className,
      )}
    >
      {options.map((opt) => {
        const selected = opt.on === value;
        return (
          <button
            key={opt.label}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.on)}
            className={cn(
              "h-10 min-w-14 px-4 text-sm outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              "disabled:pointer-events-none disabled:opacity-50",
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
