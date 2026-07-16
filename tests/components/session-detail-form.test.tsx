import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SessionDetailForm } from "@/components/session/session-detail-form";
import type { SessionDetail } from "@/lib/api/types";
import { bodyOf, installFetch } from "./helpers/mock-fetch";
import { renderWithSWR } from "./helpers/render";

const INSTRUMENTS = [
  { code: "pf", label: "Piano", sortOrder: 0 },
  { code: "b", label: "Bass", sortOrder: 1 },
  { code: "ds", label: "Drums", sortOrder: 2 },
];

const SESSION: SessionDetail = {
  id: 1,
  sessionDate: "2026-07-12",
  venueId: 3,
  venueName: "Blue Note",
  hasListeners: false,
  status: "ENDED",
  note: "既存メモ",
  listenerCount: 5,
  hostInstrumentCode: "b",
  createdAt: "2026-07-12T10:00:00.000Z",
  performances: [],
  participants: [{ instrumentCode: "pf", count: 2 }],
};

function commonRoutes(path: string, method: string) {
  if (path === "/api/instruments")
    return { status: 200, body: { instruments: INSTRUMENTS } };
  if (path === "/api/sessions" && method === "GET")
    return { status: 200, body: { sessions: [] } };
  if (path === "/api/sessions/active" && method === "GET")
    return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
  return null;
}

/** criterion 6: 参加者/リスナー/ホスト/メモを保存でき、初期値が復元される */
describe("詳細記録フォーム (criterion 6)", () => {
  it("初期値を復元して表示する", async () => {
    installFetch(({ path, method }) => {
      const c = commonRoutes(path, method);
      if (c) return c;
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { findByLabelText, getByLabelText } = renderWithSWR(
      <SessionDetailForm
        session={SESSION}
        open={true}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    // 参加者行（Piano 2）・リスナー 5・ホスト b・メモ 既存メモ
    expect(await findByLabelText("Piano の人数")).toHaveValue(2);
    expect(getByLabelText("リスナー客数")).toHaveValue(5);
    expect(getByLabelText("ホストパート")).toHaveValue("b");
    expect(getByLabelText("セッションメモ")).toHaveValue("既存メモ");
  });

  it("参加者追加・メモ変更→保存で camelCase の PUT と note PATCH を送る", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(({ path, method }) => {
      const c = commonRoutes(path, method);
      if (c) return c;
      if (path === "/api/sessions/1/participants" && method === "PUT")
        return { status: 200, body: { session: {} } };
      if (path === "/api/sessions/1" && method === "PATCH")
        return { status: 200, body: { session: {} } };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } };
    });

    const { findByLabelText, getByLabelText, getByRole } = renderWithSWR(
      <SessionDetailForm
        session={SESSION}
        open={true}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    // Drums を参加パートに追加
    await user.selectOptions(await findByLabelText("参加パートを追加"), "ds");
    // メモ変更（note PATCH を発火させる）
    const note = getByLabelText("セッションメモ");
    await user.clear(note);
    await user.type(note, "新しいメモ");

    await user.click(getByRole("button", { name: "詳細を保存" }));

    await waitFor(() =>
      expect(bodyOf(fetchMock, "PUT", "/participants")).toBeTruthy(),
    );
    const put = bodyOf(fetchMock, "PUT", "/participants") as {
      participants: { instrumentCode: string; count: number }[];
      listenerCount: number | null;
      hostInstrumentCode: string | null;
    };
    expect(put.participants).toEqual([
      { instrumentCode: "pf", count: 2 },
      { instrumentCode: "ds", count: 1 },
    ]);
    expect(put.listenerCount).toBe(5);
    expect(put.hostInstrumentCode).toBe("b");

    const patch = bodyOf(fetchMock, "PATCH", "/api/sessions/1") as {
      note: string;
    };
    expect(patch.note).toBe("新しいメモ");
  });
});
