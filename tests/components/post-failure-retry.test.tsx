import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SongPerformanceSheet } from "@/components/session/song-performance-sheet";
import { installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

/** criterion 5: POST 失敗時に入力値が消えず、リトライで成功する */
describe("送信失敗と入力保持・リトライ (criterion 5)", () => {
  it("最初の保存が失敗しても入力を保持し、リトライで成功する", async () => {
    const user = userEvent.setup();
    let postCount = 0;
    installFetch(({ path, method }) => {
      if (path === "/api/instruments")
        return { status: 200, body: { instruments: [] } };
      if (path === "/api/sessions/1/performances" && method === "POST") {
        postCount += 1;
        if (postCount === 1)
          return {
            status: 500,
            body: { error: { code: "INTERNAL_ERROR", message: "通信エラー" } },
          };
        return { status: 201, body: { performance: { id: 504 } } };
      }
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });
    const onSaved = vi.fn();

    const { findByRole, getByRole } = renderWithSWR(
      <SongPerformanceSheet
        sessionId={1}
        mode="create"
        initialSong={{ id: 7, title: "Stella By Starlight" }}
        open={true}
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );

    // 入力値（コール）を付ける
    const called = await findByRole("checkbox", { name: "自分がコールした" });
    await user.click(called);
    expect(called).toBeChecked();

    // 保存 → 失敗
    await user.click(getByRole("button", { name: "保存" }));
    expect(await findByRole("alert")).toHaveTextContent("保存に失敗しました");

    // 入力は保持されている
    expect(getByRole("checkbox", { name: "自分がコールした" })).toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();

    // リトライ → 成功
    await user.click(getByRole("button", { name: "リトライ" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(postCount).toBe(2);
  });
});
