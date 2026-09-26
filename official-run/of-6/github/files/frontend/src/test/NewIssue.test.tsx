import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const seededIssues = [
  {
    number: 1,
    title: 'Improve onboarding',
    state: 'open',
    author: 'alice-dev',
    body: 'Describe the onboarding improvement.',
    labels: ['bug', 'documentation'],
    milestone: { title: 'Q3 launch' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-18T00:00:00.000Z',
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
      {
        type: 'created',
        actor: 'alice-dev',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        type: 'commented',
        actor: 'alice-dev',
        createdAt: '2026-01-18T00:00:00.000Z',
        body: 'Good idea — I will prepare the improved onboarding checklist.',
      },
    ],
  },
  {
    number: 2,
    title: 'Legacy welcome text',
    state: 'closed',
    author: 'alice-dev',
    body: 'The README still shows the legacy welcome text from the initial onboarding template.',
    labels: ['bug'],
    milestone: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-21T00:00:00.000Z',
    assignees: [],
    comments: [],
    activity: [],
  },
];

function overviewRoute(role: string) {
  return () => ({
    status: 200,
    body: {
      ok: true,
      repository: {
        owner: 'acme-demo',
        ownerType: 'organization',
        name: 'acme-docs',
        description: 'Documentation for the Acme platform',
        visibility: 'public',
        defaultBranch: 'main',
        updatedAt: '2026-01-10T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        role,
      },
    },
  });
}

