import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type { IssueDetail } from '../types';

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

/** The assignable members of acme-docs: alice-dev (organization Owner ->
 * Admin, already assigned) and dana-triage (the seeded eligible member);
 * carol-dev is outside the repository collaborator scope and never appears. */
const assignable = ['alice-dev', 'dana-triage'];

/**
 * A mutable in-memory “server” for the assignee tests, shared across renders
 * within one test: the detail GET returns the current record; a successful
 * PUT appends the `assigned` activity and the assignee; a successful DELETE
 * appends the `unassigned` activity and removes the assignee.
 */
function assigneeRoutes(role: string) {
  const current: IssueDetail = structuredClone(seededIssue);
  const changedAt = '2026-01-19T00:00:00.000Z';
  return {
    '/api/auth/session': () => ({
      status: 200,
      body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
    }),
    '/api/repositories/acme-demo/acme-docs/issues/1': () => ({
      status: 200,
      body: { ok: true, issue: current, role },
    }),
    '/api/repositories/acme-demo/acme-docs/issues/1/assignees': () => ({
      status: 200,
      body: { ok: true, assignable },
    }),
    'PUT /api/repositories/acme-demo/acme-docs/issues/1/assignees/dana-triage': () => {
      current.assignees.push('dana-triage');
      current.updatedAt = changedAt;
      current.activity.push({
        type: 'assigned',
        actor: 'alice-dev',
        createdAt: changedAt,
        body: 'dana-triage',
      });
      // The server responds with a freshly parsed object, so the mutation
      // routes return a clone (never the same reference as the state).
      return {
        status: 200,
        body: { ok: true, issue: structuredClone(current), role },
      };
    },
    'DELETE /api/repositories/acme-demo/acme-docs/issues/1/assignees/dana-triage': () => {
      current.assignees = current.assignees.filter((u) => u !== 'dana-triage');
      current.updatedAt = changedAt;
      current.activity.push({
        type: 'unassigned',
        actor: 'alice-dev',
        createdAt: changedAt,
        body: 'dana-triage',
      });
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

describe('REQ-5-3-1 Assign or Unassign Issue Participants', () => {
  it('Scenario 1: a Maintain/Admin user searches, checks, then unchecks the eligible member; metadata, activity, and reload stay consistent', async () => {
    const user = userEvent.setup();
    const routes = assigneeRoutes('admin');
    const fetchSpy = mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const first = render(<App />);

    // The detail page shows the seeded record and the Assignees settings
    // button (a button whose accessible name is exactly “Assignees”).
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).getByText('alice-dev')).toBeInTheDocument();
    const settings = screen.getByRole('button', { name: 'Assignees' });
    expect(settings).toHaveAttribute('aria-expanded', 'false');

    // Opening the selector shows the textbox “Search assignees” and one
    // option per assignable member (exact username); the already-assigned
    // member is selected. carol-dev (outside the collaborator scope) does not
    // appear.
    await user.click(settings);
    expect(settings).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Search assignees' })).toBeInTheDocument();
    const aliceOption = await screen.findByRole('option', { name: 'alice-dev' });
    expect(aliceOption).toHaveAttribute('aria-selected', 'true');
    const danaOption = screen.getByRole('option', { name: 'dana-triage' });
    expect(danaOption).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('option', { name: 'carol-dev' })).not.toBeInTheDocument();

    // Matching options update live as the user types (no Enter required).
    const search = screen.getByRole('textbox', { name: 'Search assignees' });
    await user.type(search, 'dana');
    expect(screen.getByRole('option', { name: 'dana-triage' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'alice-dev' })).not.toBeInTheDocument();

    // Clicking the member option immediately saves the assignment and closes
    // the selector without a separate Save action.
    await user.click(screen.getByRole('option', { name: 'dana-triage' }));
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([input, init]) =>
            String(input).includes('/issues/1/assignees/dana-triage') &&
            (init?.method ?? 'GET') === 'PUT'
        )
      ).toBe(true);
    });
    expect(await within(sidebar).findByText('dana-triage')).toBeInTheDocument();
    expect(
      await screen.findByText(/alice-dev assigned dana-triage to this issue/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Search assignees' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assignees' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    // Reopening the selector shows the selected member without another search
    // (still selected); clicking that option again removes the assignment and
    // closes the selector.
    await user.click(screen.getByRole('button', { name: 'Assignees' }));
    expect(
      await screen.findByRole('option', { name: 'dana-triage' })
    ).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'dana-triage' }));
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([input, init]) =>
            String(input).includes('/issues/1/assignees/dana-triage') &&
            (init?.method ?? 'GET') === 'DELETE'
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        screen.queryByText('dana-triage', { selector: 'aside *' })
      ).not.toBeInTheDocument();
    });
    expect(
      await screen.findByText(/alice-dev unassigned dana-triage from this issue/)
    ).toBeInTheDocument();

    // After refreshing the detail page only the final selected-assignee set
    // remains; the historical assignment and unassignment activities remain.
    first.unmount();
    vi.unstubAllGlobals();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    const reloadedSidebar = await screen.findByRole('complementary');
    expect(await within(reloadedSidebar).findByText('alice-dev')).toBeInTheDocument();
    expect(within(reloadedSidebar).queryByText('dana-triage')).not.toBeInTheDocument();
    expect(
      screen.getByText(/alice-dev assigned dana-triage to this issue/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/alice-dev unassigned dana-triage from this issue/)
    ).toBeInTheDocument();
  });

  it('Write and Read users have no Assignees settings button (the server rejects their submissions anyway)', async () => {
    for (const role of ['write', 'read']) {
      const routes = assigneeRoutes(role);
      mockFetch(routes);
      navigate('#/repositories/acme-demo/acme-docs/issues/1');
      render(<App />);
      expect(
        await screen.findByRole('heading', { name: 'Improve onboarding' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Assignees' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('textbox', { name: 'Search assignees' })
      ).not.toBeInTheDocument();
      vi.unstubAllGlobals();
      window.location.hash = '';
    }
  });

  it('Triage users get the Assignees settings button and can assign', async () => {
    const user = userEvent.setup();
    const routes = assigneeRoutes('triage');
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Assignees' }));
    expect(
      await screen.findByRole('textbox', { name: 'Search assignees' })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'dana-triage' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'alice-dev' })).toBeInTheDocument();
  });

  it('an unauthenticated visitor sees the issue read view but no assignee controls', async () => {
    const routes = {
      ...assigneeRoutes('read'),
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    };
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assignees' })).not.toBeInTheDocument();
  });
});
