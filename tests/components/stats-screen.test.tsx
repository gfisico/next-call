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

// 指標ごとに順位が入れ替わるよう discriminating な値にする:
// - callCount DESC（既定）: Stella(5) → Blue(3) → So What(1)
// - appearanceCount DESC: Blue(9) → Stella(6) → So What(3)（先頭が入れ替わる）
// - Blue は playCount=0 → 未演奏バッジ
const STATS: StatsResponse = {
  songs: [
    { songId: 1, title: "Stella By Starlight", callCount: 5, playCount: 8, appearanceCount: 6 },
    { songId: 2, title: "Blue In Green", callCount: 3, playCount: 0, appearanceCount: 9 },
    { songId: 3, title: "So What", callCount: 1, playCount: 2, appearanceCount: 3 },
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

// 曲別だけが 0 件（分布/月別は残る）→ S2 の「該当する曲がありません」用
const SONGS_EMPTY_STATS: StatsResponse = {
  songs: [],
  distributions: {
    byGenre: [{ key: "バラード", count: 4 }],
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

  // 要件2/3: 3指標列があり、最終演奏日列は無い
  it("コール回数/演奏回数/登場回数 の3指標列を表示し、最終演奏日列は無い", async () => {
    setup();
    await screen.findByText("Stella By Starlight");

    // ソート可能な指標ヘッダ（button）
    expect(
      screen.getByRole("button", { name: "コール回数" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "演奏回数" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "登場回数" }),
    ).toBeInTheDocument();

    // 久しぶり・最終演奏日は撤去済み
    expect(screen.queryByText("最終演奏日")).not.toBeInTheDocument();
    expect(screen.queryByText("久しぶり")).not.toBeInTheDocument();
  });

  // 要件3: 未演奏（playCount===0）の曲に未演奏バッジが付く
  it("playCount===0 の曲に未演奏バッジが付く", async () => {
    setup();
    await screen.findByText("Blue In Green");
    // Blue In Green のみ playCount=0
    expect(screen.getAllByText("未演奏")).toHaveLength(1);
  });

  // 要件3: 指標ヘッダのクリックで降順ソートが並び替わる（既定=コール回数）
  it("登場回数ヘッダをクリックすると登場回数の降順で並び替わる", async () => {
    const user = userEvent.setup();
    setup();
    const stella = await screen.findByText("Stella By Starlight");
    const blue = screen.getByText("Blue In Green");

    // 既定（コール回数 DESC）: Stella(5) が Blue(3) より前
    expect(
      stella.compareDocumentPosition(blue) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "登場回数" }));

    // 登場回数 DESC: Blue(9) が Stella(6) より前（先頭が入れ替わる）
    await waitFor(() =>
      expect(
        blue.compareDocumentPosition(stella) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy(),
    );
    // アクティブ列は aria-sort=descending
    const col = screen.getByRole("columnheader", { name: /登場回数/ });
    expect(col).toHaveAttribute("aria-sort", "descending");
  });

  // 要件4: 閾値セレクト変更で lastPlayedBefore クエリが送られる
  it("最終演奏日の閾値を選ぶと stats fetch に lastPlayedBefore が付く", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await screen.findByText("Stella By Starlight");

    await user.selectOptions(
      screen.getByLabelText("最終演奏日で絞り込み"),
      "3m",
    );

    await waitFor(() =>
      expect(calledWith(fetchMock, "lastPlayedBefore=")).toBe(true),
    );
  });

  // 要件4 / S2: 曲別だけ 0 件のときは「該当する曲がありません」（全体空とは別扱い）
  it("曲別が0件（分布は残る）なら該当する曲がありませんを表示する", async () => {
    setup({ stats: SONGS_EMPTY_STATS });

    expect(
      await screen.findByText("該当する曲がありません"),
    ).toBeInTheDocument();
    // 分布は残っているので全体空メッセージは出さない
    expect(
      screen.queryByText(/該当するデータがありません/),
    ).not.toBeInTheDocument();
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
