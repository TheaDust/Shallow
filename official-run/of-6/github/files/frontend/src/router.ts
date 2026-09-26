import { useEffect, useState } from 'react';

/**
 * Minimal hash router. All application routes live under `#/...` so the server
 * only ever serves the single index page.
 *
 * `navigate()` updates the React route state synchronously with the *intended*
 * route (so it batches with any auth change made in the same handler) and then
 * mirrors the value into the URL hash. The native `hashchange` event (browser
 * back/forward, direct hash edits) is still observed to keep state in sync
 * with the URL.
 */
export function normalizeHash(hash: string): string {
  if (hash === '' || hash === '#') {
    return '#/';
  }
  return hash;
}

let currentRoute = normalizeHash(window.location.hash);
const routeListeners = new Set<(route?: string) => void>();

function notifyRouteChange(route: string) {
  for (const listener of routeListeners) {
    listener(route);
  }
}

export function navigate(hash: string) {
  const normalized = normalizeHash(hash);
  if (currentRoute !== normalized) {
    currentRoute = normalized;
    notifyRouteChange(normalized);
  }
  if (window.location.hash !== normalized) {
    window.location.hash = normalized;
  }
}

export function useHashRoute(): string {
  // The URL hash is the source of truth when the route state is first
  // created (fresh page load or a new mount); the module-level currentRoute
  // is only an optimization for the running instance.
  const [route, setRoute] = useState(() => {
    currentRoute = normalizeHash(window.location.hash);
    return currentRoute;
  });

  useEffect(() => {
    const fromUrl = () => {
      currentRoute = normalizeHash(window.location.hash);
      setRoute(currentRoute);
    };
    const fromApp = (next?: string) => {
      if (next !== undefined) {
        currentRoute = next;
        setRoute(next);
      } else {
        fromUrl();
      }
    };
    routeListeners.add(fromApp);
    window.addEventListener('hashchange', fromUrl);
    return () => {
      routeListeners.delete(fromApp);
      window.removeEventListener('hashchange', fromUrl);
    };
  }, []);

  return route;
}

/**
 * Redirects to `hash` once while `active` is true. Used by protected pages:
 * the decision is made on a consistent (route + auth) render.
 */
export function useRedirectTo(hash: string, active: boolean): boolean {
  const [redirected, setRedirected] = useState(false);
  useEffect(() => {
    if (active && !redirected) {
      navigate(hash);
      setRedirected(true);
    }
  }, [hash, active, redirected]);
  return redirected;
}
