import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SongPerformanceSheet } from "@/components/session/song-performance-sheet";
import { bodyOf, installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

/** criterion 6: 必須入力は曲名のみ（他は既定値）で保存完了できる */
describe("最小入力での曲追加 (criterion 6)", () => {
  it("曲を選択済みなら 保存 だけで既定値の performance を作成する", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(({ path, method }) => {
      if (path === "/api/instruments")
        return { status: 200, body: { instruments: [] } };
      if (path === "/api/sessions/1/performances" && method === "POST")
        return { status: 201, body: { performance: { id: 501 } } };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });
    const onOpenChange = vi.fn();

    const { findByRole } = renderWithSWR(
      <SongPerformanceSheet
        sessionId={1}
        mode="create"
        initialSong={{ id: 7, title: "Stella By Starlight" }}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(await findByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, "POST", "/performances")).toBeTruthy();
    });

    expect(bodyOf(fetchMock, "POST", "/performances")).toEqual({
      songId: 7,
      participated: true,
      instrument: "SAX",
      calledByMe: false,
      noChart: false,
      note: null,
      frontInstruments: [],
    });
    // 保存成功でシートを閉じる
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
