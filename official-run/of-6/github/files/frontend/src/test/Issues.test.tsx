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

function issuesRoutes() {
  return {
    '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    '/api/repositories/acme-demo/acme-docs/issues': () => ({
      status: 200,
      body: { ok: true, issues: seededIssues, labels: ['bug', 'documentation'] },
    }),
    '/api/repositories/acme-demo/acme-docs/issues/1': () => ({
      status: 200,
      body: { ok: true, issue: { ...seededIssues[0], closedAt: null } },
    }),
    '/api/repositories/acme-demo/acme-docs/issues/2': () => ({
      status: 200,
      body: { ok: true, issue: { ...seededIssues[1], closedAt: '2026-01-21T00:00:00.000Z' } },
    }),
    '/api/repositories/alice-dev/secret-research/issues': () => ({
      status: 403,
      body: { error: 'Access denied' },
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

describe('REQ-5-1-1 List and Filter Repository Issues', () => {
  beforeEach(() => {
    mockFetch(issuesRoutes());
  });

  it('the Issues page lists both seed issues with number, title link, labels, author, status and update time', async () => {
    navigate('#/repositories/acme-demo/acme-docs/issues');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Issues' })).toBeInTheDocument();

    // “Open” and “Closed” are links, not buttons or tabs.
    const openLink = screen.getByRole('link', { name: 'Open' });
    const closedLink = screen.getByRole('link', { name: 'Closed' });
    expect(openLink).toHaveAttribute('href', '#/repositories/acme-demo/acme-docs/issues?state=open');
    expect(closedLink).toHaveAttribute('href', '#/repositories/acme-demo/acme-docs/issues?state=closed');
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();

    // Each result title is a link whose exact accessible name is the title.
    const improveLink = await screen.findByRole('link', { name: 'Improve onboarding' });
    expect(improveLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/issues/1'
    );
    const legacyLink = screen.getByRole('link', { name: 'Legacy welcome text' });
    expect(legacyLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/issues/2'
    );

    // Each row displays number, title, label, author, and status.
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const firstRow = within(rows[0]);
    expect(firstRow.getByText('#1')).toBeInTheDocument();
    expect(firstRow.getByText('Open')).toBeInTheDocument();
    expect(firstRow.getByText('alice-dev')).toBeInTheDocument();
    expect(firstRow.getByText('bug')).toBeInTheDocument();
    expect(firstRow.getByText('documentation')).toBeInTheDocument();
    expect(firstRow.getByText(/Updated/)).toBeInTheDocument();

    const secondRow = within(rows[1]);
    expect(secondRow.getByText('#2')).toBeInTheDocument();
    expect(secondRow.getByText('Closed')).toBeInTheDocument();
    expect(secondRow.getByText('bug')).toBeInTheDocument();
    expect(secondRow.getByText(/Updated/)).toBeInTheDocument();

    // The searchbox is unique and named “Search issues”.
    expect(screen.getAllByRole('searchbox', { name: 'Search issues' })).toHaveLength(1);
    // The label filter options are the repository's pre-existing labels.
    expect(screen.getByRole('option', { name: 'bug' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'documentation' })).toBeInTheDocument();
  });

  it('the searchbox filters as the user types without Enter and a refresh retains the context', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/issues');
    render(<App />);
    await screen.findByRole('link', { name: 'Improve onboarding' });

    const searchbox = screen.getByRole('searchbox', { name: 'Search issues' });
    // “Improve” occurs only in the open issue title, so typing it must hide
    // the closed issue immediately (no Enter / search button).
    await user.type(searchbox, 'Improve');

    expect(screen.getByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Legacy welcome text' })).not.toBeInTheDocument();
    expect(window.location.hash).toContain('q=Improve');

    // Reload keeps the chosen filter context and matching results.
    vi.unstubAllGlobals();
    mockFetch(issuesRoutes());
    render(<App />);
    expect(screen.getByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Legacy welcome text' })).not.toBeInTheDocument();
  });

  it('the label filter restricts rows to the selected label', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/issues');
    render(<App />);
    await screen.findByRole('link', { name: 'Improve onboarding' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Label' }), 'documentation');

    expect(screen.getByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Legacy welcome text' })).not.toBeInTheDocument();
    expect(window.location.hash).toContain('label=documentation');
  });

  it('Scenario 1: Open + unique word + bug shows only the open issue; switching to Closed shows the matching closed issue', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/issues');
    render(<App />);
    await screen.findByRole('link', { name: 'Improve onboarding' });

    await user.click(screen.getByRole('link', { name: 'Open' }));
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('aria-current', 'page');

    await user.type(screen.getByRole('searchbox', { name: 'Search issues' }), 'onboarding');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Label' }), 'bug');

    // The list displays only the matching Open issue.
    expect(screen.getByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Legacy welcome text' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    // After switching to Closed the Open issue is not shown and the matching
    // Closed issue is shown; filtering only changes list display.
    await user.click(screen.getByRole('link', { name: 'Closed' }));
    expect(screen.queryByRole('link', { name: 'Improve onboarding' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Legacy welcome text' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('Scenario 2: Closed plus the closed issue title shows only the closed issue and stays after reload', async () => {
    navigate('#/repositories/acme-demo/acme-docs/issues?state=closed&q=Legacy%20welcome%20text');
    render(<App />);

    expect(await screen.findByRole('link', { name: 'Legacy welcome text' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Improve onboarding' })).not.toBeInTheDocument();

    // Reload keeps issue data unchanged and the closed issue still matches.
    vi.unstubAllGlobals();
    mockFetch(issuesRoutes());
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Legacy welcome text' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Improve onboarding' })).not.toBeInTheDocument();
  });

  it('clicking a title opens that issue detail page with the same persisted record', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/issues');
    render(<App />);
    await screen.findByRole('link', { name: 'Improve onboarding' });

    await user.click(screen.getByRole('link', { name: 'Improve onboarding' }));

    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText(/alice-dev opened this issue/)).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('documentation')).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/issues/1');
  });

  it('a visitor without permission sees Access denied for private repository issues', async () => {
    navigate('#/repositories/alice-dev/secret-research/issues');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '#/signin');
  });
});

describe('REQ-5-1-1 reuses the REQ-3-3 repository context (Issues entry)', () => {
  beforeEach(() => {
    mockFetch({
      ...issuesRoutes(),
      '/api/repositories/acme-demo/acme-docs': () => ({
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
            role: 'read',
          },
        },
      }),
      '/api/repositories/acme-demo/acme-docs/contents': () => ({
        status: 200,
        body: {
          ok: true,
          branch: { name: 'main', headCommitId: 'c1' },
          files: [{ path: 'README.md', content: '# acme-docs\n' }],
          entries: [{ name: 'README.md', type: 'file', path: 'README.md' }],
        },
      }),
      '/api/repositories/acme-demo/acme-docs/commits': () => ({
        status: 200,
        body: {
          ok: true,
          commits: [
            {
              id: 'c1',
              message: 'Initial commit',
              author: 'alice-dev',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      }),
    });
  });

  it('opening the Issues navigation link from the overview lands on the Issues list page', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);
    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });

    await user.click(screen.getByRole('link', { name: 'Issues' }));

    expect(await screen.findByRole('heading', { name: 'Issues' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/issues');
  });
});

describe('REQ-5-1-2 View an Issue and Its Discussion', () => {
  beforeEach(() => {
    mockFetch(issuesRoutes());
  });

  it('Scenario 1: a fresh visitor reads the seeded open issue detail, its discussion, and the chronological activity timeline', async () => {
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const first = render(<App />);

    // Top: the repository-scoped issue number, a heading whose exact
    // accessible name is the complete title, and the visible Open status.
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();

    // Body: the complete saved description as readable text.
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();

    // Right side: Assignees, Labels, Milestone metadata in that order.
    const sidebar = screen.getByRole('complementary');
    const assigneesHeading = within(sidebar).getByRole('heading', { name: 'Assignees' });
    const labelsHeading = within(sidebar).getByRole('heading', { name: 'Labels' });
    const milestoneHeading = within(sidebar).getByRole('heading', { name: 'Milestone' });
    expect(assigneesHeading.compareDocumentPosition(labelsHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(labelsHeading.compareDocumentPosition(milestoneHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(within(sidebar).getByText('alice-dev')).toBeInTheDocument(); // assignee
    expect(within(sidebar).getByText('bug')).toBeInTheDocument();
    expect(within(sidebar).getByText('documentation')).toBeInTheDocument();
    expect(within(sidebar).getByText('Q3 launch')).toBeInTheDocument();

    // Bottom: sections/records containing “Activity”/“Comment” text over
    // time — creation and comment activities in chronological order.
    expect(
      screen.getByRole('heading', { name: 'Activity' })
    ).toBeInTheDocument();
    const activityEvents = screen
      .getAllByRole('listitem')
      .filter((item) =>
        within(item).queryByText(/created this issue|commented/)
      );
    expect(activityEvents).toHaveLength(2);
    expect(within(activityEvents[0]).getByText(/created this issue/)).toBeInTheDocument();
    expect(within(activityEvents[1]).getByText(/commented/)).toBeInTheDocument();
    // The comment record shows the comment author and the comment body.
    expect(
      within(activityEvents[1]).getByText(
        'Good idea — I will prepare the improved onboarding checklist.'
      )
    ).toBeInTheDocument();

    // After refreshing (unmount + a fresh render of the same URL), the same
    // title, status, metadata, and saved comments are still displayed.
    first.unmount();
    vi.unstubAllGlobals();
    mockFetch(issuesRoutes());
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(
      screen.getByText('Good idea — I will prepare the improved onboarding checklist.')
    ).toBeInTheDocument();
  });

  it('Scenario 2/3: alice-dev signs in and follows the visible view workflow; the saved data persists after re-opening', async () => {
    const user = userEvent.setup();
    mockFetch({
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
      '/api/repositories/acme-demo/acme-docs/issues': () => ({
        status: 200,
        body: { ok: true, issues: seededIssues, labels: ['bug', 'documentation'] },
      }),
      '/api/repositories/acme-demo/acme-docs/issues/1': () => ({
        status: 200,
        body: {
          ok: true,
          issue: { ...seededIssues[0], closedAt: null },
        },
      }),
    });

    // Start at the application home page in a fresh session, sign in via
    // the home-page “Sign in” link with the “Username or email” / “Password”
    // fields and the “Sign in” button.
    navigate('#/');
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Sign in' }));
    await user.type(screen.getByLabelText('Username or email'), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Signed in as/)).toBeInTheDocument();

    // Follow the visible controls for the view workflow: open the seeded
    // issue detail of the accessible repository.
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('complementary')).getByText('alice-dev')
    ).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
    expect(
      screen.getByText('Good idea — I will prepare the improved onboarding checklist.')
    ).toBeInTheDocument();

    // Reopen the same number from the list: the visible destination shows
    // the same persisted record.
    navigate('#/repositories/acme-demo/acme-docs/issues');
    await user.click(await screen.findByRole('link', { name: 'Improve onboarding' }));
    expect(
      await screen.findByRole('heading', { name: 'Improve onboarding' })
    ).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
  });
});
