import { fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SessionEditSheet } from "@/components/session/session-edit-sheet";
import { bodyOf, installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const VENUES = [
  { id: 3, name: "Blue Note", isHome: false, createdAt: "x" },
  { id: 7, name: "Jazz Spot XYZ", isHome: true, createdAt: "x" },
];

/** criterion 4: 日付・店舗を編集して保存 → PATCH body に sessionDate/venueId */
describe("セッション情報の編集 (criterion 4)", () => {
  it("date/venue を変更して保存すると camelCase の PATCH を送る", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(({ path, method }) => {
      if (path === "/api/venues")
        return { status: 200, body: { venues: VENUES } };
      if (path === "/api/sessions" && method === "GET")
        return { status: 200, body: { sessions: [] } };
      if (path === "/api/sessions/active" && method === "GET")
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
      if (path === "/api/sessions/1" && method === "PATCH")
        return { status: 200, body: { session: {} } };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { getByRole, findByRole } = renderWithSWR(
      <SessionEditSheet
        sessionId={1}
        initialDate="2026-07-12"
        initialVenueId={3}
        open={true}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    // 日付変更（type=date は fireEvent.change で値を設定する）
    const dateInput = document.getElementById(
      "session-date",
    ) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-08-01" } });

    // 店舗変更（Jazz Spot XYZ を選択）
    await user.click(await findByRole("button", { name: /Jazz Spot XYZ/ }));

    // 保存
    await user.click(getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, "PATCH", "/api/sessions/1")).toBeTruthy();
    });
    const body = bodyOf(fetchMock, "PATCH", "/api/sessions/1") as {
      sessionDate: string;
      venueId: number;
    };
    expect(body).toEqual({ sessionDate: "2026-08-01", venueId: 7 });
  });
});
