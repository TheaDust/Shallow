import { vi } from "vitest";

export interface StubRequest {
  method: string;
  url: string;
  body: unknown;
}

export interface StubResponse {
  status?: number;
  body: unknown;
}

export type StubHandler = (request: StubRequest) => StubResponse;

/** Replaces global fetch with a deterministic in-memory API used by page tests. */
export function installFetchStub(handler: StubHandler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const { status = 200, body } = handler({
      method,
      url,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const text = JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null),
      },
      json: async () => JSON.parse(text),
      text: async () => text,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
