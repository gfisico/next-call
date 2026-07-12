/**
 * dom project 用セットアップ（jsdom）:
 * - jest-dom マッチャ（toBeInTheDocument 等）を vitest に拡張
 * - 各テスト後に React Testing Library のマウントを掃除
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
