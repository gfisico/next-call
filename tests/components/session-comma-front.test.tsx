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
import type { PerformanceWithFront, SessionDetail } from "@/lib/api/types";
import { installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

function perf(over: Partial<PerformanceWithFront>): PerformanceWithFront {
  return {
    id: 1,
    sessionId: 1,
    songId: 1,
    orderIndex: 1,
    participated: true,
    instrument: "NONE",
    calledByMe: false,
    noChart: false,
    note: null,
    createdAt: "2026-07-12T10:00:00.000Z",
    songTitle: "Song",
    frontInstruments: [],
    ...over,
  };
}

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
  performances: [
    perf({
      id: 10,
      orderIndex: 1,
      songTitle: "Stella",
      frontInstruments: [
        { code: "as", position: 0 },
        { code: "ts", position: 1 },
      ],
    }),
  ],
  participants: [],
};

/** criterion 2: フロント編成が「as, ts」カンマ区切りで表示され矢印が出ない */
describe("フロント編成のカンマ表記 (criterion 2)", () => {
  it("position 順に as, ts と表示し、矢印 (→) を出さない", () => {
    installFetch(({ path }) => {
      if (path === "/api/venues") return { status: 200, body: { venues: [] } };
      if (path === "/api/instruments")
        return { status: 200, body: { instruments: [] } };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { container } = renderWithSWR(
      <SessionRecordScreen session={SESSION} refresh={async () => {}} />,
    );

    expect(container).toHaveTextContent("フロント: as, ts");
    expect(container).not.toHaveTextContent("→");
  });
});
