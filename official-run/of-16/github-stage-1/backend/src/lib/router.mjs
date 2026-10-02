/**
 * Minimal method + path router. Patterns use `:name` segments for parameters,
 * e.g. `/api/organizations/:slug/repositories/:name`. Routes are matched in
 * registration order, so a literal path must be registered before a pattern
 * that could also consume it.
 */
export function matchPattern(pattern, pathname) {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index];
    if (segment.startsWith(":")) {
      if (actual[index].length === 0) return null;
      try {
        params[segment.slice(1)] = decodeURIComponent(actual[index]);
      } catch {
        params[segment.slice(1)] = actual[index];
      }
      continue;
    }
    if (segment !== actual[index]) return null;
  }
  return params;
}

export function createRouter() {
  const routes = [];

  return {
    add(method, pattern, handler) {
      routes.push({ method, pattern, handler });
      return this;
    },

    async handle(request, response, url) {
      const method = request.method ?? "GET";
      for (const route of routes) {
        if (route.method !== method) continue;
        const params = matchPattern(route.pattern, url.pathname);
        if (!params) continue;
        await route.handler(request, response, params, url);
        return true;
      }
      return false;
    },
  };
}
