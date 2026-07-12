"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface NumberFieldProps {
  label: string;
  value: number;
  /** 確定（onBlur / Enter）時に妥当な数値で呼ばれる */
  onChange: (value: number) => void;
  desc?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

let uid = 0;

/**
 * 数値入力フィールド（設定項目の 1 行）。design_rule §6.4:
 * - ラベル + 説明 + type=number（min/max/step）+ focus-visible ring
 * - 名称/説明を左、入力を右に置く setting-row レイアウト（ワイヤーフレーム Screen 3）
 * - 途中入力（空文字・"-"）を許すためローカル文字列 state を持ち、確定時に数値へ変換して通知
 */
export function NumberField({
  label,
  value,
  onChange,
  desc,
  min,
  max,
  step,
  disabled = false,
  className,
}: NumberFieldProps) {
  const idRef = React.useRef<string>(`nf-${++uid}`);
  const [text, setText] = React.useState<string>(String(value));

  // 外部 value（保存成功後の再検証など）に追従する
  React.useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(text);
    if (text.trim() === "" || Number.isNaN(parsed)) {
      // 不正入力は元の値へ戻す（範囲外は API zod でも防ぐが UI 側でも clamp）
      setText(String(value));
      return;
    }
    let next = parsed;
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={idRef.current} className="text-sm font-medium">
          {label}
        </label>
        {desc ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {desc}
          </p>
        ) : null}
      </div>
      <input
        id={idRef.current}
        type="number"
        inputMode="decimal"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={cn(
          "h-9 w-24 shrink-0 rounded-lg border border-input bg-background px-2.5 py-1 text-right text-sm transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      />
    </div>
  );
}
