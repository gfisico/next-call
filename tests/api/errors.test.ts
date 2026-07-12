/**
 * Success Criteria #7:
 * 全エンドポイントのエラーが統一形式 { error: { code, message, details? } } で返り、
 * 未捕捉例外はサーバー側で console.error によりスタックが出力される。
 */
import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ApiError,
  apiError,
  conflict,
  notFound,
  validationError,
} from "@/server/http/errors";
import { parseJsonBody, withErrorHandling } from "@/server/http/handler";
import { normalizeTitle } from "@/lib/normalize-title";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiError", () => {
  it("統一形式 { error: { code, message } } を返す", async () => {
    const res = apiError(404, "NOT_FOUND", "見つかりません");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "見つかりません" },
    });
  });

  it("details 指定時は error.details に含める", async () => {
    const res = apiError(409, "CONFLICT", "重複", { id: 1 });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: { code: "CONFLICT", message: "重複", details: { id: 1 } },
    });
  });
});

describe("withErrorHandling", () => {
  it("正常時はハンドラの結果をそのまま返す", async () => {
    const handler = withErrorHandling(async () =>
      NextResponse.json({ ok: true }),
    );
    const res = await handler();
    expect(res.status).toBe(200);
  });

  it("ApiError throw を対応ステータス + 統一形式に変換する", async () => {
    const handler = withErrorHandling(async () => {
      throw new ApiError(409, "CONFLICT", "既に存在します", { songId: 7 });
    });
    const res = await handler();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "CONFLICT",
        message: "既に存在します",
        details: { songId: 7 },
      },
    });
  });

  it("ZodError を 400 VALIDATION_ERROR + details(issues) に変換する", async () => {
    const schema = z.object({ title: z.string().min(1) });
    const handler = withErrorHandling(async () => {
      schema.parse({ title: 123 });
      return NextResponse.json({});
    });
    const res = await handler();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it("未捕捉例外は console.error でスタック出力し 500 統一形式で返す", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("boom");
    const handler = withErrorHandling(async () => {
      throw boom;
    });
    const res = await handler();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "サーバー内部でエラーが発生しました",
      },
    });
    expect(spy).toHaveBeenCalledWith(boom);
    // console.error(Error) は Node ではスタックを出力する（Error.stack が存在すること）
    expect(boom.stack).toBeTruthy();
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ title: z.string().min(1) });

  it("正しい JSON + スキーマ適合ならパース結果を返す", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Misty" }),
    });
    await expect(parseJsonBody(req, schema)).resolves.toEqual({
      title: "Misty",
    });
  });

  it("JSON として不正なら 400 VALIDATION_ERROR の ApiError を投げる", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      body: "{not json",
    });
    await expect(parseJsonBody(req, schema)).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
  });
});

describe("エラーショートハンド", () => {
  it("notFound / conflict / validationError が対応ステータスを持つ", () => {
    expect(notFound("x")).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(conflict("x")).toMatchObject({ status: 409, code: "CONFLICT" });
    expect(validationError("x")).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
  });
});

describe("normalizeTitle", () => {
  it("全半角・大小・前後空白・連続空白を正規化する", () => {
    expect(normalizeTitle("  Misty ")).toBe("misty");
    expect(normalizeTitle("ＭＩＳＴＹ")).toBe("misty");
    expect(normalizeTitle("Autumn　 Leaves")).toBe("autumn leaves");
    expect(normalizeTitle("Ａｕｔｕｍｎ　Ｌｅａｖｅｓ")).toBe("autumn leaves");
  });

  it("正規化後が同じ表記は一致する", () => {
    expect(normalizeTitle("misty")).toBe(normalizeTitle(" ＭＩＳＴＹ　"));
  });
});
