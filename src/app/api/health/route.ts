/**
 * GET /api/health — 認証不要のヘルスチェック（Completion Criteria #5）。
 * コンテナのヘルスチェックと監視の基点。DB 疎通（SELECT 1）を確認して返す。
 */
import { NextResponse } from "next/server";
import { getSqlite } from "@/db/client";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    getSqlite().prepare("SELECT 1").get();
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch {
    return NextResponse.json(
      { status: "error", db: "error" },
      { status: 503 },
    );
  }
}
