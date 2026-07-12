/**
 * Success Criteria #1（網羅チェック）:
 * unit spec のエンドポイント一覧と Route ファイルの export を 1:1 で突き合わせる
 * チェックリストテスト（エンドポイント漏れ対策。unit-03 spec の Risks 項参照）。
 */
import { describe, expect, it } from "vitest";

/** unit-03 spec §Technical Specification のエンドポイント一覧 */
const ENDPOINTS: Array<{ route: string; loader: () => Promise<object>; methods: string[] }> = [
  {
    route: "/api/songs",
    loader: () => import("@/app/api/songs/route"),
    methods: ["GET", "POST"],
  },
  {
    route: "/api/songs/:id",
    loader: () => import("@/app/api/songs/[id]/route"),
    methods: ["PATCH", "DELETE"],
  },
  {
    route: "/api/songs/quick",
    loader: () => import("@/app/api/songs/quick/route"),
    methods: ["POST"],
  },
  {
    route: "/api/instruments",
    loader: () => import("@/app/api/instruments/route"),
    methods: ["GET", "POST"],
  },
  {
    route: "/api/instruments/:code",
    loader: () => import("@/app/api/instruments/[code]/route"),
    methods: ["DELETE"],
  },
  {
    route: "/api/genre-tags",
    loader: () => import("@/app/api/genre-tags/route"),
    methods: ["GET"],
  },
  {
    route: "/api/venues",
    loader: () => import("@/app/api/venues/route"),
    methods: ["GET", "POST"],
  },
  {
    route: "/api/venues/:id",
    loader: () => import("@/app/api/venues/[id]/route"),
    methods: ["PATCH"],
  },
  {
    route: "/api/settings",
    loader: () => import("@/app/api/settings/route"),
    methods: ["GET", "PUT"],
  },
  {
    route: "/api/sessions",
    loader: () => import("@/app/api/sessions/route"),
    methods: ["GET", "POST"],
  },
  {
    route: "/api/sessions/active",
    loader: () => import("@/app/api/sessions/active/route"),
    methods: ["GET"],
  },
  {
    route: "/api/sessions/:id",
    loader: () => import("@/app/api/sessions/[id]/route"),
    methods: ["GET", "PATCH"],
  },
  {
    route: "/api/sessions/:id/performances",
    loader: () => import("@/app/api/sessions/[id]/performances/route"),
    methods: ["POST"],
  },
  {
    route: "/api/performances/:id",
    loader: () => import("@/app/api/performances/[id]/route"),
    methods: ["PATCH", "DELETE"],
  },
  {
    route: "/api/export",
    loader: () => import("@/app/api/export/route"),
    methods: ["GET"],
  },
];

describe("unit-03 エンドポイント網羅チェック", () => {
  it.each(ENDPOINTS)("$route が $methods を export している", async ({ loader, methods }) => {
    const mod = (await loader()) as Record<string, unknown>;
    for (const method of methods) {
      expect(typeof mod[method], `${method} handler`).toBe("function");
    }
  });
});
