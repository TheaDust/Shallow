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
    status: 'open' as const,
    baseBranch: 'main',
    compareBranch: 'release',
    reviewStatus: 'approved' as const,
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
 * REQ-6-5: builds the detail payload of the Open seed PR. The eligible
 * variant carries the satisfied merge conditions of the scenario (protected
 * main, 1 valid non-author approval, test success, no conflicts); the
 * blocked variant lacks the approval so `Review required by branch
 * protection` is reported. `status`/`merge` overrides let the test flip the
 * payload to the Merged state returned by the merge confirmation.
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
    reviews: [
      {
        id: 'review-1',
        reviewer: 'bob-reviewer',
        decision: 'approve',
        explanation: '',
        commitId: 'release-1',
        createdAt: '2026-01-21T00:00:00.000Z',
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
      test: { status: 'success', setter: 'alice-dev', updatedAt: '2026-01-21T12:00:00.000Z' },
    },
    mergeable: true,
    blockedReasons: [],
    mergeConditions: [
      { label: 'No merge conflicts', satisfied: true },
      { label: 'Requested changes are resolved', satisfied: true },
      { label: 'At least 1 valid non-author approval', satisfied: true },
      { label: 'Required status check "test" is successful', satisfied: true },
    ],
    mergedBy: null,
    mergedAt: null,
    mergeCommitId: null,
    ...overrides,
  };
  return base;
}

const blockedDetail = (overrides: Record<string, unknown> = {}) =>
  pullDetail({
    mergeable: false,
    blockedReasons: [
      'Review required by branch protection',
      'Required status check "test" is not successful.',
    ],
    mergeConditions: [
      { label: 'No merge conflicts', satisfied: true },
      { label: 'Requested changes are resolved', satisfied: true },
      { label: 'At least 1 valid non-author approval', satisfied: false },
      { label: 'Required status check "test" is successful', satisfied: false },
    ],
    ...overrides,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-6-5 Merge an Eligible Pull Request', () => {
  it('scenario 1: the maintainer confirms the only selectable method “Create a merge commit” via Merge pull request → Confirm merge; the PR displays Merged with the merger, time, and resulting commit identifier, and reloading preserves it', async () => {
    const user = userEvent.setup();
    // The merge POST returns the Merged state; the merged record persists
    // for later GETs (the mock "reload" reads the same detail).
    let merged = false;
    const mergedDetail = () =>
      pullDetail({
        status: 'merged',
        mergeable: false,
        blockedReasons: ['Pull request is not open.'],
        mergeConditions: [
          { label: 'No merge conflicts', satisfied: true },
          { label: 'Requested changes are resolved', satisfied: true },
          { label: 'At least 1 valid non-author approval', satisfied: true },
          { label: 'Required status check "test" is successful', satisfied: true },
        ],
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
      });
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
        body: { ok: true, pull: merged ? mergedDetail() : pullDetail(), role: 'admin' },
      }),
      'POST /api/repositories/acme-demo/acme-docs/pulls/1/merge': () => {
        merged = true;
        return {
          status: 200,
          body: { ok: true, pull: mergedDetail(), role: 'admin' },
        };
      },
    });

    // The maintainer (organization Owner → admin) opens the eligible PR.
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
    expect(
      screen.getByText('This pull request can be merged.')
    ).toBeInTheDocument();

    // The merge entry is an enabled button; clicking opens the confirmation
    // box whose only selectable method is “Create a merge commit” and whose
    // condition list shows the satisfied conditions.
    const mergeButton = screen.getByRole('button', { name: 'Merge pull request' });
    expect(mergeButton).toBeEnabled();
    await user.click(mergeButton);

    const dialog = await screen.findByRole('dialog', {
      name: 'Merge pull request',
    });
    const methodRadios = within(dialog).getAllByRole('radio');
    expect(methodRadios).toHaveLength(1);
    expect(methodRadios[0]).toHaveAccessibleName('Create a merge commit');
    expect(methodRadios[0]).toBeChecked();
    expect(
      within(dialog).getByText('No merge conflicts')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('At least 1 valid non-author approval')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Required status check "test" is successful')
    ).toBeInTheDocument();

    // The maintainer clicks Confirm merge in the confirmation box.
    await user.click(
      within(dialog).getByRole('button', { name: 'Confirm merge' })
    );

    // THEN: the PR displays Merged with the merger, time, and resulting
    // commit identifier.
    expect(await screen.findByText('Merged')).toBeInTheDocument();
    expect(await screen.findByText(/Merged by alice-dev/)).toBeInTheDocument();
    expect(screen.getByText(/Merge commit/)).toBeInTheDocument();
    expect(screen.getByText('merge-commit-abc123'.slice(0, 7))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Merge pull request' })
    ).not.toBeInTheDocument();

    // After refreshing the PR, the merged status and resulting commit remain.
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    expect(
      await screen.findByRole('heading', { name: 'Pull requests' })
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole('link', { name: 'Improve onboarding' })
    );
    expect(await screen.findByText('Merged')).toBeInTheDocument();
    expect(screen.getByText(/Merged by alice-dev/)).toBeInTheDocument();
    expect(screen.getByText('merge-commit-abc123'.slice(0, 7))).toBeInTheDocument();
  });

  it('scenario 2: a blocked PR keeps a visible disabled Merge pull request button and explains its unmet condition with “Review required by branch protection”; the state stays unchanged', async () => {
    const user = userEvent.setup();
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
        body: { ok: true, pull: blockedDetail(), role: 'admin' },
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

    // The blocked PR keeps a visible disabled merge button and explains its
    // unmet review condition before any click; no confirmation box opens.
    const mergeButton = screen.getByRole('button', { name: 'Merge pull request' });
    expect(mergeButton).toBeDisabled();
    expect(
      screen.getByText('This pull request cannot be merged.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Review required by branch protection')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Required status check "test" is not successful.')
    ).toBeInTheDocument();
    await user.click(mergeButton);
    expect(
      screen.queryByRole('dialog', { name: 'Merge pull request' })
    ).not.toBeInTheDocument();

    // The status text is unchanged after reopening the page.
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    expect(
      await screen.findByRole('heading', { name: 'Pull requests' })
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole('link', { name: 'Improve onboarding' })
    );
    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(
      screen.getByText('Review required by branch protection')
    ).toBeInTheDocument();
  });

  it('a merge-capable role is required: a Write reviewer sees the merge button disabled even on an eligible PR', async () => {
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
    expect(
      screen.getByRole('button', { name: 'Merge pull request' })
    ).toBeDisabled();
    expect(
      screen.queryByRole('dialog', { name: 'Merge pull request' })
    ).not.toBeInTheDocument();
  });

  it('a Draft PR keeps a present but disabled Merge pull request button and no confirmation box', async () => {
    const user = userEvent.setup();
    const draftDetail = pullDetail({
      status: 'draft',
      reviewStatus: 'review_required',
      reviews: [],
      checks: { test: { status: 'pending', setter: null, updatedAt: null } },
      mergeable: false,
      blockedReasons: ['Pull request is not open.'],
      mergeConditions: [
        { label: 'No merge conflicts', satisfied: true },
        { label: 'Requested changes are resolved', satisfied: true },
      ],
    });
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
        body: { ok: true, pull: draftDetail, role: 'admin' },
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
    expect(screen.getByText('Draft')).toBeInTheDocument();
    const mergeButton = screen.getByRole('button', { name: 'Merge pull request' });
    expect(mergeButton).toBeDisabled();
    await user.click(mergeButton);
    expect(
      screen.queryByRole('dialog', { name: 'Merge pull request' })
    ).not.toBeInTheDocument();
  });
});
