import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 本番配布のため standalone 出力を有効化する（unit-09）。
  // .next/standalone/server.js に最小ランタイム + 必要な node_modules が同梱され、
  // Dockerfile の runner ステージはこれと .next/static / public のみをコピーする。
  output: "standalone",
  // better-sqlite3 はネイティブモジュールのためバンドル対象から除外する。
  // standalone のファイルトレースがネイティブ .node ごと node_modules へ取り込む。
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
