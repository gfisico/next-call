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
  usePathname: () => "/songs",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SongListScreen } from "@/components/master/song-list-screen";
import { installFetch, type RouteHandler } from "./helpers/mock-fetch";
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
  hasPlayed: true,
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
  genreTags: [] as string[],
  ...extra,
});

const ALONE = song(1, "Alone Together", { inKurobon1: true });
const BLUE = song(2, "Blue Bossa", {
  form: "OTHER",
  genreTags: ["ボサノバ"],
});
const CONF = song(3, "Confirmation", { needsReview: true, hasPlayed: false });

const makeRoute = (): RouteHandler => {
  return ({ path, search }) => {
    if (path !== "/api/songs") {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    }
    const needsReview = search.get("needsReview") === "true";
    const hasPlayed = search.get("hasPlayed") === "true";
    const season = search.get("season");
    const genre = search.get("genre");
    const q = search.get("q");
    let songs = [ALONE, BLUE, CONF];
    if (needsReview) songs = songs.filter((s) => s.needsReview);
    if (hasPlayed) songs = songs.filter((s) => s.hasPlayed);
    if (season) songs = songs.filter((s) => s.season === season);
    if (genre) songs = songs.filter((s) => s.genreTags.includes(genre));
    if (q) songs = songs.filter((s) => s.title.includes(q));
    return { status: 200, body: { songs } };
  };
};

const setup = () => {
  const fetchMock = installFetch(makeRoute());
  renderWithSWR(<SongListScreen />);
  return fetchMock;
};

const decodedUrls = (fetchMock: ReturnType<typeof installFetch>) =>
  fetchMock.mock.calls.map((c) => decodeURIComponent(String(c[0])));

describe("SongListScreen (unit-07)", () => {
  beforeEach(() => push.mockClear());

  it("検索入力で debounce 後に q 付き GET が飛ぶ (criterion 1)", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await screen.findAllByText("Alone Together");

    await user.type(screen.getByLabelText("曲名で検索"), "Blue");
    await waitFor(() =>
      expect(decodedUrls(fetchMock).some((u) => u.includes("q=Blue"))).toBe(
        true,
      ),
    );
  });

  it("needsReview バナー件数を表示し、補完ショートカットで needsReview フィルタが適用される (criterion 1)", async () => {
    const user = userEvent.setup();
    setup();
    // banner（needsReview=true クエリで CONF 1件）
    await screen.findByText(/属性未整備 1曲/);

    await user.click(screen.getByRole("button", { name: "補完する →" }));

    const chip = screen.getByRole("button", { name: "属性未整備" });
    await waitFor(() => expect(chip).toHaveAttribute("aria-pressed", "true"));
    // フィルタ適用でバナーは消える
    expect(screen.queryByText(/属性未整備 1曲/)).not.toBeInTheDocument();
  });

  it("hasPlayed / season / genre フィルタでサーバクエリが変わる (criterion 1)", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await screen.findAllByText("Alone Together");

    await user.click(screen.getByRole("button", { name: "コール可能" }));
    await waitFor(() =>
      expect(decodedUrls(fetchMock).some((u) => u.includes("hasPlayed=true"))).toBe(true),
    );

    await user.selectOptions(screen.getByLabelText("季節で絞り込み"), "SUMMER");
    await waitFor(() =>
      expect(decodedUrls(fetchMock).some((u) => u.includes("season=SUMMER"))).toBe(true),
    );

    await user.selectOptions(
      screen.getByLabelText("ジャンルで絞り込み"),
      "ボサノバ",
    );
    await waitFor(() =>
      expect(decodedUrls(fetchMock).some((u) => u.includes("genre=ボサノバ"))).toBe(true),
    );
  });

  it("黒本1 はクライアント側フィルタで一覧を絞る (criterion 1)", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByText("Alone Together");
    expect(screen.getAllByText("Blue Bossa").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "黒本1" }));

    await waitFor(() =>
      expect(screen.queryAllByText("Blue Bossa").length).toBe(0),
    );
    expect(screen.getAllByText("Alone Together").length).toBeGreaterThan(0);
  });

  it("テーブル行タップで編集画面へ遷移する", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByText("Alone Together");
    // テーブル内の曲名ボタン（sm+）を明示クリック
    const buttons = screen.getAllByRole("button", { name: "Alone Together" });
    await user.click(buttons[0]);
    expect(push).toHaveBeenCalledWith("/songs/1");
  });
});
