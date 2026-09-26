import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type { IssueDetail } from '../types';

/**
 * The REQ-5-4 scenario's target issue. The mock initial state keeps the
 * seeded open issue `Improve onboarding` (labels bug + documentation,
 * milestone Q3 launch, assignee, description, one comment, created and
 * commented activities) — the status transitions must not change any of it.
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

/**
 * A mutable in-memory “server” for the close/reopen tests, shared across
 * renders within one test: the detail GET returns the current record; a
 * successful POST /state flips the Open/Closed status, sets/clears closedAt,
 * advances updatedAt, and appends the `closed`/`reopened` activity; the
 * issues-list GET returns rows derived from the current record so the list
 * reflects the same persisted state as the detail page.
 */
function stateRoutes(role: string, username: string) {
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
      body: { authenticated: true, username, email: `${username}@example.test` },
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
    'POST /api/repositories/acme-demo/acme-docs/issues/1/state': (
      init?: RequestInit
    ) => {
      const requested =
        init && init.body ? (JSON.parse(String(init.body)).state as string) : '';
      if (
        (requested === 'closed' && current.state === 'open') ||
        (requested === 'open' && current.state === 'closed')
      ) {
        current.state = requested as 'open' | 'closed';
        current.closedAt = requested === 'closed' ? changedAt : null;
        current.updatedAt = changedAt;
        current.activity.push({
          type: requested === 'closed' ? 'closed' : 'reopened',
          actor: username,
          createdAt: changedAt,
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

describe('REQ-5-4 Close or Reopen an Issue', () => {
  it('Scenario 1: an Admin closes the Open issue, sees Closed, reopens it, and the final Open state survives a reload', async () => {
    const user = userEvent.setup();
    const routes = stateRoutes('admin', 'alice-dev');
    const fetchSpy = mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const first = render(<App />);

    // The detail page shows the seeded open issue with its number, title,
    // status, description, metadata, and activity timeline.
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('documentation')).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
    // The assignee appears in the right-side Assignees metadata (the header
    // account button also shows the username, so scope to the sidebar).
    expect(
      within(screen.getByRole('complementary')).getByText('alice-dev')
    ).toBeInTheDocument();

    // The detail page offers “Close issue” while the issue is Open.
    const closeButton = screen.getByRole('button', { name: 'Close issue' });
    expect(screen.queryByRole('button', { name: 'Reopen issue' })).not.toBeInTheDocument();

    // Activating it immediately saves the change without an additional
    // confirmation: the page displays Closed and the timeline appends the
    // close event; the button flips to “Reopen issue”.
    await user.click(closeButton);
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([input, init]) =>
            String(input).includes('/issues/1/state') &&
            (init?.method ?? 'GET') === 'POST'
        )
      ).toBe(true);
    });
    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(
      await screen.findByText(/alice-dev closed this issue/)
    ).toBeInTheDocument();
    const reopenButton = screen.getByRole('button', { name: 'Reopen issue' });
    expect(
      screen.queryByRole('button', { name: 'Close issue' })
    ).not.toBeInTheDocument();
    // The transition does not change number, title, description, comments,
    // or metadata.
    expect(
      screen.getByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('documentation')).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
    expect(
      within(screen.getByRole('complementary')).getByText('alice-dev')
    ).toBeInTheDocument();

    // Reopening displays Open status and appends the reopen event after the
    // close event; the button flips back to “Close issue”.
    await user.click(reopenButton);
    expect(await screen.findByText('Open')).toBeInTheDocument();
    const activityItems = screen.getAllByRole('article');
    const activityText = activityItems.map((item) => item.textContent ?? '').join(' | ');
    const closeIndex = activityText.indexOf('alice-dev closed this issue');
    const reopenIndex = activityText.indexOf('alice-dev reopened this issue');
    expect(closeIndex).toBeGreaterThan(-1);
    expect(reopenIndex).toBeGreaterThan(closeIndex);
    expect(
      screen.getByRole('button', { name: 'Close issue' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reopen issue' })
    ).not.toBeInTheDocument();

    // After refreshing the detail page and the issue list, the final Open
    // state remains consistent and the “Close issue” button is available
    // again.
    first.unmount();
    vi.unstubAllGlobals();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close issue' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reopen issue' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/alice-dev closed this issue/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/alice-dev reopened this issue/)
    ).toBeInTheDocument();

    navigate('#/repositories/acme-demo/acme-docs/issues');
    const list = await screen.findByRole('list');
    expect(within(list).getByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(within(list).getByText('Open')).toBeInTheDocument();
  });

  it('Scenario 2: a Read viewer sees neither Close issue nor Reopen issue and the status stays Open', async () => {
    const routes = stateRoutes('read', 'bob-reviewer');
    const fetchSpy = mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    // Hiding BOTH controls is required for the Read viewer.
    expect(
      screen.queryByRole('button', { name: 'Close issue' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reopen issue' })
    ).not.toBeInTheDocument();
    // No state request was made.
    expect(
      fetchSpy.mock.calls.some(
        ([input]) => String(input).includes('/issues/1/state')
      )
    ).toBe(false);
  });

  it('Write users may only view the status (no close/reopen controls; the server rejects their submissions anyway)', async () => {
    const routes = stateRoutes('write', 'bob-reviewer');
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close issue' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reopen issue' })
    ).not.toBeInTheDocument();
  });

  it('an unauthenticated visitor sees the read view but neither close nor reopen control', async () => {
    const routes = {
      ...stateRoutes('read', 'bob-reviewer'),
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    };
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close issue' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reopen issue' })
    ).not.toBeInTheDocument();
  });
});
