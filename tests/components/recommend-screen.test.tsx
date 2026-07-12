import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// next/navigation はテスト環境に AppRouter コンテキストが無いためモックする
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    replace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/sessions/1/recommend",
  useParams: () => ({ id: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));

import { RecommendScreen } from "@/components/session/recommend-screen";
import { bodyOf, installFetch, type RouteHandler } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

// --- モックデータ ---------------------------------------------------------

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
  composer: "V. Schertzinger",
  hasPlayed: true,
  noChartOk: false,
  isStandard: true,
  simpleForm: false,
  inKurobon1: true,
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

const reason = (text: string) => ({ code: "R", text });

const sessionDetail = (performances: unknown[] = []) => ({
  id: 1,
  sessionDate: "2026-07-12",
  venueId: 1,
  hasListeners: false,
  status: "ACTIVE",
  note: null,
  createdAt: "2026-07-12T00:00:00.000Z",
  venueName: "Jazz Spot XYZ",
  performances,
});

const NEUTRAL_DEFAULTS = {
  intent: {
    rare: 0,
    fresh: 0,
    safety: 0,
    mood: 0,
    ballad: 0,
    seasonal: false,
    listener: false,
  },
  conditions: {
    horns: "UNKNOWN",
    beginner: "UNKNOWN",
    kurobon1Only: false,
    genreOverride: [],
  },
  suggestSeasonalOn: false,
};

interface RouteOpts {
  defaults?: unknown;
  recommendation?: unknown;
  session?: unknown;
}

/** RecommendScreen が叩く API を一括モックする route ハンドラ */
function makeRoute(opts: RouteOpts = {}): RouteHandler {
  const defaults = opts.defaults ?? NEUTRAL_DEFAULTS;
  const recommendation =
    opts.recommendation ??
    {
      requestId: 1,
      seed: 1,
      isSparse: false,
      poolSize: 10,
      candidates: [],
      conditionalCandidates: [],
      pendingSongs: [],
    };
  const session = opts.session ?? sessionDetail();
  return ({ method, path }) => {
    if (path === "/api/sessions/1/recommendations/defaults") {
      return { status: 200, body: { defaults } };
    }
    if (path === "/api/sessions/1/recommendations" && method === "POST") {
      return { status: 201, body: { recommendation } };
    }
    if (path === "/api/sessions/1") {
      return { status: 200, body: { session } };
    }
    if (path === "/api/sessions/1/performances" && method === "POST") {
      return {
        status: 201,
        body: {
          performance: {
            id: 99,
            sessionId: 1,
            songId: 1,
            orderIndex: 1,
            participated: true,
            instrument: "SAX",
            calledByMe: true,
            noChart: false,
            note: null,
            createdAt: "2026-07-12T01:00:00.000Z",
            songTitle: "x",
            frontInstruments: [],
          },
        },
      };
    }
    if (path === "/api/instruments") {
      return { status: 200, body: { instruments: [] } };
    }
    if (path === "/api/pending-songs" && method === "POST") {
      return { status: 201, body: { pendingSong: { song: song(1, "x"), createdAt: "x" } } };
    }
    if (path.startsWith("/api/pending-songs/") && method === "DELETE") {
      return { status: 204 };
    }
    return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
  };
}

const setup = (opts: RouteOpts = {}) => {
  const fetchMock = installFetch(makeRoute(opts));
  renderWithSWR(<RecommendScreen sessionId={1} />);
  return fetchMock;
};

/** defaults GET が済むのを待つ（初期化完了の目安） */
async function waitDefaults(fetchMock: ReturnType<typeof installFetch>) {
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/defaults")),
    ).toBe(true),
  );
  await screen.findByText(/Jazz Spot XYZ/);
}

