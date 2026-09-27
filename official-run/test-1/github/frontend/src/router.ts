import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  query: URLSearchParams;
}

export function parseHash(): Route {
  const hash = window.location.hash.slice(1);
  const [rawPath, queryString] = hash.split('?');
  const path = rawPath || '/';
  return { path, query: new URLSearchParams(queryString || '') };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export type RouteMatch =
  | { name: 'home' }
  | { name: 'signin' }
  | { name: 'register' }
  | { name: 'forgot' }
  | { name: 'settings' }
  | { name: 'settingsPassword' }
  | { name: 'search' }
  | { name: 'repositoryOverview'; owner: string; repoName: string; view: 'overview' | 'code' }
  | { name: 'repositoryTab'; owner: string; repoName: string; tab: 'issues' | 'pulls' | 'settings' | 'general' }
  | { name: 'issueDetail'; owner: string; repoName: string; number: string }
  | { name: 'file'; owner: string; repoName: string; branch: string; path: string }
  | { name: 'tree'; owner: string; repoName: string; branch: string; path: string }
  | { name: 'notFound' };

export function matchRoute(path: string): RouteMatch {
  if (path === '/' || path === '') return { name: 'home' };
  if (path === '/signin') return { name: 'signin' };
  if (path === '/register') return { name: 'register' };
  if (path === '/forgot') return { name: 'forgot' };
  if (path === '/settings') return { name: 'settings' };
  if (path === '/settings/password') return { name: 'settingsPassword' };
  if (path === '/search') return { name: 'search' };

  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 2) {
    const owner = segments[0];
    const repoName = segments[1];
    if (segments.length === 2) {
      return { name: 'repositoryOverview', owner, repoName, view: 'overview' };
    }
    if (segments.length === 3) {
      if (segments[2] === 'code') {
        return { name: 'repositoryOverview', owner, repoName, view: 'code' };
      }
      if (segments[2] === 'issues') {
        return { name: 'repositoryTab', owner, repoName, tab: 'issues' };
      }
      if (segments[2] === 'pulls') {
        return { name: 'repositoryTab', owner, repoName, tab: 'pulls' };
      }
      if (segments[2] === 'settings') {
        return { name: 'repositoryTab', owner, repoName, tab: 'settings' };
      }
    }
    if (segments.length === 4 && segments[2] === 'issues' && /^\d+$/.test(segments[3])) {
      return { name: 'issueDetail', owner, repoName, number: segments[3] };
    }
    if (segments.length === 4 && segments[2] === 'settings' && segments[3] === 'general') {
      return { name: 'repositoryTab', owner, repoName, tab: 'general' };
    }
    if (segments[2] === 'blob' && segments.length >= 4) {
      return {
        name: 'file',
        owner,
        repoName,
        branch: segments[3],
        path: segments.slice(4).join('/'),
      };
    }
    if (segments[2] === 'tree' && segments.length >= 4) {
      return {
        name: 'tree',
        owner,
        repoName,
        branch: segments[3],
        path: segments.slice(4).join('/'),
      };
    }
  }
  return { name: 'notFound' };
}
