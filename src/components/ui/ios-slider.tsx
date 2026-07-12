"use client";

import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

export interface IosSliderProps {
  /** 内部名（label にも使う）。表示名 */
  name: string;
  leftLabel: string;
  rightLabel: string;
  /** -2..+2 の整数 */
  value: number;
  onChange: (value: number) => void;
  /** スクリーンリーダ向けラベル（省略時は name） */
  ariaLabel?: string;
  className?: string;
}

/**
 * 共有 iOS(Apple)風スライダー（unit-06/unit-07 共通）。
 *
 * - min=-2, max=2, step=1 の 5 段階スナップ（radix Slider をベースにキーボード操作を維持）
 * - 外観: 細レール + 中央(0)起点の青系ティント fill + 白い円形ノブ（影 + ring）+ 5 段階ドット
 * - 中央起点 fill は radix Range では表現できない（min 起点でしか塗れない）ため Range は隠し、
 *   value から left/width を算出した独立の fill 要素を絶対配置で重ねて描画する。
 * - タッチ領域は Thumb の after:-inset で拡大（誤タッチ低減）、focus-visible:ring / ダークモード対応。
 */
export function IosSlider({
  name,
  leftLabel,
  rightLabel,
  value,
  onChange,
  ariaLabel,
  className,
}: IosSliderProps) {
  const clamped = Math.max(-2, Math.min(2, value));
  // 中央(50%)起点の fill。value +1→右へ 25%、-1→左へ 25%。
  const fillWidth = Math.abs(clamped) * 25;
  const fillLeft = clamped >= 0 ? 50 : 50 - fillWidth;

  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-sm font-medium">{name}</p>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <SliderPrimitive.Root
        min={-2}
        max={2}
        step={1}
        value={[clamped]}
        onValueChange={(vals) => onChange(vals[0] ?? 0)}
        className="relative flex h-8 w-full touch-none items-center px-2 select-none"
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow rounded-full bg-muted">
          {/* 中央起点ティント（radix Range は使わず独立 fill を絶対配置） */}
          <div
            className="absolute top-0 h-1 rounded-full bg-sky-500 dark:bg-sky-400"
            style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
          />
          {/* 5 段階ドット */}
          {[0, 25, 50, 75, 100].map((pos) => (
            <span
              key={pos}
              aria-hidden="true"
              className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30"
              style={{ left: `${pos}%` }}
            />
          ))}
          {/* 中央起点 fill を独自描画するため Range 自体は非表示 */}
          <SliderPrimitive.Range className="hidden" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={ariaLabel ?? name}
          className={cn(
            "relative block size-6 shrink-0 rounded-full border border-black/5 bg-white shadow-md",
            "outline-none ring-black/5 transition-shadow",
            // タッチ領域拡大（誤タッチ低減）
            "after:absolute after:-inset-2",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          )}
        />
      </SliderPrimitive.Root>
    </div>
  );
}
