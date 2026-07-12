import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// next/navigation はテスト環境に AppRouter コンテキストが無いためモックする
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

import HomePage from "@/app/(main)/page";
import { FakeServer } from "./helpers/fake-server";
import { installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

/**
 * criterion 1: 開始→曲追加（既存曲＋クイック登録）→編集→削除→リスナートグル→終了
 * の一連フローを 375px 相当（モバイル UI）で操作できる。
 */
describe("セッション一連フロー (criterion 1)", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("開始から終了までの一連操作が通る", async () => {
    const user = userEvent.setup();
    const server = new FakeServer();
    installFetch(server.route);

    const { findByRole, getByRole, findByText, queryByRole } = renderWithSWR(
      <HomePage />,
    );

    // --- 開始（既存店舗を選択） ---
    await user.click(await findByRole("button", { name: "セッションを開始" }));
    await user.click(await findByRole("button", { name: /Jazz Spot XYZ/ }));
    await user.click(getByRole("button", { name: "開始する" }));

    // 記録画面へ切り替わる（店舗名見出し）
    await findByRole("heading", { name: /Jazz Spot XYZ/ });

    // --- 既存曲を追加 ---
    await user.click(getByRole("button", { name: /曲を追加/ }));
    await user.type(await findByRole("textbox", { name: "曲名" }), "stella");
    await user.click(
      await findByRole("button", { name: /Stella By Starlight/ }),
    );
    await user.click(getByRole("button", { name: "保存" }));
    await findByRole("button", { name: "Stella By Starlight を編集" });

    // --- クイック登録から追加 ---
    await user.click(getByRole("button", { name: /曲を追加/ }));
    await user.type(await findByRole("textbox", { name: "曲名" }), "Confirmation");
    await findByText("一致する曲が見つかりません");
    await user.click(getByRole("button", { name: "「Confirmation」を新規登録" }));
    await findByText("選択中");
    await user.click(getByRole("button", { name: "保存" }));
    await findByRole("button", { name: "Confirmation を編集" });

    // --- 編集（Stella にコールを付ける） ---
    await user.click(getByRole("button", { name: "Stella By Starlight を編集" }));
    await user.click(
      await findByRole("checkbox", { name: "自分がコールした" }),
    );
    await user.click(getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(server.active?.performances[0].calledByMe).toBe(true),
    );

    // --- 削除（Confirmation を削除） ---
    await user.click(getByRole("button", { name: "Confirmation を削除" }));
    await user.click(await findByRole("button", { name: "削除する" }));
    await waitFor(() =>
      expect(
        queryByRole("button", { name: "Confirmation を編集" }),
      ).toBeNull(),
    );
    expect(server.active?.performances).toHaveLength(1);

    // --- リスナートグル ---
    await user.click(getByRole("radio", { name: "あり" }));
    await waitFor(() => expect(server.active?.hasListeners).toBe(true));

    // --- 終了 ---
    await user.click(getByRole("button", { name: "セッション操作メニュー" }));
    await user.click(getByRole("button", { name: "セッションを終了" }));
    await user.click(await findByRole("button", { name: "終了する" }));

    // 終了後は ACTIVE が無くなり空ホームへ戻る
    await findByRole("button", { name: "セッションを開始" });
    expect(server.active).toBeNull();
    expect(server.ended).toHaveLength(1);
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/sessions/"));
  });
});
