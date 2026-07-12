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
  usePathname: () => "/settings/import",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { ImportWizard } from "@/components/master/import-wizard";
import { bodyOf, installFetch, type RouteHandler } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const PREVIEW = {
  job: { id: 18, type: "setlists", status: "PREVIEW" },
  totalRows: 320,
  validRows: 298,
  errors: [
    {
      line: 41,
      reason: '不明なジャンル "swing"',
      raw: { date: "2025-04-01", venue: "XYZ" },
    },
  ],
  unknowns: {
    venues: ["Jazz Bar ABC"],
    titles: [
      {
        csvTitle: "Confermation",
        candidates: [{ songId: 5, title: "Confirmation", matchType: "partial" }],
      },
      {
        csvTitle: "Autum Leaves",
        candidates: [{ songId: 7, title: "Autumn Leaves", matchType: "partial" }],
      },
      { csvTitle: "Bolivia", candidates: [] },
    ],
  },
};

const DRY_RUN = {
  type: "setlists",
  songsToCreate: 12,
  songsToUpdate: 3,
  venuesToCreate: 1,
  unresolvedVenues: 0,
  sessionsToCreate: 24,
  duplicateSessions: 0,
  performancesToCreate: 186,
  skippedRows: 5,
  stubsToCreate: 2,
};

const COMMIT = {
  type: "setlists",
  songsCreated: 12,
  songsUpdated: 3,
  venuesCreated: 1,
  sessionsCreated: 24,
  performancesCreated: 186,
  stubsCreated: 2,
  skippedRows: 5,
  hasPlayedRecalculated: 8,
};

const makeRoute = (opts: { commitStatus?: number } = {}): RouteHandler => {
  return ({ path, method }) => {
    if (path === "/api/import/setlists" && method === "POST") {
      return { status: 201, body: PREVIEW };
    }
    if (path === "/api/import/jobs/18/resolutions" && method === "POST") {
      return {
        status: 200,
        body: { job: PREVIEW.job, resolutions: {} },
      };
    }
    if (path === "/api/import/jobs/18/dry-run" && method === "GET") {
      return { status: 200, body: { summary: DRY_RUN } };
    }
    if (path === "/api/import/jobs/18/commit" && method === "POST") {
      if (opts.commitStatus === 409) {
        return {
          status: 409,
          body: { error: { code: "CONFLICT", message: "済" } },
        };
      }
      return { status: 200, body: { summary: COMMIT } };
    }
    if (path === "/api/import/jobs/18" && method === "DELETE") {
      return { status: 204 };
    }
    return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
  };
};

async function selectSetlistsAndUpload(user: ReturnType<typeof userEvent.setup>) {
  const typeGroup = screen.getByRole("radiogroup", {
    name: "インポートの種類",
  });
  await user.click(within(typeGroup).getByRole("radio", { name: "セットリスト履歴" }));
  const file = new File(["date,venue_name\n"], "setlists.csv", {
    type: "text/csv",
  });
  await user.upload(screen.getByLabelText("CSVファイル"), file);
  await user.click(
    screen.getByRole("button", { name: "アップロードしてプレビューへ" }),
  );
  await screen.findByText(/不明なジャンル/);
}

