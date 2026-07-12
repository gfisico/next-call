import { vi } from "vitest";

export interface MockResult {
  status: number;
  body?: unknown;
}

export type RouteHandler = (ctx: {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
}) => MockResult | Promise<MockResult>;

function makeResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * global.fetch を差し替え、URL/メソッドで分岐する route ハンドラに委譲する。
 * 返り値の vi.fn で呼び出し履歴（POST ボディ等）を検証できる。
 */
export function installFetch(route: RouteHandler) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown;
      if (init?.body) {
        try {
          body = JSON.parse(String(init.body));
        } catch {
          body = init.body;
        }
      }
      const result = await route({
        method,
        path: url.pathname,
        search: url.searchParams,
        body,
      });
      return makeResponse(result.status, result.body);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** fetchMock の呼び出しから、指定メソッド+パス部分一致の JSON ボディを取り出す */
export function bodyOf(
  fetchMock: ReturnType<typeof vi.fn>,
  method: string,
  pathIncludes: string,
): unknown {
  const call = fetchMock.mock.calls.find((c) => {
    const url = String(c[0]);
    const init = (c[1] ?? {}) as RequestInit;
    const m = (init.method ?? "GET").toUpperCase();
    return m === method.toUpperCase() && url.includes(pathIncludes);
  });
  if (!call) return undefined;
  const init = (call[1] ?? {}) as RequestInit;
  return init.body ? JSON.parse(String(init.body)) : undefined;
}
