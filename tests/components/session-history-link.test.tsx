import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
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

const ACTIVE: SessionDetail = {
  id: 1,
  sessionDate: "2026-07-12",
  venueId: 3,
  venueName: "Blue Note",
  hasListeners: false,
  status: "ACTIVE",
  note: null,
  listenerCount: null,
  hostInstrumentCode: null,
  createdAt: "2026-07-12T10:00:00.000Z",
  performances: [],
  participants: [],
};

/** criterion 1: ACTIVE 記録画面にセッション履歴（/sessions）への導線がある */
describe("セッション履歴導線 (criterion 1)", () => {
  it("ACTIVE 記録画面に href=/sessions の履歴リンクを表示する", () => {
    installFetch(({ path }) => {
      if (path === "/api/venues") return { status: 200, body: { venues: [] } };
      if (path === "/api/instruments")
        return { status: 200, body: { instruments: [] } };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { getByRole } = renderWithSWR(
      <SessionRecordScreen session={ACTIVE} refresh={async () => {}} />,
    );

    const link = getByRole("link", { name: /セッション履歴/ });
    expect(link).toHaveAttribute("href", "/sessions");
  });
});
