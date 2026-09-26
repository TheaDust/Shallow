import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

const legacyWelcomeIssue = {
  number: 2,
  title: 'Legacy welcome text',
  state: 'closed',
  author: 'alice-dev',
  body: 'The README still shows the legacy welcome text.',
  labels: ['bug'],
  milestone: null,
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-21T00:00:00.000Z',
};

const invalidEditSeed: IssueDetail = {
  number: 3,
  title: 'Original issue title',
  state: 'open',
  author: 'alice-dev',
  body: '',
  labels: [],
  milestone: null,
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: '2026-01-05T00:00:00.000Z',
  closedAt: null,
  assignees: [],
  comments: [],
  activity: [{ type: 'created', actor: 'alice-dev', createdAt: '2026-01-05T00:00:00.000Z' }],
};

/**
 * A mutable in-memory “server” for the issue edit tests, shared across
 * renders within one test: the GET returns the current record; a successful
 * PATCH mutates only the provided field and appends an `edited` activity
 * record; a rejected PATCH changes nothing. The Issues-list route derives its
 * rows from the same state so the list summary reflects edits immediately.
 */
function editRoutes() {
  const current: Record<number, IssueDetail> = {
    1: structuredClone(seededIssue),
    3: structuredClone(invalidEditSeed),
  };
  const editedAt = '2026-01-20T00:00:00.000Z';
  const detailRoute = (number: number, role: string) => (init?: RequestInit) => {
    const issue = current[number];
    if (init?.method === 'PATCH') {
      const payload = JSON.parse(String(init.body ?? '{}'));
      if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
        const title = String(payload.title).trim();
        if (title === '') {
          return { status: 400, body: { ok: false, errors: { title: 'Title is required' } } };
        }
        if (title.length > 256) {
          return { status: 400, body: { ok: false, errors: { title: 'Title is too long' } } };
        }
        issue.title = title;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'body')) {
        const body = String(payload.body ?? '').trim();
        if (body.length > 65536) {
          return { status: 400, body: { ok: false, errors: { body: 'Description is too long' } } };
        }
        issue.body = body;
      }
      issue.updatedAt = editedAt;
      issue.activity.push({
        type: 'edited',
        actor: 'alice-dev',
        createdAt: editedAt,
        body: Object.prototype.hasOwnProperty.call(payload, 'title')
          ? issue.title
          : issue.body,
      });
    }
    return { status: 200, body: { ok: true, issue, role } };
  };
  return {
    '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    '/api/repositories/acme-demo/acme-docs/issues/1': detailRoute(1, 'admin'),
    '/api/repositories/acme-demo/acme-docs/issues/3': detailRoute(3, 'admin'),
    '/api/repositories/acme-demo/acme-docs/issues': () => ({
      status: 200,
      body: {
        ok: true,
        issues: [current[1], legacyWelcomeIssue, current[3]],
        labels: ['bug', 'documentation'],
        role: 'admin',
      },
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-5-2-2 Edit an Issue Title and Description', () => {
  it('Scenario 1: a Write/Maintain/Admin user edits the title and the description; the list summary and the activity timeline reflect the edits and survive reload', async () => {
    const user = userEvent.setup();
    const routes = editRoutes();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const first = render(<App />);

    // The detail page shows the seeded record and the unique edit buttons.
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit issue title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit issue description' })).toBeInTheDocument();

    // “Edit” beside the title opens the form with a textbox labeled
    // “Issue title” prefilled with the current title and the save button.
    await user.click(screen.getByRole('button', { name: 'Edit issue title' }));
    const titleBox = screen.getByLabelText('Issue title');
    expect(titleBox).toHaveValue('Improve onboarding');
    await user.clear(titleBox);
    await user.type(titleBox, 'Improve onboarding and first-run setup');
    await user.click(screen.getByRole('button', { name: 'Save issue title' }));

    // The same issue number shows the new title; the activity timeline
    // records the edit.
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding and first-run setup' })
    ).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText(/alice-dev edited this issue/)).toBeInTheDocument();
    // Status, labels, assignees, and milestone remain unchanged.
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('documentation')).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).getByText('alice-dev')).toBeInTheDocument();

    // “Edit” beside the description opens its form; saving is a separate
    // action that changes only the description.
    await user.click(screen.getByRole('button', { name: 'Edit issue description' }));
    const descriptionBox = screen.getByLabelText('Issue description');
    expect(descriptionBox).toHaveValue('Describe the onboarding improvement.');
    await user.clear(descriptionBox);
    await user.type(descriptionBox, 'Updated onboarding description for new contributors.');
    await user.click(screen.getByRole('button', { name: 'Save issue description' }));

    expect(
      await screen.findByText('Updated onboarding description for new contributors.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Improve onboarding and first-run setup' })
    ).toBeInTheDocument();

    // The issue-list summary displays the new title (same number, other
    // issues untouched).
    vi.unstubAllGlobals();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues');
    expect(
      await screen.findByRole('link', { name: 'Improve onboarding and first-run setup' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Legacy welcome text' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Original issue title' })).toBeInTheDocument();

    // After refreshing the detail page, the new values still exist.
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding and first-run setup' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Updated onboarding description for new contributors.')
    ).toBeInTheDocument();
    // Both separate saves appended one edit record each to the timeline.
    expect(screen.getAllByText(/alice-dev edited this issue/)).toHaveLength(2);
    first.unmount();
  });

  it('Scenario 2: clearing the title to blank rejects the save, shows “Title is required”, and the original title survives reload', async () => {
    const user = userEvent.setup();
    const routes = editRoutes();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const first = render(<App />);
    await screen.findByRole('heading', { name: 'Improve onboarding' });

    await user.click(screen.getByRole('button', { name: 'Edit issue title' }));
    const titleBox = screen.getByLabelText('Issue title');
    expect(titleBox).toHaveValue('Improve onboarding');
    await user.clear(titleBox);
    await user.type(titleBox, '   ');
    await user.click(screen.getByRole('button', { name: 'Save issue title' }));

    // The system rejects the save and keeps the original title heading.
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();

    // After reload the original title is still displayed.
    first.unmount();
    vi.unstubAllGlobals();
    mockFetch(routes);
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Title is required')).not.toBeInTheDocument();
  });

  it('the invalid-edit seed issue keeps `Original issue title` after a three-space replacement is rejected', async () => {
    const user = userEvent.setup();
    const routes = editRoutes();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/3');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Original issue title' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit issue title' }));
    const titleBox = screen.getByLabelText('Issue title');
    expect(titleBox).toHaveValue('Original issue title');
    await user.clear(titleBox);
    await user.type(titleBox, '   ');
    await user.click(screen.getByRole('button', { name: 'Save issue title' }));

    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Original issue title' })
    ).toBeInTheDocument();
  });

  it('Read and Triage (and visitors) only view: the edit controls are unavailable', async () => {
    const routes = editRoutes();
    routes['/api/repositories/acme-demo/acme-docs/issues/1'] = () => ({
      status: 200,
      body: { ok: true, issue: seededIssue, role: 'read' },
    });
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit issue title' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit issue description' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save issue/ })).not.toBeInTheDocument();
  });
});
