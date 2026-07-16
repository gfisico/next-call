import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SetlistReorder } from "@/components/session/setlist-reorder";
import type { PerformanceWithFront } from "@/lib/api/types";
import { bodyOf, installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

function perf(id: number, orderIndex: number): PerformanceWithFront {
  return {
    id,
    sessionId: 1,
    songId: id,
    orderIndex,
    participated: true,
    instrument: "NONE",
    calledByMe: false,
    noChart: false,
    note: null,
    createdAt: "2026-07-12T10:00:00.000Z",
    songTitle: `Song ${id}`,
    frontInstruments: [],
  };
}

const PERFS = [perf(10, 1), perf(20, 2), perf(30, 3)];

/** criterion 3: ▽/△ で曲順を編集し保存 → reorder body が並べ替え後の id 配列 */
describe("曲順編集の保存 (criterion 3)", () => {
  it("1番目を下へ→保存で order=[20,10,30] を PATCH する", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(({ path, method }) => {
      if (path === "/api/sessions" && method === "GET")
        return { status: 200, body: { sessions: [] } };
      if (
        path === "/api/sessions/1/performances/order" &&
        method === "PATCH"
      )
        return { status: 200, body: { performances: [] } };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { getByRole } = renderWithSWR(
      <SetlistReorder
        sessionId={1}
        performances={PERFS}
        open={true}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    await user.click(getByRole("button", { name: "1番目を下へ" }));
    await user.click(getByRole("button", { name: "並び順を保存" }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, "PATCH", "/performances/order")).toBeTruthy();
    });
    const body = bodyOf(fetchMock, "PATCH", "/performances/order") as {
      order: number[];
    };
    expect(body.order).toEqual([20, 10, 30]);
  });
});
