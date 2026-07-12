/**
 * condition_signature（§14.3 繰り返し減点用の条件署名）
 * 編成 + 黒本1 + ジャンル上書き + スライダー符号から生成。
 * チェックボックスは含めない。スライダーは符号のみ（+1 と +2 は同一）。
 */
import { describe, expect, it } from "vitest";
import { conditionSignature } from "@/engine/condition-signature";
import { makeConditions, makeIntent } from "./helpers";

describe("condition_signature", () => {
  it("同一条件からは常に同じ署名が生成される（決定的）", () => {
    const a = conditionSignature(makeConditions(), makeIntent());
    const b = conditionSignature(makeConditions(), makeIntent());
    expect(a).toBe(b);
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
  });

  it("horns が異なると署名が変わる", () => {
    expect(conditionSignature(makeConditions({ horns: "ONE" }), makeIntent())).not.toBe(
      conditionSignature(makeConditions({ horns: "MULTI" }), makeIntent()),
    );
  });

  it("beginner が異なると署名が変わる", () => {
    expect(conditionSignature(makeConditions({ beginner: "NONE" }), makeIntent())).not.toBe(
      conditionSignature(makeConditions({ beginner: "PRESENT" }), makeIntent()),
    );
  });

  it("kurobon1_only が異なると署名が変わる", () => {
    expect(conditionSignature(makeConditions({ kurobon1Only: false }), makeIntent())).not.toBe(
      conditionSignature(makeConditions({ kurobon1Only: true }), makeIntent()),
    );
  });

  it("ジャンル上書きが異なると署名が変わる", () => {
    expect(conditionSignature(makeConditions({ genreOverride: [] }), makeIntent())).not.toBe(
      conditionSignature(makeConditions({ genreOverride: ["ファンク"] }), makeIntent()),
    );
  });

  it("ジャンル上書きは順序に依存しない", () => {
    expect(
      conditionSignature(makeConditions({ genreOverride: ["ファンク", "バラード"] }), makeIntent()),
    ).toBe(
      conditionSignature(makeConditions({ genreOverride: ["バラード", "ファンク"] }), makeIntent()),
    );
  });

  it("スライダーは符号のみ反映: +1 と +2 は同一署名", () => {
    expect(conditionSignature(makeConditions(), makeIntent({ rare: 1 }))).toBe(
      conditionSignature(makeConditions(), makeIntent({ rare: 2 })),
    );
  });

  it("スライダーの符号が変わると署名が変わる（0 / + / − は区別）", () => {
    const zero = conditionSignature(makeConditions(), makeIntent({ safety: 0 }));
    const plus = conditionSignature(makeConditions(), makeIntent({ safety: 1 }));
    const minus = conditionSignature(makeConditions(), makeIntent({ safety: -1 }));
    expect(zero).not.toBe(plus);
    expect(zero).not.toBe(minus);
    expect(plus).not.toBe(minus);
  });

  it("チェックボックス（seasonal/listener）は署名に含めない", () => {
    expect(
      conditionSignature(makeConditions(), makeIntent({ seasonal: false, listener: false })),
    ).toBe(conditionSignature(makeConditions(), makeIntent({ seasonal: true, listener: true })));
  });
});
