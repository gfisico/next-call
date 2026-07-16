import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/settings",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SettingsScreen } from "@/components/master/settings-screen";
import { APP_VERSION } from "@/version";
import { bodyOf, installFetch, type RouteHandler } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const SETTINGS = {
  "engine.same_key_penalty": 15,
  "engine.slider_weights": {
    rare: 6,
    long_unplayed: 6,
    mood: 6,
    ballad: 8,
    safety: 1.2,
  },
  "engine.season_months": {
    SPRING: [3, 4, 5],
    SUMMER: [6, 7, 8],
    AUTUMN: [9, 10, 11],
    WINTER: [12, 1, 2],
  },
  "pending.auto_release_on_call": true,
};

const INSTRUMENTS = [{ code: "vo", label: "ヴォーカル", sortOrder: 1 }];
const VENUES = [
  { id: 1, name: "Jazz Spot XYZ", isHome: false, createdAt: "2026-01-01" },
];

const makeRoute = (): RouteHandler => {
  return ({ path, method }) => {
    if (path === "/api/settings" && method === "GET") {
      return { status: 200, body: { settings: SETTINGS } };
    }
    if (path === "/api/settings" && method === "PUT") {
      return { status: 200, body: { settings: SETTINGS } };
    }
    if (path === "/api/instruments" && method === "GET") {
      return { status: 200, body: { instruments: INSTRUMENTS } };
    }
    if (path === "/api/instruments" && method === "POST") {
      return {
        status: 201,
        body: { instrument: { code: "vib", label: "ヴィブラフォン", sortOrder: 13 } },
      };
    }
    if (path === "/api/venues" && method === "GET") {
      return { status: 200, body: { venues: VENUES } };
    }
    if (path === "/api/venues/1" && method === "PATCH") {
      return { status: 200, body: { venue: { ...VENUES[0], isHome: true } } };
    }
    return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
  };
};

const setup = () => {
  const fetchMock = installFetch(makeRoute());
  renderWithSWR(<SettingsScreen />);
  return fetchMock;
};

describe("SettingsScreen (unit-07)", () => {
  it("engine.* の数値変更で PUT ボディに反映される (criterion 4)", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    const input = await screen.findByLabelText("同一キー減点");

    await user.clear(input);
    await user.type(input, "20");
    await user.tab();

    await waitFor(() =>
      expect(bodyOf(fetchMock, "PUT", "/api/settings")).toBeTruthy(),
    );
    const b = bodyOf(fetchMock, "PUT", "/api/settings") as Record<
      string,
      unknown
    >;
    expect(b["engine.same_key_penalty"]).toBe(20);
  });

  it("ネスト葉の変更は親オブジェクトへマージして PUT する (criterion 4)", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    const input = await screen.findByLabelText("珍しい曲の重み");

    await user.clear(input);
    await user.type(input, "9");
    await user.tab();

    await waitFor(() =>
      expect(bodyOf(fetchMock, "PUT", "/api/settings")).toBeTruthy(),
    );
    const b = bodyOf(fetchMock, "PUT", "/api/settings") as {
      "engine.slider_weights": { rare: number; ballad: number };
    };
    expect(b["engine.slider_weights"].rare).toBe(9);
    // 他の葉は保持される
    expect(b["engine.slider_weights"].ballad).toBe(8);
  });

  it("「既定値に戻す」で seed 既定値を PUT する (criterion 4)", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await screen.findByText("エンジン設定");

    const resetButtons = screen.getAllByRole("button", { name: "既定値に戻す" });
    await user.click(resetButtons[0]); // 除外・減点グループ

    await waitFor(() =>
      expect(bodyOf(fetchMock, "PUT", "/api/settings")).toBeTruthy(),
    );
    const b = bodyOf(fetchMock, "PUT", "/api/settings") as {
      "engine.same_key_penalty": number;
      "engine.same_key_penalty_overrides": { F: number };
    };
    expect(b["engine.same_key_penalty"]).toBe(15);
    expect(b["engine.same_key_penalty_overrides"].F).toBe(8);
  });

  it("楽器を追加すると POST が飛ぶ (criterion 4)", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await user.type(await screen.findByLabelText("楽器コード"), "vib");
    await user.type(screen.getByLabelText("楽器の表示名"), "ヴィブラフォン");
    await user.click(screen.getByRole("button", { name: "楽器を追加" }));

    await waitFor(() =>
      expect(bodyOf(fetchMock, "POST", "/api/instruments")).toBeTruthy(),
    );
    const b = bodyOf(fetchMock, "POST", "/api/instruments") as {
      code: string;
      label: string;
    };
    expect(b.code).toBe("vib");
    expect(b.label).toBe("ヴィブラフォン");
  });

  it("APP_VERSION（SSOT import）を vYYYYMMDD-NN 形式で表示する (unit-06 criterion 6)", async () => {
    setup();
    // ハードコードではなく import した定数が描画されることを担保
    expect(APP_VERSION).toMatch(/^v\d{8}-\d{2}$/);
    expect(await screen.findByText(APP_VERSION)).toBeInTheDocument();
  });

  it("母店 Toggle で venues を PATCH する (criterion 4)", async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    const group = await screen.findByRole("radiogroup", {
      name: "Jazz Spot XYZ の母店区分",
    });
    await user.click(within(group).getByRole("radio", { name: "母店" }));

    await waitFor(() =>
      expect(bodyOf(fetchMock, "PATCH", "/api/venues/1")).toBeTruthy(),
    );
    const b = bodyOf(fetchMock, "PATCH", "/api/venues/1") as {
      isHome: boolean;
    };
    expect(b.isHome).toBe(true);
  });
});

describe("SettingsScreen エクスポート (unit-07 criterion 6)", () => {
  beforeEach(() => {
    // downloadExport は blob/objectURL/anchor を使うため個別に stub する
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(
      () => "blob:mock",
    );
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  });

  it("エクスポートボタンで /api/export を fetch しダウンロードする", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/export")) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: () => 'attachment; filename="next-call-export.json"',
          },
          blob: async () => new Blob(["{}"], { type: "application/json" }),
        } as unknown as Response;
      }
      // GET settings/instruments/venues
      const body =
        url.includes("/api/settings")
          ? { settings: SETTINGS }
          : url.includes("/api/instruments")
            ? { instruments: INSTRUMENTS }
            : { venues: VENUES };
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithSWR(<SettingsScreen />);
    await user.click(
      await screen.findByRole("button", {
        name: "全データをエクスポート（ダウンロード）",
      }),
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/export")),
      ).toBe(true),
    );
  });
});
