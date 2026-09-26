import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type {
  PullRequestDetail,
  PullRequestInlineComment,
  PullRequestReviewSummary,
} from '../types';

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
  {
    number: 2,
    title: 'Fix search',
    author: 'alice-dev',
    status: 'closed',
    baseBranch: 'main',
    compareBranch: 'feature-search',
    reviewStatus: 'review_required',
    createdAt: '2026-01-21T00:00:00.000Z',
    updatedAt: '2026-01-21T00:00:00.000Z',
  },
  {
    number: 3,
    title: 'Draft onboarding update',
    author: 'alice-dev',
    status: 'draft',
    baseBranch: 'main',
    compareBranch: 'draft-feature',
    reviewStatus: 'review_required',
    createdAt: '2026-01-22T00:00:00.000Z',
    updatedAt: '2026-01-22T00:00:00.000Z',
  },
  {
    number: 4,
    title: 'Pending review scenario',
    author: 'alice-dev',
    status: 'open',
    baseBranch: 'main',
    compareBranch: 'pending-review',
    reviewStatus: 'review_required',
    createdAt: '2026-01-23T00:00:00.000Z',
    updatedAt: '2026-01-23T00:00:00.000Z',
  },
];

/**
 * REQ-6-3-4: builds the detail payload of the seeded Open PR `Improve
 * onboarding` (main ← release, commentable added lines in src/search.ts)
 * and of the separate Open PR `Pending review scenario` (main ←
 * pending-review). The reviews array is mutable so a submitted review is
 * reflected immediately and survives a mock "reload" (the same store is
 * read again).
 */
