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
 * Rewrites the current hash in place without adding a history entry.
 * `replaceState` never fires `hashchange`, so subscribers are notified manually.
 */
export function replaceHash(path: string, search?: URLSearchParams): void {
  const next = makeHash(path, search);
  if (window.location.hash === next) return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
  notify();
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("hashchange", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("hashchange", listener);
  };
}

function snapshot(): string {
  return window.location.hash;
}

export function useHashLocation(): HashLocation {
  return parseHashLocation(useSyncExternalStore(subscribe, snapshot, () => "#/"));
}
