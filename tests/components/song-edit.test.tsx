import { screen, waitFor } from "@testing-library/react";
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
  usePathname: () => "/songs/3",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SongEditScreen } from "@/components/master/song-edit-screen";
import { bodyOf, installFetch, type RouteHandler } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const song = (
  id: number,
  title: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  title,
  titleNormalized: title.toLowerCase(),
  songKey: "F",
  form: "AABA",
  composer: null,
  hasPlayed: false,
  noChartOk: false,
  isStandard: false,
  simpleForm: false,
  inKurobon1: false,
  season: "ALL",
  listenerLevel: 3,
  energyLevel: 3,
  needsReview: false,
  note: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  genreTags: [],
  ...extra,
});

const S3 = song(3, "Confirmation", { needsReview: true });
const S4 = song(4, "Bolivia", { needsReview: true });
const S1 = song(1, "Alone Together", { hasPlayed: true });
const ALL = [S3, S4, S1];

const makeRoute = (opts: { deleteStatus?: number } = {}): RouteHandler => {
  return ({ path, method, search, body }) => {
    if (path === "/api/songs" && method === "GET") {
      const needsReview = search.get("needsReview") === "true";
      const songs = needsReview ? ALL.filter((s) => s.needsReview) : ALL;
      return { status: 200, body: { songs } };
    }
    if (path === "/api/songs" && method === "POST") {
      const b = body as { title: string };
      return { status: 201, body: { song: song(99, b.title) } };
    }
    if (path === "/api/songs/3" && method === "PATCH") {
      return { status: 200, body: { song: { ...S3, ...(body as object) } } };
    }
    if (path === "/api/songs/3" && method === "DELETE") {
      if (opts.deleteStatus === 409) {
        return {
          status: 409,
          body: { error: { code: "CONFLICT", message: "参照中" } },
        };
      }
      return { status: 204 };
    }
    return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
  };
};

describe("SongEditScreen (unit-07)", () => {
  beforeEach(() => push.mockClear());

  it("新規で全属性(ジャンル複数選択含む)を POST・needsReview を解除して送る (criterion 2)", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(makeRoute());
    renderWithSWR(<SongEditScreen />);

    await user.type(screen.getByLabelText("曲名（必須）"), "New Tune");
    await user.click(screen.getByRole("button", { name: "ブルース" }));
    await user.click(screen.getByRole("button", { name: "ボサノバ" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(bodyOf(fetchMock, "POST", "/api/songs")).toBeTruthy(),
    );
    const b = bodyOf(fetchMock, "POST", "/api/songs") as {
      title: string;
      genreTags: string[];
      needsReview: boolean;
    };
    expect(b.title).toBe("New Tune");
    expect(b.genreTags).toEqual(["ブルース", "ボサノバ"]);
    expect(b.needsReview).toBe(false);
    expect(push).toHaveBeenCalledWith("/songs");
  });

  it("既存を PATCH し、属性完了チェックで needsReview:false を送る (criterion 2)", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(makeRoute());
    renderWithSWR(<SongEditScreen songId={3} />);

    await screen.findByDisplayValue("Confirmation");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(bodyOf(fetchMock, "PATCH", "/api/songs/3")).toBeTruthy(),
    );
    const b = bodyOf(fetchMock, "PATCH", "/api/songs/3") as {
      needsReview: boolean;
    };
    expect(b.needsReview).toBe(false);
    expect(push).toHaveBeenCalledWith("/songs");
  });

  it("削除 409 で「履歴があるため削除できません」を表示する (criterion 3)", async () => {
    const user = userEvent.setup();
    installFetch(makeRoute({ deleteStatus: 409 }));
    renderWithSWR(<SongEditScreen songId={3} />);

    await screen.findByDisplayValue("Confirmation");
    await user.click(screen.getByRole("button", { name: "この曲を削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(
      await screen.findByText(/演奏履歴があるため削除できません/),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("「保存して次の未整備曲へ」で次の needsReview 曲へ遷移する (criterion 2)", async () => {
    const user = userEvent.setup();
    installFetch(makeRoute());
    renderWithSWR(<SongEditScreen songId={3} />);

    await screen.findByDisplayValue("Confirmation");
    await user.click(
      screen.getByRole("button", { name: "保存して次の未整備曲へ" }),
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("/songs/4"));
  });
});