function pullDetail(
  number: number,
  reviews: PullRequestReviewSummary[],
  inlineComments: PullRequestInlineComment[] = []
) {
  const base = {
    1: {
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
    },
    4: {
      ...seededPulls[3],
      description: 'Separate open pull request for the pending review comment scenario.',
      baseCommitId: 'base-1',
      compareCommitId: 'pending-1',
      currentCompareCommitId: 'pending-1',
      activity: [
        {
          type: 'created',
          actor: 'alice-dev',
          createdAt: '2026-01-23T00:00:00.000Z',
        },
      ],
      comments: [],
      commits: [
        {
          id: 'pending-1',
          shortId: 'pending-1',
          message: 'Add pending review notes',
          author: 'alice-dev',
          createdAt: '2026-01-22T00:00:00.000Z',
        },
      ],
      filesChanged: [
        {
          path: 'pending-review.md',
          content: '# Pending review\n',
          additions: 3,
          deletions: 0,
          lines: [
            { type: 'add', text: '# Pending review' },
            { type: 'add', text: '' },
            {
              type: 'add',
              text: 'Scenario fixture with a commentable added line.',
            },
          ],
        },
      ],
      additions: 3,
      deletions: 0,
      checks: {
        test: { status: 'pending', setter: null, updatedAt: null },
      },
      mergeable: false,
      blockedReasons: ['Review required by branch protection'],
    },
  } as Record<number, Record<string, unknown>>;
  const reviewStatus = reviews.length
    ? reviews[reviews.length - 1].decision === 'request_changes'
      ? 'changes_requested'
      : reviews[reviews.length - 1].decision === 'approve'
        ? 'approved'
        : 'review_required'
    : 'review_required';
  return {
    ...(base[number] as Record<string, unknown>),
    reviews,
    inlineComments,
    reviewStatus,
  } as PullRequestDetail;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-6-3-4 Submit a Pull Request Review', () => {
  it('scenario 1: a non-author Write reviewer opens Review changes, enters an overall comment, selects Approve and submits; Conversation and the review summary show the reviewer, Approved status, overall comment, and time', async () => {
    const user = userEvent.setup();
    const reviews: PullRequestReviewSummary[] = [];
    const fetchSpy = mockFetch({
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
        body: { ok: true, pull: pullDetail(1, reviews), role: 'write' },
      }),
      'POST /api/repositories/acme-demo/acme-docs/pulls/1/reviews': (init) => {
        const payload = JSON.parse(String(init?.body)) as {
          decision: 'comment' | 'approve' | 'request_changes';
          explanation?: string;
        };
        reviews.push({
          id: `review-${reviews.length + 1}`,
          reviewer: 'bob-reviewer',
          decision: payload.decision,
          explanation: payload.explanation ?? '',
          commitId: 'release-1',
          createdAt: '2026-01-24T00:00:00.000Z',
        });
        return {
          status: 201,
          body: { ok: true, pull: pullDetail(1, reviews), role: 'write' },
        };
      },
    });

    // The reviewer signs in and opens the Files changed view of the Open PR.
    navigate('#/');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Workspace' })
    ).toBeInTheDocument();
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=files');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    // The reviewer activates the Review changes button under Files changed.
    await user.click(screen.getByRole('button', { name: 'Review changes' }));

    // One review form opens with an optional Summary field, radio controls
    // named Comment / Approve / Request changes, and a Submit review button.
    expect(screen.getByRole('textbox', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Approve' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Request changes' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Submit review' })
    ).toBeInTheDocument();

    // The reviewer enters an overall comment, selects Approve, and clicks
    // Submit review (Approve without a summary would also be valid).
    await user.type(
      screen.getByRole('textbox', { name: 'Summary' }),
      'The onboarding flow looks good to me.'
    );
    await user.click(screen.getByRole('radio', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Submit review' }));

    // The form closes and a brief status confirms the submission.
    expect(await screen.findByText('Review submitted')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Submit review' })
    ).not.toBeInTheDocument();

    // Conversation and the review summary display the reviewer, the
    // Approved status, the overall comment, and the time.
    await user.click(screen.getByRole('link', { name: 'Conversation' }));
    const summary = await screen.findByRole('heading', { name: 'Review summary' });
    const summarySection = within(summary.closest('section') as HTMLElement);
    expect(summarySection.getByText('bob-reviewer')).toBeInTheDocument();
    expect(summarySection.getByText('Approved')).toBeInTheDocument();
    expect(
      summarySection.getByText('The onboarding flow looks good to me.')
    ).toBeInTheDocument();
    expect(summarySection.getByText(/ago/)).toBeInTheDocument();

    // After refresh (leaving and reopening the same page) the decision still
    // exists: the Conversation shows the same reviewer/status/comment.
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=conversation');
    const summaryAfterReload = await screen.findByRole('heading', {
      name: 'Review summary',
    });
    const summarySectionReload = within(
      summaryAfterReload.closest('section') as HTMLElement
    );
    expect(summarySectionReload.getByText('bob-reviewer')).toBeInTheDocument();
    expect(summarySectionReload.getByText('Approved')).toBeInTheDocument();
    expect(
      summarySectionReload.getByText('The onboarding flow looks good to me.')
    ).toBeInTheDocument();

    // Exactly one review POST was issued.
    const posts = fetchSpy.mock.calls.filter(
      (c) => (c[1]?.method ?? 'GET') === 'POST'
    );
    expect(posts.length).toBe(1);
  });

  it('scenario 2: Request changes with a summary displays Changes requested and that exact summary; the decision remains after reload', async () => {
    const user = userEvent.setup();
    const reviews: PullRequestReviewSummary[] = [];
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/4': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(4, reviews), role: 'write' },
      }),
      'POST /api/repositories/acme-demo/acme-docs/pulls/4/reviews': (init) => {
        const payload = JSON.parse(String(init?.body)) as {
          decision: 'comment' | 'approve' | 'request_changes';
          explanation?: string;
        };
        reviews.push({
          id: `review-${reviews.length + 1}`,
          reviewer: 'bob-reviewer',
          decision: payload.decision,
          explanation: payload.explanation ?? '',
          commitId: 'pending-1',
          createdAt: '2026-01-24T00:00:00.000Z',
        });
        return {
          status: 201,
          body: { ok: true, pull: pullDetail(4, reviews), role: 'write' },
        };
      },
    });

    // The reviewer opens the separate Open PR that can be reviewed.
    navigate('#/repositories/acme-demo/acme-docs/pulls/4?tab=files');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Pending review scenario' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Summary' }),
      'The pending notes need a rewrite before merging.'
    );
    await user.click(screen.getByRole('radio', { name: 'Request changes' }));
    await user.click(screen.getByRole('button', { name: 'Submit review' }));
    expect(await screen.findByText('Review submitted')).toBeInTheDocument();

    // Conversation shows the reviewer, the Changes requested status, and the
    // exact summary.
    await user.click(screen.getByRole('link', { name: 'Conversation' }));
    const summary = await screen.findByRole('heading', { name: 'Review summary' });
    const summarySection = within(summary.closest('section') as HTMLElement);
    expect(summarySection.getByText('bob-reviewer')).toBeInTheDocument();
    expect(summarySection.getByText('Changes requested')).toBeInTheDocument();
    expect(
      summarySection.getByText('The pending notes need a rewrite before merging.')
    ).toBeInTheDocument();

    // The decision remains visible after reload.
    navigate('#/repositories/acme-demo/acme-docs/pulls/4?tab=conversation');
    const summaryAfterReload = await screen.findByRole('heading', {
      name: 'Review summary',
    });
    const summarySectionReload = within(
      summaryAfterReload.closest('section') as HTMLElement
    );
    expect(summarySectionReload.getByText('Changes requested')).toBeInTheDocument();
    expect(
      summarySectionReload.getByText('The pending notes need a rewrite before merging.')
    ).toBeInTheDocument();
  });

  it('a failed review submission is not displayed as published — the form stays open with the error and no decision is persisted', async () => {
    const user = userEvent.setup();
    const reviews: PullRequestReviewSummary[] = [];
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(1, reviews), role: 'write' },
      }),
      'POST /api/repositories/acme-demo/acme-docs/pulls/1/reviews': () => ({
        status: 500,
        body: { error: 'The review could not be saved' },
      }),
    });

    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=files');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('radio', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Submit review' }));

    // The failure is shown in the open form and nothing is displayed as
    // published; the Conversation keeps no review summary.
    expect(
      await screen.findByText('The review could not be saved')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit review' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Conversation' }));
    expect(
      screen.queryByRole('heading', { name: 'Review summary' })
    ).not.toBeInTheDocument();
  });

  it('users without review permission see no Review changes button — the PR author, Read visitors, and anonymous callers', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(1, []), role: 'admin' },
      }),
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=files');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    // The PR author sees the diff but no Review changes button.
    expect(
      screen.queryByRole('button', { name: 'Review changes' })
    ).not.toBeInTheDocument();

    // A visitor (no session) sees the Files changed view read-only with no
    // Review changes button either.
    vi.unstubAllGlobals();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: false },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(1, []), role: 'read' },
      }),
    });
    navigate('#/');
    await screen.findByRole('heading', { name: 'Workspace' });
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=files');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Review changes' })
    ).not.toBeInTheDocument();
  });
});
