import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 はネイティブモジュールのためバンドル対象から除外する
  // (standalone 出力への同梱調整は unit-09 スコープ)
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
