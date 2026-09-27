import { useEffect, useState } from 'react';
import { apiRepositoryDetail, isApiError } from './api';
import type { RepositoryDetail } from './api';

export type RepositoryState =
  | { status: 'loading' }
  | { status: 'ready'; repository: RepositoryDetail }
  | { status: 'notFound' }
  | { status: 'error' };

export function useRepositoryDetail(owner: string, name: string): {
  state: RepositoryState;
  reload: () => void;
} {
  const [state, setState] = useState<RepositoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    apiRepositoryDetail(owner, name)
      .then(({ repository }) => {
        if (!cancelled) setState({ status: 'ready', repository });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isApiError(err) && err.status === 404) {
          setState({ status: 'notFound' });
        } else {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, attempt]);

  function reload() {
    setAttempt((v) => v + 1);
  }

  return { state, reload };
}

export function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function repoUrl(owner: string, name: string, suffix = ''): string {
  return `#/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${suffix}`;
}

export function blobUrl(owner: string, name: string, branch: string, path: string): string {
  return `#/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob/${encodeURIComponent(branch)}/${path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

export function treeUrl(owner: string, name: string, branch: string, path: string): string {
  return `#/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree/${encodeURIComponent(branch)}/${path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}
