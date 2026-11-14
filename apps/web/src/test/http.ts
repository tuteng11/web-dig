import { vi } from "vitest";

export type FetchHandler = (
  url: string,
) => Response | Promise<Response> | Promise<never>;

export function jsonResponse(
  payload: unknown,
  status = 200,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

export function textResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as Response;
}

export function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return handler(url);
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
