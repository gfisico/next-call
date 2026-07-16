"use client";

/**
 * ダークモードの状態フック（docs/dark_mode.md §3-3）。
 * - 初期値は getInitialDark()（保存値優先 → OS 設定）。
 * - toggle() で状態反転 → applyDark() が <html>.dark 付け外し＋localStorage 永続化。
 * 判定条件・キーの真実源は theme.ts に集約（FOUC スクリプトと共有）。
 */
import { useCallback, useEffect, useState } from "react";
import { applyDark, getInitialDark } from "@/lib/theme";

export function useDarkMode() {
  const [isDark, setIsDark] = useState<boolean>(getInitialDark);

  // マウント後に FOUC スクリプトが付けた実 DOM 状態と state を同期させる
  // （hydration 時の初期値と実際の <html>.dark を一致させるため）。
  useEffect(() => {
    applyDark(isDark);
    // 初期同期のみ。以降は toggle 経由で反映するため依存は空。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      applyDark(next);
      return next;
    });
  }, []);

  return { isDark, toggle };
}
