"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface WizardStepsProps {
  /** ステップ表示名（例: ["アップロード","プレビュー","ドライラン","コミット"]） */
  steps: string[];
  /** 現在ステップ（0 始まり） */
  current: number;
  className?: string;
}

/**
 * 4段階ステッパ（done / on / todo）。design_rule §8:
 * - 状態を色だけでなく番号・チェックアイコン・aria-current で表現
 */
export function WizardSteps({ steps, current, className }: WizardStepsProps) {
  return (
    <ol
      className={cn("flex gap-1", className)}
      aria-label="インポートの進行状況"
    >
      {steps.map((label, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li
            key={label}
            aria-current={on ? "step" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 border-b-[3px] px-1 py-1.5 text-center text-[11px]",
              done && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
              on && "border-primary font-semibold text-foreground",
              !done && !on && "border-border text-muted-foreground",
            )}
          >
            {done ? (
              <CheckIcon className="size-3" aria-hidden />
            ) : (
              <span aria-hidden>{i + 1}</span>
            )}
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