function signedInRoutes(role: string, issueRows: unknown[] = seededIssues) {
  return {
    '/api/auth/session': () => ({
      status: 200,
      body: { authenticated: false },
    }),
    '/api/auth/signin': () => ({
      status: 200,
      body: { ok: true, username: 'alice-dev', email: 'alice-dev@example.test' },
    }),
    '/api/repositories?owner=alice-dev': () => ({
      status: 200,
      body: { ok: true, repositories: [] },
    }),
    '/api/repositories/acme-demo/acme-docs': overviewRoute(role),
    '/api/repositories/acme-demo/acme-docs/issues': () => ({
      status: 200,
      body: { ok: true, issues: issueRows, labels: ['bug', 'documentation'], role },
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

async function signInAsAlice(user: ReturnType<typeof userEvent.setup>) {
  navigate('#/');
  const first = render(<App />);
  await user.click(await screen.findByRole('link', { name: 'Sign in' }));
  await user.type(screen.getByLabelText('Username or email'), 'alice-dev');
  await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText(/Signed in as/)).toBeInTheDocument();
  return first;
}

describe('REQ-5-2-1 Create a Repository Issue', () => {
  it('Scenario 1: alice-dev opens the Issues page, clicks “New issue”, submits, and the new issue opens by its number with a creation activity', async () => {
    const user = userEvent.setup();
    // Stateful list: the POST handler appends the created issue so the list
    // can be located by the new number afterwards.
    const issueRows: Array<Record<string, unknown>> = [...seededIssues];
    mockFetch({
      ...signedInRoutes('admin', issueRows),
      'POST /api/repositories/acme-demo/acme-docs/issues': (init) => {
        const body = JSON.parse(String(init?.body)) as { title: string; body: string };
        const now = '2026-02-01T00:00:00.000Z';
        const created = {
          number: 3,
          title: body.title.trim(),
          state: 'open',
          author: 'alice-dev',
          body: body.body.trim(),
          labels: [],
          milestone: null,
          createdAt: now,
          updatedAt: now,
          closedAt: null,
          assignees: [],
          comments: [],
          activity: [{ type: 'created', actor: 'alice-dev', createdAt: now }],
        };
        issueRows.push(created);
        return { status: 201, body: { ok: true, issue: created } };
      },
      '/api/repositories/acme-demo/acme-docs/issues/3': () => ({
        status: 200,
        body: { ok: true, issue: issueRows.find((i) => i.number === 3) },
      }),
    });

    await signInAsAlice(user);

    // A signed-in user with issue-write permission opens the Issues page.
    navigate('#/repositories/acme-demo/acme-docs/issues');
    await screen.findByRole('link', { name: 'Improve onboarding' });

    // “New issue” is a link on the Issues page.
    const newIssueLink = screen.getByRole('link', { name: 'New issue' });
    expect(newIssueLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/issues/new'
    );
    await user.click(newIssueLink);

    // The creation form has fields labeled “Title” and “Description” and a
    // “Submit new issue” button.
    expect(await screen.findByRole('heading', { name: 'New issue' })).toBeInTheDocument();
    const titleField = screen.getByLabelText('Title');
    const descriptionField = screen.getByLabelText('Description');
    expect(titleField).toBeInTheDocument();
    expect(descriptionField).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit new issue' })).toBeInTheDocument();

    await user.type(titleField, '  Add rate limit documentation  ');
    await user.type(descriptionField, 'Describe the rate limits for API clients.');
    await user.click(screen.getByRole('button', { name: 'Submit new issue' }));

    // Success redirects to the new issue detail page: heading exactly the
    // entered (trimmed) title, Open status, exact saved description, the
    // current user as author, and a creation activity record.
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/issues/3'
    );
    expect(
      await screen.findByRole('heading', { name: 'Add rate limit documentation' })
    ).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(
      screen.getByText('Describe the rate limits for API clients.')
    ).toBeInTheDocument();
    expect(screen.getByText(/alice-dev opened this issue/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText(/alice-dev created this issue/)).toBeInTheDocument();

    // Reopening the Issues page entry shows a title link with the same exact
    // name and the item can be found by its new number.
    navigate('#/repositories/acme-demo/acme-docs/issues');
    expect(
      await screen.findByRole('link', { name: 'Add rate limit documentation' })
    ).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[2]).getByText('#3')).toBeInTheDocument();
  });

  it('Scenario 1 failure: a title of only three spaces displays “Title is required” and creates no issue or number', async () => {
    const user = userEvent.setup();
    const issueRows: Array<Record<string, unknown>> = [...seededIssues];
    let postCalls = 0;
    mockFetch({
      ...signedInRoutes('admin', issueRows),
      'POST /api/repositories/acme-demo/acme-docs/issues': () => {
        postCalls += 1;
        return { status: 400, body: { ok: false, errors: { title: 'Title is required' } } };
      },
    });

    await signInAsAlice(user);
    navigate('#/repositories/acme-demo/acme-docs/issues/new');
    await screen.findByRole('heading', { name: 'New issue' });

    await user.type(screen.getByLabelText('Title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Submit new issue' }));

    // The exact visible message is displayed and the page stays on the form.
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/issues/new');
    expect(screen.getByRole('heading', { name: 'New issue' })).toBeInTheDocument();
    expect(postCalls).toBe(1);

    // No issue was created and no number was allocated.
    const list = screen.queryByRole('link', { name: 'Improve onboarding' });
    expect(list).not.toBeInTheDocument();
    expect(issueRows).toHaveLength(2);
  });

  it('Scenario 2: the successful result remains persisted after refreshing; a rejected action leaves the original state unchanged', async () => {
    const user = userEvent.setup();
    const issueRows: Array<Record<string, unknown>> = [...seededIssues];
    mockFetch({
      ...signedInRoutes('admin', issueRows),
      'POST /api/repositories/acme-demo/acme-docs/issues': (init) => {
        const body = JSON.parse(String(init?.body)) as { title: string; body: string };
        if (body.title.trim() === '') {
          return { status: 400, body: { ok: false, errors: { title: 'Title is required' } } };
        }
        const now = '2026-02-01T00:00:00.000Z';
        const created = {
          number: 3,
          title: body.title.trim(),
          state: 'open',
          author: 'alice-dev',
          body: body.body.trim(),
          labels: [],
          milestone: null,
          createdAt: now,
          updatedAt: now,
          closedAt: null,
          assignees: [],
          comments: [],
          activity: [{ type: 'created', actor: 'alice-dev', createdAt: now }],
        };
        issueRows.push(created);
        return { status: 201, body: { ok: true, issue: created } };
      },
      '/api/repositories/acme-demo/acme-docs/issues/3': () => ({
        status: 200,
        body: { ok: true, issue: issueRows.find((i) => i.number === 3) },
      }),
    });

    const first = await signInAsAlice(user);

    // Rejected action: blank title leaves the original state unchanged.
    navigate('#/repositories/acme-demo/acme-docs/issues/new');
    await screen.findByRole('heading', { name: 'New issue' });
    await user.type(screen.getByLabelText('Title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Submit new issue' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(issueRows).toHaveLength(2);

    // Successful action: create with a valid title.
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Persisted issue');
    await user.click(screen.getByRole('button', { name: 'Submit new issue' }));
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/issues/3'
    );
    expect(
      await screen.findByRole('heading', { name: 'Persisted issue' })
    ).toBeInTheDocument();

    // Refreshing (a fresh render of the same URL) still reads the same record.
    first.unmount();
    vi.unstubAllGlobals();
    mockFetch({
      ...signedInRoutes('admin', issueRows),
      '/api/repositories/acme-demo/acme-docs/issues/3': () => ({
        status: 200,
        body: { ok: true, issue: issueRows.find((i) => i.number === 3) },
      }),
    });
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Persisted issue' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText(/alice-dev created this issue/)).toBeInTheDocument();

    // Reopening the list shows the new title link.
    navigate('#/repositories/acme-demo/acme-docs/issues');
    expect(
      await screen.findByRole('link', { name: 'Persisted issue' })
    ).toBeInTheDocument();
  });

  it('a visitor without write permission sees no “New issue” link and direct access to the form is denied', async () => {
    // Anonymous visitor: the Issues list reports the read role.
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs/issues': () => ({
        status: 200,
        body: { ok: true, issues: seededIssues, labels: ['bug', 'documentation'], role: 'read' },
      }),
      '/api/repositories/acme-demo/acme-docs': overviewRoute('read'),
    });

    navigate('#/repositories/acme-demo/acme-docs/issues');
    render(<App />);
    await screen.findByRole('link', { name: 'Improve onboarding' });
    expect(screen.queryByRole('link', { name: 'New issue' })).not.toBeInTheDocument();

    // Directly opening the creation form shows Access denied (Read role).
    navigate('#/repositories/acme-demo/acme-docs/issues/new');
    expect(
      await screen.findByRole('heading', { name: 'Access denied' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Submit new issue' })
    ).not.toBeInTheDocument();
  });
});
