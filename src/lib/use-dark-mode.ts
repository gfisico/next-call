"use client";

/**
 * ダークモードの状態フック（docs/dark_mode.md §3-3）。
 * - 初期値は getInitialDark()（保存値優先 → OS 設定）。
 * - toggle() で状態反転 → applyDark() が <html>.dark 付け外し＋localStorage 永続化。
 * 判定条件・キーの真実源は theme.ts に集約（FOUC スクリプトと共有）。
 */
import { useCallback, useEffect, useState } from "react";
import { applyDark, getInitialDark, syncDomDark } from "@/lib/theme";

export function useDarkMode() {
  const [isDark, setIsDark] = useState<boolean>(getInitialDark);

  // マウント後は DOM クラスの同期のみ行う（localStorage には書き込まない）。
  // OS 由来の初期値を勝手に永続化すると以降 OS 変更に追従しなくなるため
  // （docs/dark_mode.md §3-1）。永続化は toggle（ユーザー操作）に限定する。
  useEffect(() => {
    syncDomDark(isDark);
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
