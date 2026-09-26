import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type { IssueDetail } from '../types';

/**
 * The REQ-5-3-3 scenario's target issue. The mock initial state keeps the
 * seeded milestone `Q3 launch` on the issue, while the repository also
 * contains the selectable milestone `v1.0` that the issue is not associated
 * with — matching the scenario precondition “Seed data provides a selectable
 * milestone belonging to the current repository and an issue not yet
 * associated with it”.
 */
const seededIssue: IssueDetail = {
  number: 1,
  title: 'Improve onboarding',
  state: 'open',
  author: 'alice-dev',
  body: 'Describe the onboarding improvement.',
  labels: ['bug', 'documentation'],
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

/** The repository milestone options of the current repository (acme-docs). */
const repositoryMilestones = ['Q3 launch', 'v1.0'];

/**
 * A mutable in-memory “server” for the milestone tests, shared across renders
 * within one test: the detail GET returns the current record; a successful
 * PUT replaces the milestone and appends the `milestoned` activity; a
 * successful DELETE clears it and appends the `demilestoned` activity; the
 * issues-list GET returns rows derived from the current record so the list
 * reflects the same persisted state as the detail page.
 */
function milestoneRoutes(role: string) {
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
        labels: ['bug', 'documentation'],
        role,
      },
    }),
    '/api/repositories/acme-demo/acme-docs/issues/1': () => ({
      status: 200,
      body: { ok: true, issue: structuredClone(current), role },
    }),
    '/api/repositories/acme-demo/acme-docs/issues/1/milestones': () => ({
      status: 200,
      body: { ok: true, milestones: repositoryMilestones },
    }),
    'PUT /api/repositories/acme-demo/acme-docs/issues/1/milestones/v1.0': () => {
      if (!current.milestone || current.milestone.title !== 'v1.0') {
        current.milestone = { title: 'v1.0' };
        current.updatedAt = changedAt;
        current.activity.push({
          type: 'milestoned',
          actor: 'alice-dev',
          createdAt: changedAt,
          body: 'v1.0',
        });
      }
      return {
        status: 200,
        body: { ok: true, issue: structuredClone(current), role },
      };
    },
    'DELETE /api/repositories/acme-demo/acme-docs/issues/1/milestones': () => {
      if (current.milestone) {
        current.activity.push({
          type: 'demilestoned',
          actor: 'alice-dev',
          createdAt: changedAt,
          body: current.milestone.title,
        });
        current.milestone = null;
        current.updatedAt = changedAt;
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

describe('REQ-5-3-3 Assign Issues and Pull Requests to a Milestone', () => {
  it('Scenario 1: an Admin user selects v1.0, sees it on the detail page, then chooses None; reload stays consistent', async () => {
    const user = userEvent.setup();
    const routes = milestoneRoutes('admin');
    const fetchSpy = mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const first = render(<App />);

    // The detail page shows the seeded record and the Milestone settings
    // button (a button whose accessible name is exactly “Milestone”).
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).getByText('Q3 launch')).toBeInTheDocument();
    const settings = screen.getByRole('button', { name: 'Milestone' });
    expect(settings).toHaveAttribute('aria-expanded', 'false');

    // Opening the picker shows one option per current-repository milestone
    // (exact names) plus the “None” removal option; the associated Q3 launch
    // milestone is selected, v1.0 is not.
    await user.click(settings);
    expect(settings).toHaveAttribute('aria-expanded', 'true');
    expect(
      await screen.findByRole('option', { name: 'Q3 launch' })
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'v1.0' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('option', { name: 'None' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    // Only the current repository's milestones are offered — a milestone
    // stored in another repository never appears.
    expect(screen.queryByRole('option', { name: 'v2.0' })).not.toBeInTheDocument();

    // Clicking the v1.0 option immediately saves the association and closes
    // the picker without a separate Save action.
    await user.click(screen.getByRole('option', { name: 'v1.0' }));
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([input, init]) =>
            String(input).includes('/issues/1/milestones/v1.0') &&
            (init?.method ?? 'GET') === 'PUT'
        )
      ).toBe(true);
    });
    expect(await within(sidebar).findByText('v1.0')).toBeInTheDocument();
    expect(
      await screen.findByText(/alice-dev added this to the v1.0 milestone/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'v1.0' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Milestone' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    // Reopening the detail page still shows v1.0; reopening the picker shows
    // it selected; clicking “None” removes the association and closes the
    // picker.
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const reloadedSidebar = await screen.findByRole('complementary');
    expect(await within(reloadedSidebar).findByText('v1.0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Milestone' }));
    expect(
      await screen.findByRole('option', { name: 'v1.0' })
    ).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'None' }));
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([input, init]) =>
            String(input).includes('/issues/1/milestones') &&
            (init?.method ?? 'GET') === 'DELETE'
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        screen.queryByText('v1.0', { selector: '.issue-sidebar-section *' })
      ).not.toBeInTheDocument();
    });
    expect(
      await screen.findByText(/alice-dev removed this from the v1.0 milestone/)
    ).toBeInTheDocument();
    expect(screen.getByText('No milestone')).toBeInTheDocument();

    // After refreshing the detail page only the last saved milestone state
    // remains; the historical milestoned/demilestoned activities remain.
    first.unmount();
    vi.unstubAllGlobals();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    const finalSidebar = await screen.findByRole('complementary');
    expect(
      within(finalSidebar).queryByText('v1.0')
    ).not.toBeInTheDocument();
    expect(within(finalSidebar).getByText('No milestone')).toBeInTheDocument();
    expect(
      screen.getByText(/alice-dev added this to the v1.0 milestone/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/alice-dev removed this from the v1.0 milestone/)
    ).toBeInTheDocument();
  });

  it('Write and Read users have no Milestone settings button (the server rejects their submissions anyway)', async () => {
    for (const role of ['write', 'read']) {
      const routes = milestoneRoutes(role);
      mockFetch(routes);
      navigate('#/repositories/acme-demo/acme-docs/issues/1');
      render(<App />);
      expect(
        await screen.findByRole('heading', { name: 'Improve onboarding' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Milestone' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'v1.0' })).not.toBeInTheDocument();
      vi.unstubAllGlobals();
      window.location.hash = '';
    }
  });

  it('Triage users get the Milestone settings button and can select a milestone', async () => {
    const user = userEvent.setup();
    const routes = milestoneRoutes('triage');
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Milestone' }));
    expect(
      await screen.findByRole('option', { name: 'v1.0' })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Q3 launch' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument();
  });

  it('an unauthenticated visitor sees the issue read view but no milestone controls', async () => {
    const routes = {
      ...milestoneRoutes('read'),
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    };
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Milestone' })).not.toBeInTheDocument();
  });
});
