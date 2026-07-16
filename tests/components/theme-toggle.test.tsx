/**
 * unit-06 ダークモード切替トグルのテスト（jsdom project）。
 * 成功基準 1（<html>.dark 付け外し）/ 2（localStorage 永続化）/ 4（aria-label 状態連動）/
 * 5（localStorage 例外でも機能停止しない）に対応。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "@/components/shell/theme-toggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeToggle (unit-06)", () => {
  it("クリックで <html>.dark が反転し localStorage に 'true'/'false' が永続化される (基準1,2)", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    // 初期は未保存＋matchMedia matches:false（dom.ts 既定）→ ライト
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("true");

    await user.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("false");
  });

  it("保存値が無い状態のマウントでは localStorage に書き込まない（OS 追従を壊さない, docs §3-1）", async () => {
    // OS ダーク（matches:true）だが未保存のユーザーを再現
    vi.stubGlobal(
      "matchMedia",
      () => ({ matches: true }) as unknown as MediaQueryList,
    );
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");

    render(<ThemeToggle />);
    // マウント時に DOM は OS 値へ同期されるが…
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // …localStorage には一切書き込まれない（＝以降も OS 追従が維持される）
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    setItemSpy.mockRestore();
  });

  it("aria-label が状態連動し、アイコン（Sun/Moon）が切り替わる (基準4)", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    // ライト時: 「ダークモードに切替」誘導（月アイコン）
    expect(
      screen.getByRole("button", { name: "ダークモードに切替" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button"));

    // ダーク時: 「ライトモードに切替」誘導（太陽アイコン）
    expect(
      screen.getByRole("button", { name: "ライトモードに切替" }),
    ).toBeInTheDocument();
  });

  it("localStorage.setItem が throw しても click でスローせずクラスは反映される (基準5)", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });

    render(<ThemeToggle />);
    await user.click(screen.getByRole("button"));

    // 例外は握りつぶされ、DOM 反映（機能）は継続する
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    spy.mockRestore();
  });
});
