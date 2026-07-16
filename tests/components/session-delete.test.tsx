import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { SessionRecordScreen } from "@/components/session/session-record-screen";
import type { SessionDetail } from "@/lib/api/types";
import { installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const SESSION: SessionDetail = {
  id: 1,
  sessionDate: "2026-07-12",
  venueId: 3,
  venueName: "Blue Note",
  hasListeners: false,
  status: "ENDED",
  note: null,
  listenerCount: null,
  hostInstrumentCode: null,
  createdAt: "2026-07-12T10:00:00.000Z",
  performances: [],
  participants: [],
};

/** criterion 5: メニュー→削除→確認→DELETE 呼出 + /sessions へ push */
describe("セッション削除 (criterion 5)", () => {
  beforeEach(() => push.mockClear());

  it("確認ダイアログを経て DELETE し /sessions へ遷移する", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(({ path, method }) => {
      if (path === "/api/venues") return { status: 200, body: { venues: [] } };
      if (path === "/api/instruments")
        return { status: 200, body: { instruments: [] } };
      if (path === "/api/sessions" && method === "GET")
        return { status: 200, body: { sessions: [] } };
      if (path === "/api/sessions/active" && method === "GET")
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
      if (path === "/api/sessions/1" && method === "DELETE")
        return { status: 204 };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { getByRole, findByRole } = renderWithSWR(
      <SessionRecordScreen session={SESSION} refresh={async () => {}} />,
    );

    await user.click(getByRole("button", { name: "セッション操作メニュー" }));
    await user.click(getByRole("button", { name: "セッションを削除" }));

    // 確認ダイアログ（不可逆の警告）→ 削除する
    await findByRole("dialog");
    await user.click(getByRole("button", { name: "削除する" }));

    await waitFor(() => {
      const deleted = fetchMock.mock.calls.some((c) => {
        const url = String(c[0]);
        const init = (c[1] ?? {}) as RequestInit;
        return (
          url.includes("/api/sessions/1") &&
          (init.method ?? "").toUpperCase() === "DELETE"
        );
      });
      expect(deleted).toBe(true);
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sessions"));
  });
});
