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
