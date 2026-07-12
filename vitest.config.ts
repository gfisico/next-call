import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * vitest projects（workspace）構成:
 * - "node": 既存の API/engine/db/auth 等（environment=node, tests 配下の .test.ts）
 * - "dom" : React コンポーネントテスト（environment=jsdom, tests/components 配下の .test.tsx）
 * 環境を分離し、jsdom 導入で既存 node テストが壊れないようにする（plan リスク項目）。
 */
export default defineConfig({
  test: {
    projects: [
      {
        // tsconfig の paths (@/* → ./src/*) を解決する
        resolve: { tsconfigPaths: true },
        test: {
          name: "node",
          environment: "node",
          // component テスト(.tsx)は含めない（dom project 専用）
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { tsconfigPaths: true },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/setup/dom.ts"],
        },
      },
    ],
  },
});
