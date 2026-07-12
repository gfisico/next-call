import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SongPerformanceSheet } from "@/components/session/song-performance-sheet";
import { bodyOf, installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const QUICK_SONG = {
  id: 99,
  title: "Confirmation",
  titleNormalized: "confirmation",
  songKey: null,
  form: "OTHER",
  composer: null,
  hasPlayed: false,
  noChartOk: false,
  isStandard: false,
  simpleForm: false,
  inKurobon1: false,
  season: "ALL",
  listenerLevel: 3,
  energyLevel: 3,
  needsReview: true,
  note: null,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
  genreTags: [],
};

/** criterion 4: 検索ヒットなし→クイック登録→そのまま演奏記録追加 が一連で行える */
describe("クイック登録からの追加 (criterion 4)", () => {
  it("ヒットなし→新規登録→保存で songId が採番されて送信される", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(({ path, method }) => {
      if (path === "/api/instruments")
        return { status: 200, body: { instruments: [] } };
      if (path === "/api/songs" && method === "GET")
        return { status: 200, body: { songs: [] } };
      if (path === "/api/songs/quick" && method === "POST")
        return { status: 201, body: { song: QUICK_SONG } };
      if (path === "/api/sessions/1/performances" && method === "POST")
        return { status: 201, body: { performance: { id: 503 } } };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { findByRole, findByText, getByRole } = renderWithSWR(
      <SongPerformanceSheet
        sessionId={1}
        mode="create"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    // 曲名を入力（ヒットなし）
    await user.type(await findByRole("textbox", { name: "曲名" }), "Confirmation");
    expect(await findByText("一致する曲が見つかりません")).toBeInTheDocument();

    // クイック登録
    await user.click(getByRole("button", { name: "「Confirmation」を新規登録" }));

    // 選択状態になり「属性未整備」ヒントが出る
    expect(await findByText("選択中")).toBeInTheDocument();

    // そのまま保存
    await user.click(getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, "POST", "/performances")).toBeTruthy();
    });
    const body = bodyOf(fetchMock, "POST", "/performances") as {
      songId: number;
    };
    expect(body.songId).toBe(99);
  });
});
