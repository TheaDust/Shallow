import { useEffect, useState } from 'react';
import { apiIssueDetail, apiRepositoryIssues, isApiError } from './api';
import type { IssueDetail, IssueSummary, RepoLabel, RepoMilestone, RepositoryDetail } from './api';

export type IssuesState =
  | { status: 'loading' }
  | {
      status: 'ready';
      repository: RepositoryDetail;
      issues: IssueSummary[];
      labels: RepoLabel[];
      milestones: RepoMilestone[];
    }
  | { status: 'notFound' }
  | { status: 'error' };

export function useRepositoryIssues(owner: string, name: string): {
  state: IssuesState;
  reload: () => void;
} {
  const [state, setState] = useState<IssuesState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    apiRepositoryIssues(owner, name)
      .then(({ repository, issues, labels, milestones }) => {
        if (!cancelled) setState({ status: 'ready', repository, issues, labels, milestones });
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

export type IssueState =
  | { status: 'loading' }
  | {
      status: 'ready';
      repository: RepositoryDetail;
      issue: IssueDetail;
      labels: RepoLabel[];
      milestones: RepoMilestone[];
    }
  | { status: 'notFound' }
  | { status: 'error' };

export function useIssueDetail(owner: string, name: string, number: number): {
  state: IssueState;
  reload: () => void;
} {
  const [state, setState] = useState<IssueState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    apiIssueDetail(owner, name, number)
      .then(({ repository, issue, labels, milestones }) => {
        if (!cancelled) setState({ status: 'ready', repository, issue, labels, milestones });
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
  }, [owner, name, number, attempt]);

  function reload() {
    setAttempt((v) => v + 1);
  }

  return { state, reload };
}

export interface IssuesFilterOptions {
  state?: string;
  q?: string;
  labels?: string[];
}

export function issuesUrl(owner: string, name: string, filters: IssuesFilterOptions = {}): string {
  const params = new URLSearchParams();
  if (filters.state) params.set('state', filters.state);
  if (filters.q) params.set('q', filters.q);
  if (filters.labels && filters.labels.length > 0) params.set('labels', filters.labels.join(','));
  const qs = params.toString();
  return `#/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues${qs ? `?${qs}` : ''}`;
}

export function issueUrl(owner: string, name: string, number: number): string {
  return `#/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`;
}

export function parseLabelsParam(raw: string | null): string[] {
  return (raw || '')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
}

// Reads the currently applied issue filters straight from the URL hash so that
// quick consecutive filter changes never build on a stale render.
export function filtersFromHash(hash: string): IssuesFilterOptions {
  const queryString = hash.split('?')[1] || '';
  const params = new URLSearchParams(queryString);
  return {
    state: params.get('state') || undefined,
    q: params.get('q') || undefined,
    labels: parseLabelsParam(params.get('labels')),
  };
}
