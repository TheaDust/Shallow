import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type { PullRequestDetail, PullRequestStatus } from '../types';

const seededPulls = [
  {
    number: 1,
    title: 'Improve onboarding',
    author: 'alice-dev',
    status: 'open' as const,
    baseBranch: 'main',
    compareBranch: 'release',
    reviewStatus: 'review_required' as const,
    createdAt: '2026-01-20T00:00:00.000Z',
    updatedAt: '2026-01-20T00:00:00.000Z',
  },
  {
    number: 2,
    title: 'Fix search',
    author: 'alice-dev',
    status: 'closed' as const,
    baseBranch: 'main',
    compareBranch: 'feature-search',
    reviewStatus: 'review_required' as const,
    createdAt: '2026-01-21T00:00:00.000Z',
    updatedAt: '2026-01-21T00:00:00.000Z',
  },
];

/**
 * REQ-6-6: builds the detail payload of the authored Open seed PR
 * `Improve onboarding` (#1, main←release, author alice-dev). The status
 * override lets the test flip the payload between Open, Closed, and Merged;
 * the activity override carries the `closed`/`reopened` transition records
 * appended by each state change so the Conversation timeline shows both
 * transitions in sequence.
 */
function pullDetail(overrides: Record<string, unknown> = {}) {
  const base: PullRequestDetail = {
    ...seededPulls[0],
    description: 'Improve the onboarding experience for new contributors.',
    baseCommitId: 'base-1',
    compareCommitId: 'release-1',
    currentCompareCommitId: 'release-1',
    activity: [
      {
        type: 'created',
        actor: 'alice-dev',
        createdAt: '2026-01-20T00:00:00.000Z',
      },
    ],
    comments: [
      {
        id: 'comment-1',
        author: 'alice-dev',
        body: 'Looking good — the onboarding improvements are clear and easy to follow.',
        createdAt: '2026-01-20T12:00:00.000Z',
      },
    ],
    inlineComments: [],
    reviewers: [],
    reviews: [],
    commits: [
      {
        id: 'release-1',
        shortId: 'release-1',
        message: 'Add onboarding guide',
        author: 'alice-dev',
        createdAt: '2026-01-19T00:00:00.000Z',
      },
    ],
    filesChanged: [
      {
        path: 'onboarding-guide.md',
        content: '# Onboarding guide\n',
        additions: 3,
        deletions: 0,
        lines: [
          { type: 'add', text: '# Onboarding guide' },
          { type: 'add', text: '' },
          { type: 'add', text: 'Steps for new contributors to get started.' },
        ],
      },
    ],
    additions: 3,
    deletions: 0,
    checks: {
      test: { status: 'pending', setter: null, updatedAt: null },
    },
    mergeable: false,
    blockedReasons: [
      'Review required by branch protection',
      'Required status check "test" is not successful.',
    ],
    mergedBy: null,
    mergedAt: null,
    mergeCommitId: null,
    ...overrides,
  };
  return base;
}

const closedDetail = () =>
  pullDetail({
    status: 'closed' as PullRequestStatus,
    mergeable: false,
    blockedReasons: ['Pull request is not open.'],
    updatedAt: '2026-01-23T00:00:00.000Z',
    activity: [
      {
        type: 'created',
        actor: 'alice-dev',
        createdAt: '2026-01-20T00:00:00.000Z',
      },
      {
        type: 'closed',
        actor: 'alice-dev',
        createdAt: '2026-01-23T00:00:00.000Z',
      },
    ],
  });

