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

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Activates a hash destination immediately. The browser dispatches
 * `hashchange` in a later task, which would leave the previous view mounted and
 * interactive while the new URL is already visible; notifying subscribers in
 * the same task keeps the rendered view in step with the address.
 *
 * `replace` rewrites the current address instead of adding one, which a control
 * that keeps refining the same view uses: typing in the issue search box
 * updates the displayed rows without filling the browsing history with one
 * entry per keystroke (REQ-5-1-1).
 */
function applyHash(hash: string, replace = false): void {
  if (replace) {
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  } else if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
  notify();
}

export function navigate(
  path: string,
  search?: URLSearchParams,
  options: { replace?: boolean } = {},
): void {
  applyHash(makeHash(path, search), options.replace === true);
}

/**
 * Activates a hash link address such as `#/alice-dev/acme-docs/code/main`, so a
 * component can reuse the same address it renders as an `href`.
 */
export function navigateHref(href: string): void {
  if (!href.startsWith("#")) {
    navigate(href);
    return;
  }
  const [path, query] = href.slice(1).split("?");
  navigate(path, query ? new URLSearchParams(query) : undefined);
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  listeners.add(listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    listeners.delete(listener);
  };
}

function snapshot(): string {
  return window.location.hash;
}

function onDocumentClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target as Element | null;
  const anchor = target?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  if (anchor.target && anchor.target !== "_self") return;
  const href = anchor.getAttribute("href") ?? "";
  if (!href.startsWith("#/")) return;
  event.preventDefault();
  applyHash(href);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", onDocumentClick);
}

export function useHashLocation(): HashLocation {
  return parseHashLocation(useSyncExternalStore(subscribe, snapshot, () => "#/"));
}
