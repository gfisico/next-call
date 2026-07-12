import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { StartSessionSheet } from "@/components/session/start-session-sheet";
import { installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const VENUES = [
  { id: 1, name: "Jazz Spot XYZ", isHome: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: 2, name: "Bar ABC", isHome: false, createdAt: "2026-01-01T00:00:00.000Z" },
];

/** criterion 2: 新規店舗登録時のみ母店判定を表示し、既存店舗選択時は表示しない */
describe("セッション開始の母店判定表示 (criterion 2)", () => {
  it("新規店舗名を入力した時だけ母店セグメントが出る", async () => {
    const user = userEvent.setup();
    installFetch(({ path }) =>
      path === "/api/venues"
        ? { status: 200, body: { venues: VENUES } }
        : { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } },
    );

    const { findByRole, getByRole, queryByRole } = renderWithSWR(
      <StartSessionSheet open={true} onOpenChange={() => {}} />,
    );

    // 既存店舗が読み込まれる
    await findByRole("button", { name: /Jazz Spot XYZ/ });

    // 初期状態: 母店判定は非表示
    expect(queryByRole("radiogroup", { name: "母店判定" })).toBeNull();

    // 既存店舗を選択 → まだ非表示（criterion 2）
    await user.click(getByRole("button", { name: /Bar ABC/ }));
    expect(queryByRole("radiogroup", { name: "母店判定" })).toBeNull();

    // 新規店舗名を入力 → 母店判定が表示
    const nameInput = getByRole("textbox", { name: "新しい店舗名" });
    await user.type(nameInput, "Jazz Bar 新宿");
    expect(
      await findByRole("radiogroup", { name: "母店判定" }),
    ).toBeInTheDocument();

    // 名前を消す → 再び非表示
    await user.clear(nameInput);
    await waitFor(() =>
      expect(queryByRole("radiogroup", { name: "母店判定" })).toBeNull(),
    );
  });
});
