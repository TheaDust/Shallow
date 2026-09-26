import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    compareBranch: 'feature-search',
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

const pullDetail = (overrides: Record<string, unknown> = {}) => ({
  ...seededPulls[0],
  description: 'Improve the onboarding experience for new contributors.',
  baseCommitId: 'base-1',
  compareCommitId: 'compare-1',
  currentCompareCommitId: 'compare-1',
  activity: [
    {
      type: 'created',
      actor: 'alice-dev',
      createdAt: '2026-01-20T00:00:00.000Z',
    },
  ],
  commits: [
    {
      id: 'commit-2',
      shortId: 'commit-2',
      message: 'Improve onboarding',
      author: 'alice-dev',
      createdAt: '2026-01-20T00:00:00.000Z',
    },
  ],
  filesChanged: [],
  additions: 0,
  deletions: 0,
  checks: {
    test: { status: 'pending', setter: null, updatedAt: null },
  },
  mergeable: false,
  blockedReasons: ['Review required by branch protection'],
  ...overrides,
});

const pullsOnlyRoutes = {
  '/api/auth/session': () => ({
    status: 200,
    body: { authenticated: false },
  }),
  '/api/repositories/acme-demo/acme-docs/pulls': () => ({
    status: 200,
    body: { ok: true, pulls: seededPulls, role: 'read' },
  }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-6-1 Pull requests list and detail', () => {
  it('the Pull requests page lists number, title link, author, branches and status', async () => {
    mockFetch(pullsOnlyRoutes);
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Pull requests' })).toBeInTheDocument();
    const onboardingLink = await screen.findByRole('link', { name: 'Improve onboarding' });
    expect(onboardingLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/pulls/1'
    );
    expect(await screen.findByRole('link', { name: 'Fix search' })).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();

    // The list is scoped to this repository; each row shows the status,
    // author, and the source → target branches.
    const list = screen.getByRole('list');
    expect(within(list).getByText('Open')).toBeInTheDocument();
    expect(within(list).getByText('Closed')).toBeInTheDocument();
    expect(within(list).getAllByText('feature-search → main')).toHaveLength(2);
    expect(within(list).getAllByText('alice-dev')).toHaveLength(2);

    // REQ-6-2-1: the status filter links, the Author textbox, and the
    // Review status select are present on the list page.
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Closed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Draft' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Merged' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Author' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Review status' })).toBeInTheDocument();
  });

  it('the PR detail page shows the title heading, Open status, tabs, and the Conversation merge state', async () => {
    mockFetch({
      ...pullsOnlyRoutes,
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(), role: 'read' },
      }),
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls/1');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('feature-search → main')).toBeInTheDocument();

    // Conversation, Commits, Files changed, and Checks are navigation links.
    expect(screen.getByRole('link', { name: 'Conversation' })).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/pulls/1?tab=conversation'
    );
    expect(screen.getByRole('link', { name: 'Commits' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Files changed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Checks' })).toBeInTheDocument();

    // The description and the creation activity appear in Conversation.
    expect(screen.getByText('Improve the onboarding experience for new contributors.')).toBeInTheDocument();
    expect(screen.getByText(/opened this pull request/)).toBeInTheDocument();

    // A PR without 1 valid non-author approval is shown as unmergeable.
    expect(screen.getByText('This pull request cannot be merged.')).toBeInTheDocument();
    expect(screen.getByText('Review required by branch protection')).toBeInTheDocument();
  });

  it('scenario 3: the Checks area shows test: pending, an Admin updates it to success with the Save button, and the display persists', async () => {
    const user = userEvent.setup();
    let currentDetail = pullDetail();
    const patchSpy = vi.fn((init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      currentDetail = pullDetail({
        checks: {
          test: { status: body.status, setter: 'alice-dev', updatedAt: '2026-01-22T00:00:00.000Z' },
        },
        blockedReasons: ['Review required by branch protection'],
        mergeable: false,
      });
      return { status: 200, body: { ok: true, pull: currentDetail, role: 'admin' } };
    });
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: currentDetail, role: 'admin' },
      }),
      'PATCH /api/repositories/acme-demo/acme-docs/pulls/1/checks': patchSpy,
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=checks');
    render(<App />);

    // The Checks area is available on arrival and displays test: pending.
    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Checks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('test: pending')).toBeInTheDocument();

    // The Admin gets a combobox named "test status" with a success option and
    // a Save button.
    const combobox = screen.getByRole('combobox', { name: 'test status' });
    expect(screen.getByRole('option', { name: 'success' })).toBeInTheDocument();
    await user.selectOptions(combobox, 'success');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Saving displays test: success and identifies the setter and time.
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(patchSpy.mock.calls[0][0]?.body))).toEqual({
      status: 'success',
    });
    expect(await screen.findByText('test: success')).toBeInTheDocument();
    expect(screen.getByText(/Set by alice-dev/)).toBeInTheDocument();

    // Reloading preserves the result for that compare commit.
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=checks');
    expect(await screen.findByText('test: success')).toBeInTheDocument();
    expect(screen.getByText(/Set by alice-dev/)).toBeInTheDocument();

    // Still unmergeable: no 1 valid non-author approval (the merge state is
    // shown on the Conversation view).
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=conversation');
    expect(
      await screen.findByText('This pull request cannot be merged.')
    ).toBeInTheDocument();
    expect(screen.getByText('Review required by branch protection')).toBeInTheDocument();
  });

  it('a non-Admin sees the Checks display without the test-status combobox or Save button', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(), role: 'read' },
      }),
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls/1?tab=checks');
    render(<App />);

    expect(await screen.findByText('test: pending')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'test status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

describe('REQ-6-2-1 Pull requests list and filter', () => {
  it('scenario 1: selecting Open and filtering the author to alice shows only the Open PR; switching to Closed hides it', async () => {
    const user = userEvent.setup();
    mockFetch({
      ...pullsOnlyRoutes,
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(), role: 'read' },
      }),
    });
    // The visitor starts on the application home page (fresh session), then
    // opens the Pull requests page of the public repository.
    navigate('#/');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'GitHub Collaboration Platform' })).toBeInTheDocument();
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    expect(await screen.findByRole('heading', { name: 'Pull requests' })).toBeInTheDocument();
    // The list initially contains one Open and one Closed PR, both by alice.
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix search' })).toBeInTheDocument();

    // The user selects the “Open” status filter link.
    await user.click(screen.getByRole('link', { name: 'Open' }));
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fix search' })).not.toBeInTheDocument();

    // The user filters the author to alice; the Open PR row still shows its
    // number, title, branches, author, and status.
    await user.type(screen.getByRole('searchbox', { name: 'Author' }), 'alice');
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getByText('Open')).toBeInTheDocument();
    expect(within(list).getByText('alice-dev')).toBeInTheDocument();
    expect(within(list).getByText('feature-search → main')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fix search' })).not.toBeInTheDocument();

    // Clicking the title opens the PR's detail page with the same title as a
    // heading.
    await user.click(screen.getByRole('link', { name: 'Improve onboarding' }));
    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('scenario 1 continuation: reloading keeps the filtered Open PR; reopening the list and selecting Open again shows it; switching to Closed hides it', async () => {
    const user = userEvent.setup();
    mockFetch({
      ...pullsOnlyRoutes,
      '/api/repositories/acme-demo/acme-docs/pulls/1': () => ({
        status: 200,
        body: { ok: true, pull: pullDetail(), role: 'read' },
      }),
    });
    // The filtered list URL (Open + author=alice) is reloaded directly.
    navigate('#/repositories/acme-demo/acme-docs/pulls?state=open&author=alice');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Pull requests' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fix search' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('aria-current', 'page');

    // Leaving the page and reopening the list starts from the combined view.
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix search' })).toBeInTheDocument();

    // Selecting Open again shows the same PR.
    await user.click(screen.getByRole('link', { name: 'Open' }));
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fix search' })).not.toBeInTheDocument();

    // After switching to Closed the Open PR is not displayed, and the Closed
    // PR takes its place; filtering did not change the PR data (the rows are
    // only hidden, the persisted records remain in the list response).
    await user.click(screen.getByRole('link', { name: 'Closed' }));
    expect(await screen.findByRole('link', { name: 'Fix search' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Improve onboarding' })).not.toBeInTheDocument();

    // Clicking the active Closed link again returns to the combined view.
    await user.click(screen.getByRole('link', { name: 'Closed' }));
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix search' })).toBeInTheDocument();
  });

  it('the review-status filter restricts the displayed rows without changing them', async () => {
    const user = userEvent.setup();
    const mixedPulls = [
      { ...seededPulls[0], reviewStatus: 'approved' },
      { ...seededPulls[1], reviewStatus: 'changes_requested' },
    ];
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: false },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls': () => ({
        status: 200,
        body: { ok: true, pulls: mixedPulls, role: 'read' },
      }),
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix search' })).toBeInTheDocument();

    const reviewSelect = screen.getByRole('combobox', { name: 'Review status' });
    await user.selectOptions(reviewSelect, 'approved');
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fix search' })).not.toBeInTheDocument();

    await user.selectOptions(reviewSelect, 'changes_requested');
    expect(await screen.findByRole('link', { name: 'Fix search' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Improve onboarding' })).not.toBeInTheDocument();

    // Selecting “All review statuses” restores every row.
    await user.selectOptions(reviewSelect, '');
    expect(await screen.findByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix search' })).toBeInTheDocument();
  });
});

describe('REQ-6-2-4 Draft detail and Ready for review', () => {
  const draftPull = (overrides: Record<string, unknown> = {}) => ({
    ...pullDetail(),
    title: 'Draft onboarding update',
    description: 'Draft of the onboarding flow improvements.',
    status: 'draft',
    baseBranch: 'main',
    compareBranch: 'draft-feature',
    ...overrides,
  });

  it('scenario 2: the author sees the Draft marker, branches, the disabled merge entry, and Ready for review with a single Confirm button', async () => {
    const user = userEvent.setup();
    let current = draftPull();
    const readySpy = vi.fn(() => {
      current = draftPull({
        status: 'open',
        activity: [
          {
            type: 'created',
            actor: 'alice-dev',
            createdAt: '2026-01-20T00:00:00.000Z',
          },
          {
            type: 'ready_for_review',
            actor: 'alice-dev',
            createdAt: '2026-01-21T00:00:00.000Z',
          },
        ],
      });
      return { status: 200, body: { ok: true, pull: current, role: 'admin' } };
    });
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: {
          authenticated: true,
          username: 'alice-dev',
          email: 'alice.dev@example.test',
        },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/3': () => ({
        status: 200,
        body: { ok: true, pull: current, role: 'admin' },
      }),
      'POST /api/repositories/acme-demo/acme-docs/pulls/3/ready-for-review': readySpy,
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls/3');
    render(<App />);

    // The detail page displays the seeded title, source/target branches
    // verbatim, the Draft marker, and a present but disabled Merge pull
    // request button.
    expect(
      await screen.findByRole('heading', { name: 'Draft onboarding update' })
    ).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('draft-feature → main')).toBeInTheDocument();
    const mergeButton = screen.getByRole('button', {
      name: 'Merge pull request',
    });
    expect(mergeButton).toBeDisabled();

    // The author clicks Ready for review: a confirmation dialog with a
    // single Confirm button appears.
    await user.click(
      screen.getByRole('button', { name: 'Ready for review' })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Ready for review',
    });
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(
      within(dialog).getByRole('button', { name: 'Confirm' })
    ).toBeInTheDocument();

    // Confirming transitions the same PR to Open.
    await user.click(
      within(dialog).getByRole('button', { name: 'Confirm' })
    );
    expect(readySpy).toHaveBeenCalledTimes(1);

    // The Draft status marker disappears, the title and branches are
    // unchanged, and a Ready for review activity appears in Conversation.
    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Draft onboarding update' })
    ).toBeInTheDocument();
    expect(screen.getByText('draft-feature → main')).toBeInTheDocument();
    expect(
      screen.getByText(/marked this pull request as ready for review/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Merge pull request' })
    ).toBeDisabled();
  });

  it('scenario 2 continuation: a reviewer (Read) sees the Draft but no Ready for review button', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: {
          authenticated: true,
          username: 'bob-reviewer',
          email: 'bob.reviewer@example.test',
        },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls/3': () => ({
        status: 200,
        body: { ok: true, pull: draftPull(), role: 'read' },
      }),
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls/3');
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Draft onboarding update' })
    ).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    // bob-reviewer is not the author and has no Maintain/Admin status: no
    // Ready for review control (the server also rejects 403).
    expect(
      screen.queryByRole('button', { name: 'Ready for review' })
    ).not.toBeInTheDocument();
    // The merge entry is present but disabled for every viewer.
    expect(
      screen.getByRole('button', { name: 'Merge pull request' })
    ).toBeDisabled();
  });
});
