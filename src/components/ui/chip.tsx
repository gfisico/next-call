"use client";

import { cn } from "@/lib/utils";

interface ChipProps {
  /** 選択状態（フィルタ ON / 複数選択の選択中） */
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** スクリーンリーダ向けの明示ラベル（テキストで足りる場合は不要） */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * フィルタ/選択チップ（単一・複数選択の両用途）。design_rule §8:
 * - 状態は色だけでなく太字テキスト + aria-pressed で表現（色だけに依存しない）
 * - rounded-full / focus-visible リング / タップ領域を確保
 */
export function Chip({
  selected,
  onClick,
  children,
  ariaLabel,
  disabled = false,
  className,
}: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 items-center gap-1 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "border-border bg-muted font-semibold text-foreground"
          : "border-border bg-background font-medium text-muted-foreground hover:bg-muted/50",
        className,
      )}
    >
      {children}
    </button>
  );
}
