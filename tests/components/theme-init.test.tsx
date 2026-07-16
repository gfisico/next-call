/**
 * unit-06 初期テーマ判定ロジック（getInitialDark）＋ FOUC/フック一致のテスト。
 * 成功基準 2（保存値優先）/ 未保存時 OS フォールバック / 3（FOUC スクリプトと
 * フックが同一キー・同一条件を共有）に対応。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  getInitialDark,
} from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("getInitialDark (unit-06)", () => {
  it("保存値 'true' → true（基準2: 保存値優先）", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "true");
    expect(getInitialDark()).toBe(true);
  });

  it("保存値 'false' → false（OS がダークでも保存値が勝つ）", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "false");
    vi.stubGlobal(
      "matchMedia",
      () => ({ matches: true }) as unknown as MediaQueryList,
    );
    expect(getInitialDark()).toBe(false);
  });

  it("未保存＋prefers-color-scheme:dark → true（OS フォールバック）", () => {
    // dom.ts 既定は matches:false。ここで matches:true に上書き（afterEach で復元）。
    vi.stubGlobal(
      "matchMedia",
      () => ({ matches: true }) as unknown as MediaQueryList,
    );
    expect(getInitialDark()).toBe(true);
  });

  it("未保存＋prefers-color-scheme:light → false", () => {
    vi.stubGlobal(
      "matchMedia",
      () => ({ matches: false }) as unknown as MediaQueryList,
    );
    expect(getInitialDark()).toBe(false);
  });
});

describe("FOUC スクリプトとフックのキー/条件一致 (基準3)", () => {
  it("THEME_INIT_SCRIPT は THEME_STORAGE_KEY を埋め込んでいる（単一定義共有）", () => {
    expect(THEME_INIT_SCRIPT).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it("THEME_INIT_SCRIPT の判定条件が getInitialDark と同一（'true' 優先 + prefers-color-scheme）", () => {
    expect(THEME_INIT_SCRIPT).toContain("d==='true'");
    expect(THEME_INIT_SCRIPT).toContain("d===null");
    expect(THEME_INIT_SCRIPT).toContain("(prefers-color-scheme: dark)");
  });
});
