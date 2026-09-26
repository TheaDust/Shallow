import { vi } from 'vitest';

type RouteHandler = (init?: RequestInit) => { status: number; body: unknown };

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * Stubs global fetch with per-path route handlers and returns the spy so
 * tests can assert on requests afterwards. A route key may be a bare path
 * (matches any method, e.g. '/api/auth/signin') or "METHOD /path"
 * (e.g. 'POST /api/organizations'); the method-specific entry wins when
 * both are registered. The handler is invoked exactly once per request so
 * stateful handlers (e.g. those that mutate a member list) see a stable
 * snapshot for the status and the body.
 */
export function mockFetch(routes: Record<string, RouteHandler>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split('?')[0];
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = routes[`${method} ${path}`] ?? routes[path];
    if (!handler) {
      return Promise.resolve(makeResponse(404, { error: 'not found' }));
    }
    const result = handler(init);
    return Promise.resolve(makeResponse(result.status, result.body));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