const reopenedDetail = () =>
  pullDetail({
    status: 'open' as PullRequestStatus,
    updatedAt: '2026-01-23T12:00:00.000Z',
    activity: [
      {
        type: 'created',
        actor: 'alice-dev',
        createdAt: '2026-01-20T00:00:00.000Z',
      },
      {
        type: 'closed',
        actor: 'alice-dev',
        createdAt: '2026-01-23T00:00:00.000Z',
      },
      {
        type: 'reopened',
        actor: 'alice-dev',
        createdAt: '2026-01-23T12:00:00.000Z',
      },
    ],
  });

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-6-6 Close or Reopen a Pull Request Without Merging', () => {
  it('scenario 1: the author clicks “Close pull request” (Closed immediately, no confirmation dialog), then “Reopen pull request” (Open immediately); the timeline records both transitions and reload keeps the final Open status with the original discussion', async () => {
    const user = userEvent.setup();
    // The state POSTs persist the transition: the mock returns the Closed
    // detail after the close and the reopened detail after the reopen, and
    // later GETs (the "reload") read the same final Open state.
    let phase: 'open' | 'closed' | 'reopened' = 'open';
    const currentDetail = () =>
      phase === 'closed'
        ? closedDetail()
        : phase === 'reopened'
          ? reopenedDetail()
          : pullDetail();
    const fetchSpy = mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls': () => ({
        status: 200,
        body: { ok: true, pulls: seededPulls, role: 'admin' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: currentDetail(), role: 'admin' },
      }),
      'POST /api/repositories/acme-demo/acme-docs/pulls/1/state': (init) => {
        const payload = JSON.parse(String(init?.body));
        phase = payload.state === 'closed' ? 'closed' : 'reopened';
        return {
          status: 200,
          body: { ok: true, pull: currentDetail(), role: 'admin' },
        };
      },
    });

    // The PR author is signed in and has opened the unmerged Open PR.
    navigate('#/');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Workspace' })
    ).toBeInTheDocument();
    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Looking good — the onboarding improvements are clear and easy to follow.')).toBeInTheDocument();

    // The authorized author sees the Close pull request button (no extra
    // confirmation dialog).
    const closeButton = screen.getByRole('button', { name: 'Close pull request' });
    await user.click(closeButton);

    // THEN: the PR displays Closed immediately and the timeline records the
    // close transition; the discussion remains.
    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(screen.getByText(/closed this pull request/)).toBeInTheDocument();
    expect(screen.getByText('Looking good — the onboarding improvements are clear and easy to follow.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close pull request' })
    ).not.toBeInTheDocument();

    // The same authorized author then clicks Reopen pull request — the
    // status immediately restores Open and the timeline records the reopen.
    const reopenButton = screen.getByRole('button', { name: 'Reopen pull request' });
    await user.click(reopenButton);
    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(screen.getByText(/reopened this pull request/)).toBeInTheDocument();
    expect(screen.getByText(/closed this pull request/)).toBeInTheDocument();

    // After refreshing the detail page, the final Open status and the
    // original discussion remain, and Close pull request is available again.
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    expect(
      await screen.findByRole('heading', { name: 'Pull requests' })
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole('link', { name: 'Improve onboarding' })
    );
    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Looking good — the onboarding improvements are clear and easy to follow.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close pull request' })
    ).toBeInTheDocument();

    // The state transition is a single immediate POST — no confirmation
    // dialog was opened for either the close or the reopen.
    expect(
      screen.queryByRole('dialog')
    ).not.toBeInTheDocument();
    const statePosts = fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input).includes('/pulls/1/state') &&
        String(init?.method ?? 'GET').toUpperCase() === 'POST'
    );
    expect(statePosts).toHaveLength(2);
  });

  it('scenario 2: a signed-in viewer who is neither the PR author nor a maintainer sees neither Close nor Reopen controls on the readable Open PR, and the status stays unchanged', async () => {
    // bob-reviewer holds a Write grant on acme-docs but is not the author
    // of `Improve onboarding` and is not Maintain/Admin/Owner — for this
    // viewer both controls are absent (not merely disabled).
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls': () => ({
        status: 200,
        body: { ok: true, pulls: seededPulls, role: 'write' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(), role: 'write' },
      }),
    });

    navigate('#/');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Workspace' })
    ).toBeInTheDocument();
    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();

    // The viewer attempts to find a close or reopen operation: neither
    // control exists and the status remains Open.
    expect(
      screen.queryByRole('button', { name: 'Close pull request' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reopen pull request' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('a merged PR does not display close or reopen operations', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls': () => ({
        status: 200,
        body: { ok: true, pulls: seededPulls, role: 'admin' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: {
          ok: true,
          pull: pullDetail({
            status: 'merged',
            mergeable: false,
            blockedReasons: ['Pull request is not open.'],
            mergedBy: 'alice-dev',
            mergedAt: '2026-01-24T00:00:00.000Z',
            mergeCommitId: 'merge-commit-abc123',
            activity: [
              {
                type: 'created',
                actor: 'alice-dev',
                createdAt: '2026-01-20T00:00:00.000Z',
              },
              {
                type: 'merged',
                actor: 'alice-dev',
                createdAt: '2026-01-24T00:00:00.000Z',
              },
            ],
          }),
          role: 'admin',
        },
      }),
    });

    navigate('#/');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Workspace' })
    ).toBeInTheDocument();
    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Merged')).toBeInTheDocument();

    // Merged is terminal: the page does not display close or reopen
    // operations even for the author/owner.
    expect(
      screen.queryByRole('button', { name: 'Close pull request' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reopen pull request' })
    ).not.toBeInTheDocument();
  });
});
