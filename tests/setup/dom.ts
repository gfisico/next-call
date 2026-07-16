/**
 * dom project 用セットアップ（jsdom）:
 * - jest-dom マッチャ（toBeInTheDocument 等）を vitest に拡張
 * - 各テスト後に React Testing Library のマウントを掃除
 * - Radix UI（Sheet/Dialog）が使う jsdom 未実装 API を polyfill
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// --- localStorage polyfill ---
// このランナーの jsdom では localStorage がメソッドを持たない空オブジェクトになる
// （getItem/setItem/clear が undefined）。unit-06 のテーマ永続化テストのため、
// Map ベースの動作する Storage を用意する（機能未実装のときのみ差し替え）。
if (typeof window.localStorage?.getItem !== "function") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    window.localStorage.clear();
  } catch {
    // storage を差し替えた test（例外系）で失敗しても無視
  }
});

// --- jsdom polyfills（Radix の focus trap / pointer 系で参照される） ---
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
