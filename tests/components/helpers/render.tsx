import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { SWRConfig } from "swr";

/**
 * SWR キャッシュをテストごとに隔離してレンダリングする。
 * provider: () => new Map() で毎回まっさらなキャッシュにする（テスト間の汚染防止）。
 */
export function renderWithSWR(ui: ReactElement) {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        shouldRetryOnError: false,
      }}
    >
      {ui}
    </SWRConfig>,
  );
}