describe("ImportWizard (unit-07 criterion 5)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it("4段階が一連で動作: アップロード→エラー行→店舗区分→曲名解決(match/stub/skip)→ドライラン→コミット", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(makeRoute());
    renderWithSWR(<ImportWizard />);

    // Step1→2: アップロード + エラー行表示
    await selectSetlistsAndUpload(user);
    expect(screen.getByText(/エラー 1件/)).toBeInTheDocument();

    // 店舗区分: 母店に確定
    const venueGroup = screen.getByRole("radiogroup", {
      name: "Jazz Bar ABC の母店区分",
    });
    await user.click(within(venueGroup).getByRole("radio", { name: "母店" }));

    // 曲名解決: 未解決(Bolivia) 1件 → skip を Autum Leaves に、一括で Bolivia を stub
    expect(screen.getByText(/未解決 1件/)).toBeInTheDocument();
    const autumGroup = screen.getByRole("radiogroup", {
      name: "Autum Leaves の解決",
    });
    await user.click(within(autumGroup).getByRole("radio", { name: "スキップ" }));
    await user.click(
      screen.getByRole("button", { name: "未解決をすべてスタブ作成（一括）" }),
    );

    // ドライラン実行 → saveResolutions + dry-run
    await user.click(screen.getByRole("button", { name: "ドライラン実行" }));

    await waitFor(() =>
      expect(bodyOf(fetchMock, "POST", "/resolutions")).toBeTruthy(),
    );
    const res = bodyOf(fetchMock, "POST", "/resolutions") as {
      venues: Record<string, boolean>;
      titles: Record<string, { action: string; songId?: number }>;
    };
    expect(res.venues["Jazz Bar ABC"]).toBe(true);
    expect(res.titles["Confermation"]).toEqual({ action: "match", songId: 5 });
    expect(res.titles["Autum Leaves"].action).toBe("skip");
    expect(res.titles["Bolivia"].action).toBe("create_stub");

    // Step3: ドライラン差分
    expect(await screen.findByText("新規曲")).toBeInTheDocument();
    expect(screen.getByText("186")).toBeInTheDocument();

    // Step4: コミット
    await user.click(screen.getByRole("button", { name: "コミットへ進む" }));
    await user.click(screen.getByRole("button", { name: "コミット実行" }));

    await waitFor(() =>
      expect(bodyOf(fetchMock, "POST", "/commit")).toBeTruthy(),
    );
    expect(bodyOf(fetchMock, "POST", "/commit")).toEqual({
      recalcHasPlayed: true,
    });
    expect(await screen.findByText("取込完了")).toBeInTheDocument();
  });

  it("破棄で DELETE が飛び Step1 へ戻る", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(makeRoute());
    renderWithSWR(<ImportWizard />);

    await selectSetlistsAndUpload(user);
    await user.click(screen.getByRole("button", { name: "ドライラン実行" }));
    await screen.findByText("新規曲");
    await user.click(screen.getByRole("button", { name: "コミットへ進む" }));
    await user.click(
      screen.getByRole("button", { name: "このインポートを破棄" }),
    );
    await user.click(screen.getByRole("button", { name: "破棄する" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            String(c[0]).includes("/api/import/jobs/18") &&
            (c[1]?.method ?? "GET") === "DELETE",
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByRole("button", { name: "アップロードしてプレビューへ" }),
    ).toBeInTheDocument();
  });

  it("コミット 409 はトースト表示し結果を出さない", async () => {
    const user = userEvent.setup();
    installFetch(makeRoute({ commitStatus: 409 }));
    renderWithSWR(<ImportWizard />);

    await selectSetlistsAndUpload(user);
    await user.click(screen.getByRole("button", { name: "ドライラン実行" }));
    await screen.findByText("新規曲");
    await user.click(screen.getByRole("button", { name: "コミットへ進む" }));
    await user.click(screen.getByRole("button", { name: "コミット実行" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "このジョブは既に確定/破棄されています",
      ),
    );
    expect(screen.queryByText("取込完了")).not.toBeInTheDocument();
  });

  it("中断したジョブを sessionStorage から再開できる", async () => {
    const user = userEvent.setup();
    installFetch(makeRoute());
    const { unmount } = renderWithSWR(<ImportWizard />);

    await selectSetlistsAndUpload(user);
    unmount();

    // 新しいインスタンス（リロード相当）で中断中ジョブが見える
    renderWithSWR(<ImportWizard />);
    expect(await screen.findByText("中断中のインポート")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再開" }));

    // Step2 が復元され、エラー行が再表示される
    expect(await screen.findByText(/不明なジャンル/)).toBeInTheDocument();
  });
});
