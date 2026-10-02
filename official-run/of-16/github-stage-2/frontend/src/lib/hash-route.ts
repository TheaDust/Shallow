import { useSyncExternalStore } from "react";

export interface HashLocation {
  path: string;
  search: URLSearchParams;
}

export function parseHashLocation(hash: string): HashLocation {
  const raw = hash.replace(/^#/, "") || "/";
  const url = new URL(raw.startsWith("/") ? raw : `/${raw}`, "http://local");
  return { path: url.pathname, search: url.searchParams };
}

export function makeHash(path: string, search?: URLSearchParams): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const query = search?.toString();
  return `#${normalized}${query ? `?${query}` : ""}`;
}

export function navigate(path: string, search?: URLSearchParams): void {
  window.location.hash = makeHash(path, search);
}

/**
 * Matches a path against a `:name` pattern and returns its parameters, or null
 * when the shape differs. `#/organizations/acme-demo/repositories/acme-docs`
 * matches `/organizations/:slug/repositories/:name`.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split("/").filter(Boolean);
  const actual = path.split("/").filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index];
    if (segment.startsWith(":")) {
      if (actual[index].length === 0) return null;
      params[segment.slice(1)] = decodeURIComponent(actual[index]);
      continue;
    }
    if (segment !== actual[index]) return null;
  }
  return params;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function snapshot(): string {
  return window.location.hash;
}

export function useHashLocation(): HashLocation {
  return parseHashLocation(useSyncExternalStore(subscribe, snapshot, () => "#/"));
}
