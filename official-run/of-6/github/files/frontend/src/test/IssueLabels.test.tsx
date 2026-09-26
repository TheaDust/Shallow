import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type { IssueDetail } from '../types';

/**
 * The REQ-5-3-2 scenario's target issue. The mock initial state leaves the
 * `bug` label NOT applied to the issue (documentation is applied), matching
 * the scenario precondition “Seed data provides an existing label not yet
 * applied to the target issue”, so checking bug applies it and unchecking it
 * removes it. The repository label options are exactly bug + documentation.
 */
const seededIssue: IssueDetail = {
  number: 1,
  title: 'Improve onboarding',
  state: 'open',
  author: 'alice-dev',
  body: 'Describe the onboarding improvement.',
  labels: ['documentation'],
  milestone: { title: 'Q3 launch' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-18T00:00:00.000Z',
  closedAt: null,
  assignees: ['alice-dev'],
  comments: [
    {
      id: 'comment-1',
      author: 'alice-dev',
      body: 'Good idea — I will prepare the improved onboarding checklist.',
      createdAt: '2026-01-18T00:00:00.000Z',
    },
  ],
  activity: [
    { type: 'created', actor: 'alice-dev', createdAt: '2026-01-01T00:00:00.000Z' },
    {
      type: 'commented',
      actor: 'alice-dev',
      createdAt: '2026-01-18T00:00:00.000Z',
      body: 'Good idea — I will prepare the improved onboarding checklist.',
    },
  ],
};

/** The repository label options of the current repository (acme-docs). */
const repositoryLabels = ['bug', 'documentation'];

/**
 * A mutable in-memory “server” for the label tests, shared across renders
 * within one test: the detail GET returns the current record; a successful
 * PUT appends the `labeled` activity and the label; a successful DELETE
 * appends the `unlabeled` activity and removes the label; the issues-list
 * GET returns rows derived from the current record so the list reflects the
 * same persisted state as the detail page.
 */
function labelRoutes(role: string) {
  const current: IssueDetail = structuredClone(seededIssue);
  const changedAt = '2026-01-19T00:00:00.000Z';
  const listRow = () => ({
    number: current.number,
    title: current.title,
    state: current.state,
    author: current.author,
    body: current.body,
    labels: [...current.labels],
    milestone: current.milestone,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  });
  return {
    '/api/auth/session': () => ({
      status: 200,
      body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
    }),
    '/api/repositories/acme-demo/acme-docs/issues': () => ({
      status: 200,
      body: {
        ok: true,
        issues: [listRow()],
        labels: repositoryLabels,
        role,
      },
    }),
    '/api/repositories/acme-demo/acme-docs/issues/1': () => ({
      status: 200,
      body: { ok: true, issue: structuredClone(current), role },
    }),
    '/api/repositories/acme-demo/acme-docs/issues/1/labels': () => ({
      status: 200,
      body: { ok: true, labels: repositoryLabels },
    }),
    'PUT /api/repositories/acme-demo/acme-docs/issues/1/labels/bug': () => {
      if (!current.labels.includes('bug')) {
        current.labels.push('bug');
        current.labels.sort();
        current.updatedAt = changedAt;
        current.activity.push({
          type: 'labeled',
          actor: 'alice-dev',
          createdAt: changedAt,
          body: 'bug',
        });
      }
      return {
        status: 200,
        body: { ok: true, issue: structuredClone(current), role },
      };
    },
    'DELETE /api/repositories/acme-demo/acme-docs/issues/1/labels/bug': () => {
      if (current.labels.includes('bug')) {
        current.labels = current.labels.filter((l) => l !== 'bug');
        current.updatedAt = changedAt;
        current.activity.push({
          type: 'unlabeled',
          actor: 'alice-dev',
          createdAt: changedAt,
          body: 'bug',
        });
      }
      return {
        status: 200,
        body: { ok: true, issue: structuredClone(current), role },
      };
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-5-3-2 Apply Labels to an Issue', () => {
  it('Scenario 1: an Admin user checks bug, sees it on the detail page and the list, then unchecks it; reload stays consistent', async () => {
    const user = userEvent.setup();
    const routes = labelRoutes('admin');
    const fetchSpy = mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const first = render(<App />);

    // The detail page shows the seeded record and the Labels settings button
    // (a button whose accessible name is exactly “Labels”).
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).getByText('documentation')).toBeInTheDocument();
    const settings = screen.getByRole('button', { name: 'Labels' });
    expect(settings).toHaveAttribute('aria-expanded', 'false');

    // Opening the selector shows one option per current-repository label
    // (exact names); the applied documentation label is selected, bug is not.
    await user.click(settings);
    expect(settings).toHaveAttribute('aria-expanded', 'true');
    const bugOption = await screen.findByRole('option', { name: 'bug' });
    expect(bugOption).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('option', { name: 'documentation' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // Only the current repository's labels are offered — an external label
    // stored in another repository never appears.
    expect(screen.queryByRole('option', { name: 'urgent' })).not.toBeInTheDocument();

    // Clicking the bug option immediately saves the association and closes
    // the selector without a separate Save action.
    await user.click(bugOption);
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([input, init]) =>
            String(input).includes('/issues/1/labels/bug') &&
            (init?.method ?? 'GET') === 'PUT'
        )
      ).toBe(true);
    });
    expect(await within(sidebar).findByText('bug')).toBeInTheDocument();
    expect(
      await screen.findByText(/alice-dev added the bug label/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'bug' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Labels' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    // The issue list shows the same persisted label set as the detail page.
    navigate('#/repositories/acme-demo/acme-docs/issues');
    const listRow = await screen.findByRole('link', { name: 'Improve onboarding' });
    const row = listRow.closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('bug')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('documentation')).toBeInTheDocument();

    // Reopening the detail page still shows bug; reopening the selector shows
    // it selected; clicking the same option again removes the association and
    // closes the selector.
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const reloadedSidebar = await screen.findByRole('complementary');
    expect(await within(reloadedSidebar).findByText('bug')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Labels' }));
    expect(
      await screen.findByRole('option', { name: 'bug' })
    ).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'bug' }));
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([input, init]) =>
            String(input).includes('/issues/1/labels/bug') &&
            (init?.method ?? 'GET') === 'DELETE'
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        screen.queryByText('bug', { selector: '.issue-sidebar-labels *' })
      ).not.toBeInTheDocument();
    });
    expect(
      await screen.findByText(/alice-dev removed the bug label/)
    ).toBeInTheDocument();

    // After refreshing the detail page only the last saved label set remains;
    // the historical labeled/unlabeled activities remain.
    first.unmount();
    vi.unstubAllGlobals();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    const finalSidebar = await screen.findByRole('complementary');
    expect(await within(finalSidebar).findByText('documentation')).toBeInTheDocument();
    expect(
      within(finalSidebar).queryByText('bug')
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/alice-dev added the bug label/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/alice-dev removed the bug label/)
    ).toBeInTheDocument();
  });

  it('Write and Read users have no Labels settings button (the server rejects their submissions anyway)', async () => {
    for (const role of ['write', 'read']) {
      const routes = labelRoutes(role);
      mockFetch(routes);
      navigate('#/repositories/acme-demo/acme-docs/issues/1');
      render(<App />);
      expect(
        await screen.findByRole('heading', { name: 'Improve onboarding' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Labels' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'bug' })).not.toBeInTheDocument();
      vi.unstubAllGlobals();
      window.location.hash = '';
    }
  });

  it('Triage users get the Labels settings button and can apply labels', async () => {
    const user = userEvent.setup();
    const routes = labelRoutes('triage');
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Labels' }));
    expect(
      await screen.findByRole('option', { name: 'bug' })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'documentation' })).toBeInTheDocument();
  });

  it('an unauthenticated visitor sees the issue read view but no label controls', async () => {
    const routes = {
      ...labelRoutes('read'),
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    };
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Labels' })).not.toBeInTheDocument();
  });
});
