import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// next/navigation はテスト環境に AppRouter コンテキストが無いためモックする
// （BottomNav が usePathname を使う）
vi.mock("next/navigation", () => ({
  usePathname: () => "/stats",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { BottomNav } from "@/components/shell/bottom-nav";
import { StatsScreen } from "@/components/stats/stats-screen";
import type { StatsResponse } from "@/lib/api/types";
import { installFetch, type RouteHandler } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

// --- モックデータ ---------------------------------------------------------

const VENUES = [
  { id: 1, name: "Jazz Spot XYZ", isHome: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: 2, name: "Bar ABC", isHome: false, createdAt: "2026-01-01T00:00:00.000Z" },
];

const STATS: StatsResponse = {
  songs: [
    { songId: 1, title: "Stella By Starlight", callCount: 5, playCount: 8, lastPlayedDate: "2026-06-01" },
    { songId: 2, title: "Blue In Green", callCount: 3, playCount: 4, lastPlayedDate: null },
  ],
  distributions: {
    byGenre: [
      { key: "バラード", count: 4 },
      { key: "ブルース", count: 2 },
    ],
    byKey: [{ key: "B♭", count: 3 }],
    byForm: [{ key: "AABA", count: 5 }],
  },
  trends: {
    bySeason: [{ season: "SUMMER", count: 6 }],
    byVenue: [{ venueId: 1, venueName: "Jazz Spot XYZ", count: 7 }],
    byHome: { home: 5, nonHome: 2 },
  },
  monthly: [{ month: "2026-06", songsPlayed: 10, newSongRate: 0.3, diversity: 0.8 }],
};

const EMPTY_STATS: StatsResponse = {
  songs: [],
  distributions: { byGenre: [], byKey: [], byForm: [] },
  trends: { bySeason: [], byVenue: [], byHome: { home: 0, nonHome: 0 } },
  monthly: [],
};

interface RouteOpts {
  stats?: StatsResponse;
  /** /api/stats を 500 で返す */
  statsStatus?: number;
}

function makeRoute(opts: RouteOpts = {}): RouteHandler {
  return ({ method, path }) => {
    if (path === "/api/venues" && method === "GET") {
      return { status: 200, body: { venues: VENUES } };
    }
    if (path === "/api/stats" && method === "GET") {
      if (opts.statsStatus && opts.statsStatus >= 400) {
        return {
          status: opts.statsStatus,
          body: { error: { code: "INTERNAL_ERROR", message: "boom" } },
        };
      }
      return { status: 200, body: opts.stats ?? STATS };
    }
    return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
  };
}

const setup = (opts: RouteOpts = {}) => {
  const fetchMock = installFetch(makeRoute(opts));
  renderWithSWR(<StatsScreen />);
  return fetchMock;
};

/** fetchMock のいずれかの呼び出し URL が部分文字列を含むか */
const calledWith = (fetchMock: ReturnType<typeof installFetch>, sub: string) =>
  fetchMock.mock.calls.some((c) => String(c[0]).includes(sub));

describe("StatsScreen (unit-05)", () => {
  // criterion 1: 各セクションが StatsResponse から描画される
  it("曲別・分布・傾向・月別推移が表示される", async () => {
    setup();

    // 曲別ランキング
    expect(await screen.findByText("Stella By Starlight")).toBeInTheDocument();
    expect(screen.getByText("Blue In Green")).toBeInTheDocument();
    // 久しぶりバッジ（最終演奏日ありの曲）
    expect(screen.getAllByText("久しぶり").length).toBeGreaterThan(0);

    // 分布ラベル
    expect(screen.getByText("バラード")).toBeInTheDocument();
    expect(screen.getByText("ジャンル別")).toBeInTheDocument();

    // 傾向
    expect(screen.getByText("季節別")).toBeInTheDocument();
    expect(screen.getByText("店別")).toBeInTheDocument();

    // 月別推移
    expect(screen.getByText("2026-06")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  // criterion 2: 季節フィルタ変更 → season=SUMMER で再取得
  it("季節Segmentで夏を選ぶと stats fetch が season=SUMMER で行われる", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await screen.findByText("Stella By Starlight");

    await user.click(screen.getByRole("radio", { name: "夏" }));

    await waitFor(() =>
      expect(calledWith(fetchMock, "/api/stats?season=SUMMER")).toBe(true),
    );
  });

  // criterion 2: 店フィルタ（母店）→ venue=home で再取得
  it("店フィルタで母店を選ぶと stats fetch が venue=home で行われる", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await screen.findByText("Stella By Starlight");

    await user.selectOptions(screen.getByLabelText("店で絞り込み"), "home");

    await waitFor(() =>
      expect(calledWith(fetchMock, "/api/stats?venue=home")).toBe(true),
    );
  });

  // criterion 2: 個別店選択 → venue=<id> で再取得
  it("店フィルタで個別店を選ぶと stats fetch が venue=<id> で行われる", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await screen.findByText("Stella By Starlight");

    await user.selectOptions(screen.getByLabelText("店で絞り込み"), "2");

    await waitFor(() =>
      expect(calledWith(fetchMock, "/api/stats?venue=2")).toBe(true),
    );
  });

  // criterion 4: 空状態
  it("全て空の StatsResponse では空状態を表示する", async () => {
    setup({ stats: EMPTY_STATS });

    expect(
      await screen.findByText(/該当するデータがありません/),
    ).toBeInTheDocument();
  });

  // criterion 4: エラー + 再読み込み
  it("500 エラーでエラーメッセージと再読み込みボタンを表示し、押すと再取得する", async () => {
    const user = userEvent.setup();
    const fetchMock = setup({ statsStatus: 500 });

    expect(
      await screen.findByText(/統計の取得に失敗しました/),
    ).toBeInTheDocument();

    const before = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/stats"),
    ).length;

    await user.click(screen.getByRole("button", { name: "再読み込み" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) =>
          String(c[0]).includes("/api/stats"),
        ).length,
      ).toBeGreaterThan(before),
    );
  });

  // criterion 3: ボトムナビに統計リンク
  it("ボトムナビに /stats への「統計」リンクが存在する", () => {
    renderWithSWR(<BottomNav />);
    const link = screen.getByRole("link", { name: "統計" });
    expect(link).toHaveAttribute("href", "/stats");
  });
});
