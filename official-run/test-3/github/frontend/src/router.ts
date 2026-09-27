import { useEffect, useState } from 'react';

export interface HashRoute {
  path: string;
  search: URLSearchParams;
}

export function parseHash(): HashRoute {
  const raw = window.location.hash.slice(1) || '/';
  const [pathPart, queryPart] = raw.split('?');
  let path = pathPart || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  return { path, search: new URLSearchParams(queryPart || '') };
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>(() => parseHash());

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
