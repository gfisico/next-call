"use client";

/**
 * ダーク/ライト切替トグル（全画面共通ヘッダー右上に配置）。
 * - アイコンを状態連動（ライト時=月で「ダークへ」誘導 / ダーク時=太陽で「ライトへ」誘導）。
 * - aria-label を状態連動（docs/dark_mode.md §4、design_rule §8.2）。
 * - スタイルは既存トークンのみ（色直書き禁止）。h-10 タップ域＋focus-visible ring（§8.1/8.3）。
 */
import { MoonIcon, SunIcon } from "lucide-react";
import { useDarkMode } from "@/lib/use-dark-mode";

export function ThemeToggle() {
  const { isDark, toggle } = useDarkMode();
  const label = isDark ? "ライトモードに切替" : "ダークモードに切替";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex size-10 items-center justify-center rounded-lg text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {isDark ? (
        <SunIcon className="size-5" aria-hidden />
      ) : (
        <MoonIcon className="size-5" aria-hidden />
      )}
    </button>
  );
}
