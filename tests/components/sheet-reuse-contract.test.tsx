import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SongPerformanceSheet } from "@/components/session/song-performance-sheet";
import { installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

/** criterion 7: unit-06 再利用契約（曲確定済み + calledByMe=true 初期状態） */
describe("SongPerformanceSheet 再利用契約 (criterion 7)", () => {
  it("initialSong 固定 + initialCalledByMe=true で開くと検索UIが出ずコールON", async () => {
    installFetch(({ path }) =>
      path === "/api/instruments"
        ? { status: 200, body: { instruments: [] } }
        : { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } },
    );

    renderWithSWR(
      <SongPerformanceSheet
        sessionId={1}
        mode="create"
        initialSong={{ id: 42, title: "Confirmation" }}
        initialCalledByMe={true}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    // 固定曲は選択済みとして表示される
    expect(await screen.findByText("Confirmation")).toBeInTheDocument();
    expect(screen.getByText("選択中")).toBeInTheDocument();

    // 曲名検索の入力欄は出さない（固定曲のため）
    expect(screen.queryByRole("textbox", { name: "曲名" })).toBeNull();

    // 「自分がコールした」が初期 ON
    expect(
      screen.getByRole("checkbox", { name: "自分がコールした" }),
    ).toBeChecked();
  });
});
