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
  usePathname: () => "/sessions/import-memo",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, info: vi.fn() },
}));

import { MemoImport } from "@/components/session/memo-import";
import type { MemoPreviewResult } from "@/lib/api/types";
import { bodyOf, installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const PREVIEW: MemoPreviewResult = {
  sessions: [
    {
      date: "2026-07-12",
      venueName: "Blue Note",
      venueMatch: { kind: "new" },
      participants: [],
      host: null,
      songs: [
        {
          order: 1,
          title: "新曲",
          front: [],
          played: true,
          instrument: "NONE",
          calledByMe: false,
          beginnerFirst: false,
          note: null,
          songMatch: { kind: "new" },
          candidates: [{ songId: 9, title: "近い曲", matchType: "partial" }],
        },
      ],
      overallNote: null,
      needsReview: ["未一致曲（1曲目）: 新曲"],
      warnings: ["新規店舗「Blue Note」を作成します"],
    },
  ],
  unknownInstrumentCodes: [],
  warnings: [],
};

/** criterion 7: 貼付→プレビュー(要確認/警告)→補正(create_stub)→取込→成功トースト */
describe("メモ一括移行 (criterion 7)", () => {
  beforeEach(() => {
    push.mockClear();
    toastSuccess.mockClear();
  });

  it("preview の要確認/警告を表示し、create_stub の commit body を送って成功する", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(({ path, method }) => {
      if (path === "/api/venues") return { status: 200, body: { venues: [] } };
      if (path === "/api/sessions" && method === "GET")
        return { status: 200, body: { sessions: [] } };
      if (
        path === "/api/sessions/import-memo/preview" &&
        method === "POST"
      )
        return { status: 200, body: PREVIEW };
      if (path === "/api/sessions/import-memo/commit" && method === "POST")
        return {
          status: 200,
          body: {
            summary: {
              sessionsCreated: 1,
              performancesCreated: 1,
              frontInstrumentsCreated: 0,
              participantsCreated: 0,
              venuesCreated: 1,
              stubsCreated: 1,
              sessionIds: [42],
            },
          },
        };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { getByRole, findByText, getByText } = renderWithSWR(<MemoImport />);

    // 貼付 → プレビュー
    await user.type(
      getByRole("textbox", { name: "セッションメモを貼り付け" }),
      "2026-07-12 Blue Note 1.新曲",
    );
    await user.click(getByRole("button", { name: "プレビュー" }));

    // 要確認 / 警告 が表示される
    await findByText("未一致曲（1曲目）: 新曲");
    expect(getByText("新規店舗「Blue Note」を作成します")).toBeInTheDocument();

    // 曲の解決方法は既定で create_stub（新規作成）。そのまま取込。
    await user.click(getByRole("button", { name: "取込を確定する" }));

    await waitFor(() =>
      expect(bodyOf(fetchMock, "POST", "/import-memo/commit")).toBeTruthy(),
    );
    const body = bodyOf(fetchMock, "POST", "/import-memo/commit") as {
      sessions: Array<{
        sessionDate: string;
        venue: { kind: string; name?: string };
        performances: Array<{
          order: number;
          songRef: { kind: string; title?: string; needsReview?: boolean };
        }>;
      }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionDate).toBe("2026-07-12");
    expect(body.sessions[0].venue).toEqual({
      kind: "new",
      name: "Blue Note",
      isHome: false,
    });
    expect(body.sessions[0].performances[0].songRef).toEqual({
      kind: "new",
      title: "新曲",
      needsReview: true,
    });

    // 成功トースト + /sessions へ遷移
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sessions"));
  });
});
