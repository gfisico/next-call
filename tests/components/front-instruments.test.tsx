import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SongPerformanceSheet } from "@/components/session/song-performance-sheet";
import { bodyOf, installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const INSTRUMENTS = [
  { code: "vo", label: "vo", sortOrder: 0 },
  { code: "ss", label: "ss", sortOrder: 1 },
  { code: "as", label: "as", sortOrder: 2 },
  { code: "ts", label: "ts", sortOrder: 3 },
];

/** criterion 3: フロント編成を vo, as, as, ts の順で登録でき、順序が反映される */
describe("フロント編成の順序 (criterion 3)", () => {
  it("vo→as→as→ts の順で追加し、表示順と送信 position が一致する", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(({ path, method }) => {
      if (path === "/api/instruments")
        return { status: 200, body: { instruments: INSTRUMENTS } };
      if (path === "/api/sessions/1/performances" && method === "POST")
        return { status: 201, body: { performance: { id: 502 } } };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { findByRole, getByRole, getAllByRole } = renderWithSWR(
      <SongPerformanceSheet
        sessionId={1}
        mode="create"
        initialSong={{ id: 7, title: "Stella By Starlight" }}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    // フロント編成セクションを展開
    await user.click(await findByRole("button", { name: /フロント編成/ }));

    // 追加順に vo, as, as, ts
    await user.click(await findByRole("button", { name: "vo を追加" }));
    await user.click(getByRole("button", { name: "as を追加" }));
    await user.click(getByRole("button", { name: "as を追加" }));
    await user.click(getByRole("button", { name: "ts を追加" }));

    // 表示順（削除ボタンの aria-label で position を検証）
    await waitFor(() => {
      const removeButtons = getAllByRole("button", { name: /を削除$/ });
      expect(removeButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
        "1. vo を削除",
        "2. as を削除",
        "3. as を削除",
        "4. ts を削除",
      ]);
    });

    await user.click(getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, "POST", "/performances")).toBeTruthy();
    });
    const body = bodyOf(fetchMock, "POST", "/performances") as {
      frontInstruments: { code: string; position: number }[];
    };
    expect(body.frontInstruments).toEqual([
      { code: "vo", position: 0 },
      { code: "as", position: 1 },
      { code: "as", position: 2 },
      { code: "ts", position: 3 },
    ]);
  });
});
