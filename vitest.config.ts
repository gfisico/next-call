import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig の paths (@/* → ./src/*) を解決する
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