describe("RecommendScreen (unit-06)", () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
  });

  // criterion 1
  it("defaults→条件変更→候補を出す で期待 payload の POST と候補+理由表示", async () => {
    const user = userEvent.setup();
    const fetchMock = setup({
      recommendation: {
        requestId: 1,
        seed: 1,
        isSparse: false,
        poolSize: 10,
        candidates: [
          {
            song: song(1, "I Remember You"),
            score: 80,
            reasons: [
              reason("最後に演奏してから1年2ヶ月経っています"),
              reason("この店では珍しい曲です"),
            ],
            isPending: false,
          },
        ],
        conditionalCandidates: [],
        pendingSongs: [],
      },
    });
    await waitDefaults(fetchMock);

    // 編成・制約・スライダー・チェックを変更
    await user.click(screen.getByRole("radio", { name: "1人" }));
    await user.click(screen.getByRole("radio", { name: "黒本1曲載のみ" }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "場の温度" }), {
      key: "ArrowRight",
    });
    await user.click(screen.getByRole("checkbox", { name: /リスナー受け/ }));

    await user.click(screen.getByRole("button", { name: "候補を出す" }));

    // 候補 + 理由がそのまま表示される
    expect(await screen.findByText("I Remember You")).toBeInTheDocument();
    expect(
      screen.getByText("最後に演奏してから1年2ヶ月経っています"),
    ).toBeInTheDocument();

    const body = bodyOf(fetchMock, "POST", "/api/sessions/1/recommendations") as {
      conditions: { horns: string; beginner: string };
      constraints: { kurobon1Only: boolean };
      intent: { mood: number; listener: boolean };
    };
    expect(body.conditions.horns).toBe("ONE");
    expect(body.conditions.beginner).toBe("UNKNOWN");
    expect(body.constraints.kurobon1Only).toBe(true);
    expect(body.intent.mood).toBe(1);
    expect(body.intent.listener).toBe(true);
  });

  // criterion 2
  it("前回意図値が引き継がれ、変更した項目だけが payload に反映される", async () => {
    const user = userEvent.setup();
    const fetchMock = setup({
      defaults: {
        ...NEUTRAL_DEFAULTS,
        intent: { ...NEUTRAL_DEFAULTS.intent, rare: 2, mood: -1 },
      },
    });
    await waitDefaults(fetchMock);

    // 引き継ぎ: 珍しい曲=+2, 場の温度=-1
    await waitFor(() =>
      expect(
        screen.getByRole("slider", { name: "珍しい曲" }),
      ).toHaveAttribute("aria-valuenow", "2"),
    );
    expect(screen.getByRole("slider", { name: "場の温度" })).toHaveAttribute(
      "aria-valuenow",
      "-1",
    );

    // 攻め方だけ +1 に変更
    fireEvent.keyDown(screen.getByRole("slider", { name: "攻め方" }), {
      key: "ArrowRight",
    });
    await user.click(screen.getByRole("button", { name: "候補を出す" }));

    const body = bodyOf(fetchMock, "POST", "/api/sessions/1/recommendations") as {
      intent: { rare: number; mood: number; safety: number; fresh: number };
    };
    expect(body.intent.rare).toBe(2); // 引き継ぎ維持
    expect(body.intent.mood).toBe(-1); // 引き継ぎ維持
    expect(body.intent.safety).toBe(1); // 変更した項目だけ変わる
    expect(body.intent.fresh).toBe(0);
  });

  // criterion 3
  it("1曲目は季節感が推奨ONで初期化され、OFFにでき payload seasonal=false", async () => {
    const user = userEvent.setup();
    const fetchMock = setup({
      defaults: { ...NEUTRAL_DEFAULTS, suggestSeasonalOn: true },
    });
    await waitDefaults(fetchMock);

    const seasonal = screen.getByRole("checkbox", { name: /季節感/ });
    await waitFor(() => expect(seasonal).toBeChecked());
    expect(screen.getByText("推奨")).toBeInTheDocument();
    // 季節ラベル（7月=夏）
    expect(screen.getByText(/夏の曲を重視/)).toBeInTheDocument();

    // OFF に変更できる
    await user.click(seasonal);
    await user.click(screen.getByRole("button", { name: "候補を出す" }));

    const body = bodyOf(fetchMock, "POST", "/api/sessions/1/recommendations") as {
      intent: { seasonal: boolean };
    };
    expect(body.intent.seasonal).toBe(false);
  });

  // criterion 4
  it("候補カードに理由2件以上、isSparse で注記が出る", async () => {
    const user = userEvent.setup();
    const fetchMock = setup({
      recommendation: {
        requestId: 1,
        seed: 1,
        isSparse: true,
        poolSize: 1,
        candidates: [
          {
            song: song(2, "Billie's Bounce"),
            score: 70,
            reasons: [reason("ブルース指定に合致します"), reason("黒本1に掲載されています")],
            isPending: false,
          },
        ],
        conditionalCandidates: [],
        pendingSongs: [],
      },
    });
    await waitDefaults(fetchMock);
    await user.click(screen.getByRole("button", { name: "候補を出す" }));

    expect(await screen.findByText("Billie's Bounce")).toBeInTheDocument();
    expect(screen.getByText("ブルース指定に合致します")).toBeInTheDocument();
    expect(screen.getByText("黒本1に掲載されています")).toBeInTheDocument();
    expect(screen.getByText(/条件が強く、候補が1曲に絞られました/)).toBeInTheDocument();
  });

  // criterion 5
  it("条件別候補が conditionLabel 付きで区別表示される", async () => {
    const user = userEvent.setup();
    const fetchMock = setup({
      recommendation: {
        requestId: 1,
        seed: 1,
        isSparse: false,
        poolSize: 10,
        candidates: [
          {
            song: song(3, "Autumn Leaves"),
            score: 80,
            reasons: [reason("超定番です"), reason("分かりやすいです")],
            isPending: false,
          },
        ],
        conditionalCandidates: [
          {
            song: song(4, "Softly, As in a Morning Sunrise"),
            score: 75,
            reasons: [reason("ハーモニーを重ねやすい曲です")],
            branch: "HORNS_MULTI",
            conditionLabel: "複数管なら",
          },
        ],
        pendingSongs: [],
      },
    });
    await waitDefaults(fetchMock);
    await user.click(screen.getByRole("button", { name: "候補を出す" }));

    expect(await screen.findByText("条件別候補")).toBeInTheDocument();
    expect(screen.getByText("複数管なら")).toBeInTheDocument();
    expect(
      screen.getByText("Softly, As in a Morning Sunrise"),
    ).toBeInTheDocument();
  });

  // criterion 6
  it("保留曲枠が常時表示・警告バッジ・保留解除(DELETE)・コール(シート)が機能する", async () => {
    const user = userEvent.setup();
    const fetchMock = setup({
      recommendation: {
        requestId: 1,
        seed: 1,
        isSparse: false,
        poolSize: 10,
        candidates: [],
        conditionalCandidates: [],
        pendingSongs: [
          {
            song: song(5, "Moment's Notice"),
            warnings: ["KUROBON1_MISMATCH", "FORMATION_MISMATCH"],
          },
        ],
      },
    });
    await waitDefaults(fetchMock);
    await user.click(screen.getByRole("button", { name: "候補を出す" }));

    expect(await screen.findByText("Moment's Notice")).toBeInTheDocument();
    expect(screen.getByText("黒本1条件外")).toBeInTheDocument();
    expect(screen.getByText("編成に合いにくい")).toBeInTheDocument();

    // コール → シートが開く
    await user.click(screen.getByRole("button", { name: "コール" }));
    expect(await screen.findByText("選択中")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "自分がコールした" }),
    ).toBeChecked();
    // シートを閉じる
    fireEvent.keyDown(document.body, { key: "Escape" });

    // 保留解除 → DELETE 呼び出し + 行削除
    await user.click(await screen.findByRole("button", { name: "保留解除" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => {
          const init = (c[1] ?? {}) as RequestInit;
          return (
            (init.method ?? "").toUpperCase() === "DELETE" &&
            String(c[0]).includes("/api/pending-songs/5")
          );
        }),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByText("Moment's Notice")).toBeNull(),
    );
  });

  // criterion 7
  it("この曲をコール→シート(曲確定+calledByMe)→保存→/sessions/1 へ push", async () => {
    const user = userEvent.setup();
    const fetchMock = setup({
      recommendation: {
        requestId: 1,
        seed: 1,
        isSparse: false,
        poolSize: 10,
        candidates: [
          {
            song: song(1, "I Remember You"),
            score: 80,
            reasons: [reason("理由1"), reason("理由2")],
            isPending: false,
          },
        ],
        conditionalCandidates: [],
        pendingSongs: [],
      },
    });
    await waitDefaults(fetchMock);
    await user.click(screen.getByRole("button", { name: "候補を出す" }));

    await user.click(
      await screen.findByRole("button", { name: "この曲をコール" }),
    );
    // 曲確定（検索UIなし）+ calledByMe=true
    expect(await screen.findByText("選択中")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "自分がコールした" }),
    ).toBeChecked();

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sessions/1"));
  });

  // criterion 8
  it("defaults ロード後すぐ候補を出す で POST が実行される（最短2タップ）", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await waitDefaults(fetchMock);

    await user.click(screen.getByRole("button", { name: "候補を出す" }));

    const body = bodyOf(
      fetchMock,
      "POST",
      "/api/sessions/1/recommendations",
    );
    expect(body).toEqual({
      conditions: { horns: "UNKNOWN", beginner: "UNKNOWN" },
      constraints: { kurobon1Only: false },
      intent: {
        rare: 0,
        fresh: 0,
        safety: 0,
        mood: 0,
        ballad: 0,
        seasonal: false,
        listener: false,
      },
    });
  });
});
