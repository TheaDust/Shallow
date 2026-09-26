import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

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
];

/** The REQ-6-3-1 detail payload of the seeded Open PR: title, description,
 * base/compare branches, one discussion comment, one comparable commit, and
 * a changed file with its per-file diff. */
const pullDetail = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const visitorRoutes = {
  '/api/auth/session': () => ({
    status: 200,
    body: { authenticated: false },
  }),
  '/api/repositories/acme-demo/acme-docs/pulls': () => ({
    status: 200,
    body: { ok: true, pulls: seededPulls, role: 'read' },
  }),
  '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
    status: 200,
    body: { ok: true, pull: pullDetail(), role: 'read' },
  }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-6-3-1 View Pull Request Overview and Commits', () => {
  it('scenario 1: a visitor opens Conversation, Commits, and Files changed tabs in sequence from the PR list; all refer to the same PR', async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetch(visitorRoutes);

    // The visitor starts at the application home page in a fresh
    // unauthenticated browser session.
    navigate('#/');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'GitHub Collaboration Platform' })
    ).toBeInTheDocument();

    // The reviewer opens the Pull requests page and clicks the PR title.
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    expect(await screen.findByRole('heading', { name: 'Pull requests' })).toBeInTheDocument();
    const titleLink = await screen.findByRole('link', { name: 'Improve onboarding' });
    expect(titleLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/pulls/1'
    );
    await user.click(titleLink);

    // Conversation displays the exact title heading, the status, the
    // base/compare branches, the description, and the discussion comment.
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('release → main')).toBeInTheDocument();
    expect(
      screen.getByText('Improve the onboarding experience for new contributors.')
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Discussion' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Looking good — the onboarding improvements are clear and easy to follow.'
      )
    ).toBeInTheDocument();

    // Conversation, Commits, and Files changed are navigation links.
    expect(screen.getByRole('link', { name: 'Conversation' })).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/pulls/1?tab=conversation'
    );
    expect(screen.getByRole('link', { name: 'Commits' })).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/pulls/1?tab=commits'
    );
    expect(screen.getByRole('link', { name: 'Files changed' })).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/pulls/1?tab=files'
    );

    // Opening the Commits tab shows the Commit summary with the comparable
    // commits for the same PR.
    await user.click(screen.getByRole('link', { name: 'Commits' }));
    expect(
      await screen.findByRole('heading', { name: 'Commit summary' })
    ).toBeInTheDocument();
    expect(screen.getByText('1 commit')).toBeInTheDocument();
    expect(screen.getByText('Add onboarding guide')).toBeInTheDocument();
    expect(screen.getByText('alice-dev')).toBeInTheDocument();

    // Opening the Files changed tab shows the Changed files summary of the
    // same PR's current diff (the aggregate statistics in the format
    // "<addition count> additions, <deletion count> deletions").
    await user.click(screen.getByRole('link', { name: 'Files changed' }));
    expect(
      await screen.findByRole('heading', { name: 'Changed files' })
    ).toBeInTheDocument();
    expect(screen.getByText('2 files changed')).toBeInTheDocument();
    expect(screen.getByText('4 additions, 1 deletions')).toBeInTheDocument();
    expect(screen.getAllByText('onboarding-guide.md').length).toBeGreaterThan(0);
    expect(screen.getAllByText('src/search.ts').length).toBeGreaterThan(0);
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();

    // All three views refer to the same PR number.
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    // Viewing is read-only: only GET requests were issued and no comment or
    // review controls exist on the page.
    const calls = fetchSpy.mock.calls.map((c) => ({
      method: c[1]?.method ?? 'GET',
      path: String(c[0]).split('?')[0],
    }));
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(
      calls.some((c) => c.path === '/api/repositories/acme-demo/acme-docs/pulls/1')
    ).toBe(true);
    expect(
      screen.queryByRole('textbox', { name: 'Comment' })
    ).not.toBeInTheDocument();
  });

  it('scenario 1 continuation: refreshing any tab keeps the title, branches, and commits unchanged', async () => {
    const user = userEvent.setup();
    mockFetch(visitorRoutes);

    // The reviewer opened the Files changed tab; refreshing the same visible
    // page restores the same PR and allows the same navigation.
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=files');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('release → main')).toBeInTheDocument();
    expect(screen.getAllByText('onboarding-guide.md').length).toBeGreaterThan(0);

    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=commits');
    expect(
      await screen.findByRole('heading', { name: 'Commit summary' })
    ).toBeInTheDocument();
    expect(screen.getByText('Add onboarding guide')).toBeInTheDocument();
    expect(screen.getByText('release → main')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    // Leaving and reopening the same visible page restores the same PR.
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Improve onboarding' }));
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('release → main')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Looking good — the onboarding improvements are clear and easy to follow.'
      )
    ).toBeInTheDocument();
  });

  it('scenario 2: a signed-in user (alice-dev) views the workflow; the result persists after refresh', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: false },
      }),
      'POST /api/auth/signin': () => ({
        status: 200,
        body: {
          ok: true,
          username: 'alice-dev',
          email: 'alice.dev@example.test',
        },
      }),
      '/api/users/alice-dev/repositories': () => ({
        status: 200,
        body: { ok: true, repositories: [] },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls': () => ({
        status: 200,
        body: { ok: true, pulls: seededPulls, role: 'admin' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(), role: 'admin' },
      }),
    });

    // The user starts at the home page and signs in as alice-dev with the
    // valid password, then follows the visible controls for the view pull
    // request overview and commits workflow.
    navigate('#/');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'GitHub Collaboration Platform' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to GitHub' })
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Username or email'), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // The account username is visible after authentication.
    expect(await screen.findByText('Signed in as')).toBeInTheDocument();
    expect(screen.getAllByText('alice-dev').length).toBeGreaterThan(0);

    // The signed-in user opens the PR detail page.
    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('release → main')).toBeInTheDocument();
    expect(
      screen.getByText('Improve the onboarding experience for new contributors.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Looking good — the onboarding improvements are clear and easy to follow.'
      )
    ).toBeInTheDocument();
    // The workflow headings and navigation are present.
    expect(screen.getByRole('link', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Commits' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Files changed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Checks' })).toBeInTheDocument();

    // Refreshing or reopening the visible destination keeps the result
    // persisted (same title, branches, and commits).
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=commits');
    expect(
      await screen.findByRole('heading', { name: 'Commit summary' })
    ).toBeInTheDocument();
    expect(screen.getByText('Add onboarding guide')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('release → main')).toBeInTheDocument();

    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=conversation');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Looking good — the onboarding improvements are clear and easy to follow.'
      )
    ).toBeInTheDocument();
  });

  it('REQ-6-3-2 scenario 1: a visitor opens Files changed, selects the modified file, and expands its diff block; viewing stays read-only', async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetch(visitorRoutes);

    // The visitor starts at the application home page in a fresh
    // unauthenticated browser session and opens the accessible PR detail
    // page (the seeded Open PR Improve onboarding, whose comparison
    // contains one added file and one modified file).
    navigate('#/');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'GitHub Collaboration Platform' })
    ).toBeInTheDocument();
    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    // The user clicks Files changed. The page displays the PR's changed
    // file paths (verbatim), the per-file added/deleted counts, and the
    // aggregate statistics; unchanged files (README.md) are not displayed.
    await user.click(screen.getByRole('link', { name: 'Files changed' }));
    expect(
      await screen.findByRole('heading', { name: 'Changed files' })
    ).toBeInTheDocument();
    expect(screen.getByText('2 files changed')).toBeInTheDocument();
    expect(screen.getByText('4 additions, 1 deletions')).toBeInTheDocument();
    expect(screen.getAllByText('src/search.ts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('onboarding-guide.md').length).toBeGreaterThan(0);
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'src/search.ts' })
    ).toBeInTheDocument();

    // Diff blocks start collapsed; expanding the modified file's block
    // shows its added/deleted lines.
    expect(
      screen.queryByText('export const searchFlow = true;')
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Expand diff for src/search.ts' })
    );
    expect(
      screen.getByRole('button', { name: 'Collapse diff for src/search.ts' })
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText('-export const searchFlow = true;')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '+export const searchFlow = true; // updated for the onboarding release'
      )
    ).toBeInTheDocument();

    // The added file's block can be expanded the same way.
    await user.click(
      screen.getByRole('button', { name: 'Expand diff for onboarding-guide.md' })
    );
    expect(
      screen.getByText('+# Onboarding guide')
    ).toBeInTheDocument();

    // After switching back to Conversation and reopening Files changed the
    // files, aggregate statistics, and PR status remain unchanged.
    await user.click(screen.getByRole('link', { name: 'Conversation' }));
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Files changed' }));
    expect(
      await screen.findByRole('heading', { name: 'Changed files' })
    ).toBeInTheDocument();
    expect(screen.getByText('2 files changed')).toBeInTheDocument();
    expect(screen.getByText('4 additions, 1 deletions')).toBeInTheDocument();
    expect(screen.getAllByText('src/search.ts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('onboarding-guide.md').length).toBeGreaterThan(0);

    // Expanding is read-only: only GET requests were issued and the PR
    // status text is still the same.
    const calls = fetchSpy.mock.calls.map((c) => ({
      method: c[1]?.method ?? 'GET',
      path: String(c[0]).split('?')[0],
    }));
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('scenario 2 rejection: an unknown PR number leaves the original state unchanged', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: {
          authenticated: true,
          username: 'alice-dev',
          email: 'alice.dev@example.test',
        },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(), role: 'admin' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/99': () => ({
        status: 404,
        body: { error: 'Pull request not found' },
      }),
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    // Opening an unknown PR shows the not-found state.
    navigate('#/repositories/acme-demo/acme-docs/pulls/99');
    expect(
      await screen.findByRole('heading', { name: 'Pull request not found' })
    ).toBeInTheDocument();

    // Reopening the known PR still shows the persisted result.
    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
  });
});
