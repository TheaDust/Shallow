import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type { PullRequestDetail } from '../types';

const seededPulls = [
  {
    number: 1,
    title: 'Improve onboarding',
    author: 'alice-dev',
    status: 'open',
    baseBranch: 'main',
    compareBranch: 'release',
    reviewStatus: 'review_required',
    createdAt: '2026-01-20T00:00:00.000Z',
    updatedAt: '2026-01-20T00:00:00.000Z',
  },
];

/**
 * REQ-6-4: builds the detail payload of the seeded Open PR `Improve
 * onboarding` (main ← release). The `requested` array is mutable so a saved
 * or removed request is reflected immediately and survives a mock "reload"
 * (the same store is read again); requesting never generates a review or
 * activity record.
 */
function pullDetail(requested: string[]): PullRequestDetail {
  return {
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
    reviewers: [...requested],
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
        path: 'src/search.ts',
        content: '// Search flow\n',
        additions: 1,
        deletions: 1,
        lines: [
          { type: 'del', text: 'export const searchFlow = true;' },
          {
            type: 'add',
            text: 'export const searchFlow = true; // updated for the onboarding release',
          },
        ],
      },
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
    additions: 4,
    deletions: 1,
    checks: {
      test: { status: 'pending', setter: null, updatedAt: null },
    },
    mergeable: false,
    blockedReasons: ['Review required by branch protection'],
  } as PullRequestDetail;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-6-4 Request or Remove Pull Request Reviewers', () => {
  it('scenario 1: the author searches for and selects the collaborator under Reviewers on the right; the request is saved immediately and shown, persists after reload, and clicking Remove makes the request disappear without generating an approval or comment', async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    const fetchSpy = mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(requested), role: 'admin' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1/reviewers': () => ({
        status: 200,
        body: { ok: true, eligible: ['bob-reviewer'] },
      }),
      'PUT /api/repositories/acme-demo/acme-docs/pulls/1/reviewers/bob-reviewer': () => {
        if (!requested.includes('bob-reviewer')) {
          requested.push('bob-reviewer');
        }
        return {
          status: 200,
          body: { ok: true, pull: pullDetail(requested), role: 'admin' },
        };
      },
      'DELETE /api/repositories/acme-demo/acme-docs/pulls/1/reviewers/bob-reviewer': () => {
        const index = requested.indexOf('bob-reviewer');
        if (index >= 0) {
          requested.splice(index, 1);
        }
        return {
          status: 200,
          body: { ok: true, pull: pullDetail(requested), role: 'admin' },
        };
      },
    });

    // The signed-in author opens the Open PR detail page.
    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    // The Reviewers area on the right starts with no requested reviewer and
    // offers the settings button named Reviewers.
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).getByRole('heading', { name: 'Reviewers' })).toBeInTheDocument();
    expect(within(sidebar).getByText('No reviewers')).toBeInTheDocument();

    // The Reviewers button opens a picker with a textbox named Search.
    await user.click(screen.getByRole('button', { name: 'Reviewers' }));
    const searchBox = await screen.findByRole('textbox', { name: 'Search' });
    expect(searchBox).toBeInTheDocument();

    // Typing the eligible username immediately reveals an option with that
    // exact accessible name (no Enter or a separate search button).
    await user.type(searchBox, 'bob');
    const option = await screen.findByRole('option', { name: 'bob-reviewer' });
    expect(option).toBeInTheDocument();

    // Selecting the option saves the request immediately without a separate
    // Save action, closes the picker, and displays the username in the
    // reviewer area.
    await user.click(option);
    expect(
      screen.queryByRole('textbox', { name: 'Search' })
    ).not.toBeInTheDocument();
    expect(await within(sidebar).findByText('bob-reviewer')).toBeInTheDocument();
    expect(
      within(sidebar).getByRole('button', { name: 'Remove bob-reviewer' })
    ).toBeInTheDocument();

    // The request does not automatically generate an approval or a comment.
    expect(
      screen.queryByRole('heading', { name: 'Review summary' })
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByText('No reviewers')
    ).not.toBeInTheDocument();

    // After refreshing the detail page the request remains.
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=checks');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=conversation');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    const reloadedSidebar = screen.getByRole('complementary');
    expect(await within(reloadedSidebar).findByText('bob-reviewer')).toBeInTheDocument();

    // Clicking the remove button beside the collaborator immediately removes
    // the request and the username from the area, without a confirmation step.
    await user.click(
      within(reloadedSidebar).getByRole('button', { name: 'Remove bob-reviewer' })
    );
    expect(
      within(screen.getByRole('complementary')).queryByText('bob-reviewer')
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('complementary')).getByText('No reviewers')
    ).toBeInTheDocument();

    // After refreshing the detail page only the final request set remains.
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=checks');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=conversation');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    const finalSidebar = screen.getByRole('complementary');
    expect(within(finalSidebar).getByText('No reviewers')).toBeInTheDocument();
    expect(
      within(finalSidebar).queryByRole('button', { name: 'Remove bob-reviewer' })
    ).not.toBeInTheDocument();

    // Exactly one PUT (request) and one DELETE (remove) were issued.
    const puts = fetchSpy.mock.calls.filter(
      (c) => (c[1]?.method ?? 'GET') === 'PUT'
    );
    const deletes = fetchSpy.mock.calls.filter(
      (c) => (c[1]?.method ?? 'GET') === 'DELETE'
    );
    expect(puts.length).toBe(1);
    expect(deletes.length).toBe(1);
  });

  it('a user who is neither the author nor a maintainer cannot modify requests — no Reviewers button or Remove button is rendered', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail([]), role: 'write' },
      }),
    });

    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    // bob-reviewer (Write, not the author, not a maintainer) sees the
    // Reviewers area read-only: the heading and the empty state, but no
    // settings button and no Remove button.
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).getByRole('heading', { name: 'Reviewers' })).toBeInTheDocument();
    expect(within(sidebar).getByText('No reviewers')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reviewers' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove bob-reviewer' })
    ).not.toBeInTheDocument();
  });

  it('the picker filters candidates live as the user types and rejects no-match queries with a visible no-match state', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail([]), role: 'admin' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1/reviewers': () => ({
        status: 200,
        body: { ok: true, eligible: ['bob-reviewer'] },
      }),
    });

    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reviewers' }));
    const searchBox = await screen.findByRole('textbox', { name: 'Search' });
    await user.type(searchBox, 'zz');
    expect(
      await screen.findByText('No matching reviewer')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'bob-reviewer' })
    ).not.toBeInTheDocument();

    // Matching options update as the user types (no Enter required).
    await user.clear(searchBox);
    await user.type(searchBox, 'bob');
    expect(
      await screen.findByRole('option', { name: 'bob-reviewer' })
    ).toBeInTheDocument();
  });
});
