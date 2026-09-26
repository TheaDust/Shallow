import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type { PullRequestInlineComment } from '../types';

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
 * REQ-6-3-3: builds the detail payload of the seeded Open PR `Improve
 * onboarding` (main ← release) — src/search.ts carries one modified line
 * (one deleted + one added), onboarding-guide.md is an added file — plus the
 * separate Open PR `Pending review scenario` (main ← pending-review) whose
 * diff carries one added file with commentable added lines.
 */
function pullDetail(
  number: number,
  inlineComments: PullRequestInlineComment[]
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
      reviews: [],
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
  return {
    ...(base[number] as Record<string, unknown>),
    inlineComments,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-6-3-3 Add Review Comments to Changed Code Lines', () => {
  it('scenario 1: a non-author Write reviewer adds a single comment on an added line; it appears in the diff and Conversation and survives reload', async () => {
    const user = userEvent.setup();
    const inlineComments: PullRequestInlineComment[] = [];
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
        body: { ok: true, pull: pullDetail(1, inlineComments), role: 'write' },
      }),
      'POST /api/repositories/acme-demo/acme-docs/pulls/1/inline-comments': (init) => {
        const payload = JSON.parse(String(init?.body)) as {
          filePath: string;
          line: number;
          body: string;
          pending: boolean;
        };
        inlineComments.push({
          id: `inline-${inlineComments.length + 1}`,
          filePath: payload.filePath,
          line: payload.line,
          body: payload.body,
          author: 'bob-reviewer',
          commitId: 'release-1',
          createdAt: '2026-01-24T00:00:00.000Z',
          pending: payload.pending === true,
          outdated: false,
        });
        return {
          status: 201,
          body: { ok: true, pull: pullDetail(1, inlineComments), role: 'write' },
        };
      },
    });

    // The reviewer signs in and opens the Files changed page of the Open PR
    // they are allowed to comment on.
    navigate('#/');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Workspace' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('bob-reviewer').length).toBeGreaterThan(0);
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=files');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();

    // The reviewer locates an added code line and its file path, expands the
    // block, hovers the line and clicks the "+" button (accessibly named
    // Add comment).
    await user.click(screen.getByRole('button', { name: 'Expand diff for src/search.ts' }));
    const addButtons = screen.getAllByRole('button', { name: 'Add comment' });
    expect(addButtons.length).toBeGreaterThan(0);
    await user.click(addButtons[1]);

    // The editor is labeled Comment with Add single comment and Start a
    // review buttons.
    const editor = screen.getByRole('textbox', { name: 'Comment' });
    expect(screen.getByRole('button', { name: 'Add single comment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a review' })).toBeInTheDocument();

    // The reviewer enters a non-empty inline comment and selects Add single
    // comment.
    await user.type(editor, 'This line should stay aligned with the onboarding docs.');
    await user.click(screen.getByRole('button', { name: 'Add single comment' }));

    // The diff page immediately displays the comment (author + body) and the
    // Conversation displays it too.
    expect(
      await screen.findByText('This line should stay aligned with the onboarding docs.')
    ).toBeInTheDocument();
    expect(screen.getAllByText('bob-reviewer').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('link', { name: 'Conversation' }));
    expect(
      await screen.findByText('This line should stay aligned with the onboarding docs.')
    ).toBeInTheDocument();
    expect(screen.getAllByText('bob-reviewer').length).toBeGreaterThan(0);
    expect(screen.getByText(/on src\/search\.ts line 2/)).toBeInTheDocument();

    // After refresh the comment remains anchored to that file and line (the
    // block starts collapsed again, but the comment stays visible).
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=files');
    expect(
      await screen.findByRole('heading', { name: 'Changed files' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('This line should stay aligned with the onboarding docs.')
    ).toBeInTheDocument();
    expect(screen.getByText(/line 2/)).toBeInTheDocument();

    // Exactly one POST was issued (Add single comment publishes once).
    const posts = fetchSpy.mock.calls.filter(
      (c) => (c[1]?.method ?? 'GET') === 'POST'
    );
    expect(posts.length).toBe(1);
  });

  it('scenario 2: Start a review keeps the comment pending — visible to its author with the Pending review marker, not public in Conversation, retained after reload', async () => {
    const user = userEvent.setup();
    const inlineComments: PullRequestInlineComment[] = [];
    const fetchSpy = mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls': () => ({
        status: 200,
        body: { ok: true, pulls: seededPulls, role: 'write' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/4': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(4, inlineComments), role: 'write' },
      }),
      'POST /api/repositories/acme-demo/acme-docs/pulls/4/inline-comments': (init) => {
        const payload = JSON.parse(String(init?.body)) as {
          filePath: string;
          line: number;
          body: string;
          pending: boolean;
        };
        inlineComments.push({
          id: `inline-${inlineComments.length + 1}`,
          filePath: payload.filePath,
          line: payload.line,
          body: payload.body,
          author: 'bob-reviewer',
          commitId: 'pending-1',
          createdAt: '2026-01-24T00:00:00.000Z',
          pending: payload.pending === true,
          outdated: false,
        });
        return {
          status: 201,
          body: { ok: true, pull: pullDetail(4, inlineComments), role: 'write' },
        };
      },
    });

    // The reviewer opens the separate Open PR's Files changed view and
    // locates a changed line.
    navigate('#/repositories/acme-demo/acme-docs/pulls/4?tab=files');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Pending review scenario' })
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Expand diff for pending-review.md' })
    );
    await user.click(screen.getAllByRole('button', { name: 'Add comment' })[0]);
    await user.type(
      screen.getByRole('textbox', { name: 'Comment' }),
      'Pending comment for the onboarding notes.'
    );
    await user.click(screen.getByRole('button', { name: 'Start a review' }));

    // The body and the Pending review marker are displayed to the author
    // immediately in the diff view.
    expect(
      await screen.findByText('Pending comment for the onboarding notes.')
    ).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();

    // The comment is not public: the Conversation does not display it.
    await user.click(screen.getByRole('link', { name: 'Conversation' }));
    expect(
      screen.queryByText('Pending comment for the onboarding notes.')
    ).not.toBeInTheDocument();

    // The pending draft is retained after reload (still pending, still shown
    // to its author).
    navigate('#/repositories/acme-demo/acme-docs/pulls/4?tab=files');
    expect(
      await screen.findByText('Pending comment for the onboarding notes.')
    ).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();

    const posts = fetchSpy.mock.calls.filter(
      (c) => (c[1]?.method ?? 'GET') === 'POST'
    );
    expect(posts.length).toBe(1);
  });

  it('an empty comment is rejected with Comment is required and no request is sent', async () => {
    const user = userEvent.setup();
    const inlineComments: PullRequestInlineComment[] = [];
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
        body: { ok: true, pull: pullDetail(1, inlineComments), role: 'write' },
      }),
      'POST /api/repositories/acme-demo/acme-docs/pulls/1/inline-comments': () => ({
        status: 201,
        body: { ok: true, pull: pullDetail(1, inlineComments), role: 'write' },
      }),
    });

    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=files');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand diff for src/search.ts' }));
    await user.click(screen.getAllByRole('button', { name: 'Add comment' })[1]);
    const editor = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(editor, '   ');
    await user.click(screen.getByRole('button', { name: 'Add single comment' }));

    // The exact error is shown and no partial comment is displayed.
    expect(await screen.findByText('Comment is required')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Comment' })).toBeInTheDocument();
    const posts = fetchSpy.mock.calls.filter(
      (c) => (c[1]?.method ?? 'GET') === 'POST'
    );
    expect(posts.length).toBe(0);
  });

  it('the PR author and Read visitors see no Add comment buttons; only a non-author Write/Maintain/Admin may comment', async () => {
    // The PR author (alice-dev, Admin) signs in and opens the Files changed
    // view: no Add comment buttons are rendered.
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: 'Expand diff for src/search.ts' }));
    expect(screen.queryByRole('button', { name: 'Add comment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Comment' })).not.toBeInTheDocument();

    // A visitor (no session) sees the diff read-only with no buttons either.
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
    // Leave and reopen the same page so the detail view refetches under the
    // visitor context (the authenticated home renders the workspace).
    navigate('#/');
    await screen.findByRole('heading', { name: 'Workspace' });
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=files');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add comment' })).not.toBeInTheDocument();
    // The diff lines remain visible to the visitor after expanding the block.
    await user.click(
      screen.getByRole('button', { name: 'Expand diff for src/search.ts' })
    );
    expect(
      screen.getByText('+export const searchFlow = true; // updated for the onboarding release')
    ).toBeInTheDocument();
  });
});
