/**
 * Completion Criteria #4:
 * globals.css に design_rule.md の必須トークンが Light(:root)/Dark(.dark) 両方に定義され、
 * 共通レイアウトが bg-background / text-foreground を使用していること。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

/** design_rule.md §1.1 必須トークン + semantic トークン */
const REQUIRED_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
  "--ring",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--success",
  "--success-foreground",
  "--warning",
  "--warning-foreground",
  "--info",
  "--info-foreground",
];

function extractBlock(css: string, selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`,
    "m",
  );
  const match = css.match(pattern);
  if (!match) throw new Error(`selector not found: ${selector}`);
  return match[1];
}

describe("design tokens (globals.css)", () => {
  const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

  it.each(REQUIRED_TOKENS)("Light (:root) に %s が定義されている", (token) => {
    const root = extractBlock(css, ":root");
    expect(root).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
  });

  it.each(REQUIRED_TOKENS)("Dark (.dark) に %s が定義されている", (token) => {
    const dark = extractBlock(css, ".dark");
    expect(dark).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
  });

  it("semantic トークンが Tailwind ユーティリティにマッピングされている (@theme inline)", () => {
    for (const name of ["success", "warning", "info", "destructive-foreground"]) {
      expect(css).toContain(`--color-${name}: var(--${name})`);
    }
  });
});

describe("共通レイアウトのトークン使用", () => {
  it("ルートレイアウトが bg-background / text-foreground を使用している", () => {
    const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("bg-background");
    expect(layout).toContain("text-foreground");
  });

  it("app shell レイアウトが bg-background / text-foreground を使用している", () => {
    const layout = readFileSync(
      path.join(ROOT, "src/app/(main)/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("bg-background");
    expect(layout).toContain("text-foreground");
  });
});
