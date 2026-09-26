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

const branches = [
  { name: 'main', headCommitId: 'main-head' },
  { name: 'feature-search', headCommitId: 'feature-head' },
  { name: 'release', headCommitId: 'main-head' },
];

/** The seed diff of main vs feature-search: the comparable commit is the
 * feature-search commit and the changed files include the seeded changed
 * file path `src/search.ts` verbatim. */
const comparePayload = {
  ok: true,
  role: 'admin',
  base: { name: 'main', headCommitId: 'main-head' },
  compare: { name: 'feature-search', headCommitId: 'feature-head' },
  commitCount: 1,
  commits: [
    {
      id: 'feature-head',
      shortId: 'feature-h',
      message: 'Add main-only.md',
      author: 'alice-dev',
      createdAt: '2026-01-19T00:00:00.000Z',
    },
  ],
  files: [
    {
      path: 'README.md',
      content: '# acme-docs\n',
      additions: 1,
      deletions: 1,
      lines: [
        { type: 'del', text: '## Search flow' },
        { type: 'add', text: '# main-only' },
      ],
    },
    {
      path: 'main-only.md',
      content: '# main-only\n',
      additions: 2,
      deletions: 0,
      lines: [{ type: 'add', text: '# main-only' }],
    },
    {
      path: 'src/search.ts',
      content: null,
      additions: 0,
      deletions: 4,
      lines: [{ type: 'del', text: '// Search flow' }],
    },
  ],
  additions: 3,
  deletions: 5,
};

const compareOnlyRoutes = {
  '/api/auth/session': () => ({
    status: 200,
    body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
  }),
  '/api/repositories/acme-demo/acme-docs/branches': () => ({
    status: 200,
    body: { ok: true, defaultBranch: 'main', canCreate: true, branches },
  }),
  '/api/repositories/acme-demo/acme-docs/pulls/compare': () => ({
    status: 200,
    body: comparePayload,
  }),
};

const signInAliceRoutes = {
  ...compareOnlyRoutes,
  '/api/repositories/acme-demo/acme-docs/pulls': () => ({
    status: 200,
    body: { ok: true, pulls: seededPulls, role: 'admin' },
  }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-6-2-2 PR comparison page', () => {
  it('scenario 1: New pull request opens the comparison page; selecting main as base and feature-search as compare and clicking Compare changes shows the diff and enables Create pull request', async () => {
    const user = userEvent.setup();
    mockFetch(signInAliceRoutes);
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    render(<App />);

    // The signed-in Admin sees the “New pull request” link on the Pull
    // requests page.
    expect(await screen.findByRole('heading', { name: 'Pull requests' })).toBeInTheDocument();
    const newPullLink = await screen.findByRole('link', { name: 'New pull request' });
    expect(newPullLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/pulls/new'
    );

    // Clicking it opens the comparison page with native base/compare selects
    // whose options are the exact branch names.
    await user.click(newPullLink);
    expect(
      await screen.findByRole('heading', { name: 'Comparing changes' })
    ).toBeInTheDocument();
    const baseSelect = await screen.findByRole('combobox', { name: 'base' });
    const compareSelect = screen.getByRole('combobox', { name: 'compare' });
    expect(within(baseSelect).getByRole('option', { name: 'main' })).toBeInTheDocument();
    expect(within(compareSelect).getByRole('option', { name: 'feature-search' })).toBeInTheDocument();

    // The user selects main as base and feature-search as compare and clicks
    // Compare changes.
    await user.selectOptions(baseSelect, 'main');
    await user.selectOptions(compareSelect, 'feature-search');
    await user.click(screen.getByRole('button', { name: 'Compare changes' }));

    // The page displays the branch names, a Commit summary with the
    // comparable commit count, the changed files (the seeded changed-file
    // path src/search.ts appears verbatim), and the diff summary, and the
    // Create pull request entry is enabled.
    expect(await screen.findByText('1 commit')).toBeInTheDocument();
    expect(screen.getByText('Add main-only.md')).toBeInTheDocument();
    expect(screen.getAllByText('src/search.ts').length).toBeGreaterThan(0);
    expect(
      screen.getByText('3 files changed, 3 additions and 5 deletions')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create pull request' })
    ).not.toBeDisabled();
  });

  it('scenario 1 continuation: changing compare to the same branch immediately shows No changes and disables the creation entry without clicking Compare changes', async () => {
    const user = userEvent.setup();
    mockFetch(signInAliceRoutes);
    navigate('#/repositories/acme-demo/acme-docs/pulls/new');
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Comparing changes' })
    ).toBeInTheDocument();
    const baseSelect = await screen.findByRole('combobox', { name: 'base' });
    const compareSelect = screen.getByRole('combobox', { name: 'compare' });

    // Establish a valid comparison first (defaults: base=main,
    // compare=feature-search).
    await user.selectOptions(baseSelect, 'main');
    await user.selectOptions(compareSelect, 'feature-search');
    await user.click(screen.getByRole('button', { name: 'Compare changes' }));
    expect(await screen.findByText('1 commit')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create pull request' })
    ).not.toBeDisabled();

    // Changing compare to main (the same branch as base) immediately
    // displays No changes and disables the creation entry — no Compare
    // changes click is needed; the read-only comparison created no PR and
    // modified no branches (nothing persisted).
    await user.selectOptions(compareSelect, 'main');
    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(screen.getByText(/are the same or have no differences/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create pull request' })
    ).toBeDisabled();
    expect(screen.queryByText('1 commit')).not.toBeInTheDocument();
  });

  it('scenario 2: selecting the same branch in both fields and clicking Compare changes keeps No changes and the disabled creation entry', async () => {
    const user = userEvent.setup();
    mockFetch(signInAliceRoutes);
    navigate('#/repositories/acme-demo/acme-docs/pulls/new');
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Comparing changes' })
    ).toBeInTheDocument();
    const baseSelect = await screen.findByRole('combobox', { name: 'base' });
    const compareSelect = screen.getByRole('combobox', { name: 'compare' });

    await user.selectOptions(baseSelect, 'feature-search');
    await user.selectOptions(compareSelect, 'feature-search');
    // The same-branch state is immediate, before any Compare changes click.
    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create pull request' })
    ).toBeDisabled();

    // Clicking Compare changes retains that result.
    await user.click(screen.getByRole('button', { name: 'Compare changes' }));
    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create pull request' })
    ).toBeDisabled();
  });

  it('a direct comparison-page entry with the branches already selected opens the same usable creation flow', async () => {
    const user = userEvent.setup();
    mockFetch(signInAliceRoutes);
    navigate(
      '#/repositories/acme-demo/acme-docs/pulls/new?base=main&compare=feature-search'
    );
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Comparing changes' })
    ).toBeInTheDocument();
    // Both branches are already selected in the selects…
    expect(await screen.findByRole('combobox', { name: 'base' })).toHaveValue('main');
    expect(screen.getByRole('combobox', { name: 'compare' })).toHaveValue('feature-search');
    // …and the comparison ran automatically: the commit summary, the changed
    // files (including src/search.ts), and the diff summary are visible with
    // an enabled Create pull request entry.
    expect(await screen.findByText('1 commit')).toBeInTheDocument();
    expect(screen.getAllByText('src/search.ts').length).toBeGreaterThan(0);
    expect(
      screen.getByText('3 files changed, 3 additions and 5 deletions')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create pull request' })
    ).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Compare changes' }));
    expect(screen.getByText('1 commit')).toBeInTheDocument();
  });

  it('a Read user may view existing PRs but cannot enter the creation-comparison flow', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs/branches': () => ({
        status: 200,
        body: { ok: true, defaultBranch: 'main', canCreate: false, branches },
      }),
      '/api/repositories/acme-demo/acme-docs/pulls': () => ({
        status: 200,
        body: { ok: true, pulls: seededPulls, role: 'read' },
      }),
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Pull requests' })).toBeInTheDocument();
    // Read/Triage/visitors see the list but no “New pull request” link.
    expect(screen.queryByRole('link', { name: 'New pull request' })).not.toBeInTheDocument();

    // Directly opening the comparison page shows Access denied with no
    // base/compare selects and no creation entry.
    navigate('#/repositories/acme-demo/acme-docs/pulls/new');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'base' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create pull request' })
    ).not.toBeInTheDocument();
  });

  it('an unauthenticated visitor opening the comparison page is denied and offered Sign in', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: false },
      }),
      '/api/repositories/acme-demo/acme-docs/branches': () => ({
        status: 200,
        body: { ok: true, defaultBranch: 'main', canCreate: false, branches },
      }),
    });
    navigate('#/repositories/acme-demo/acme-docs/pulls/new?base=main&compare=feature-search');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('REQ-6-2-3 PR creation from comparison results', () => {
  const createdPull = (overrides: Record<string, unknown> = {}) => ({
    ...seededPulls[0],
    title: 'Land the search flow',
    description: 'Adds the search flow commit to main.',
    number: 3,
    baseCommitId: 'main-head',
    compareCommitId: 'feature-head',
    currentCompareCommitId: 'feature-head',
    activity: [
      {
        type: 'created',
        actor: 'alice-dev',
        createdAt: '2026-01-22T00:00:00.000Z',
      },
    ],
    commits: [
      {
        id: 'feature-head',
        shortId: 'feature-h',
        message: 'Add main-only.md',
        author: 'alice-dev',
        createdAt: '2026-01-19T00:00:00.000Z',
      },
    ],
    filesChanged: comparePayload.files,
    additions: comparePayload.additions,
    deletions: comparePayload.deletions,
    checks: {
      test: { status: 'pending', setter: null, updatedAt: null },
    },
    mergeable: false,
    blockedReasons: ['Review required by branch protection'],
    ...overrides,
  });

  const createRoutes = (createHandler: (init?: RequestInit) => { status: number; body: unknown }) => ({
    '/api/auth/session': () => ({
      status: 200,
      body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
    }),
    '/api/repositories/acme-demo/acme-docs/branches': () => ({
      status: 200,
      body: { ok: true, defaultBranch: 'main', canCreate: true, branches },
    }),
    '/api/repositories/acme-demo/acme-docs/pulls/compare': () => ({
      status: 200,
      body: comparePayload,
    }),
    'POST /api/repositories/acme-demo/acme-docs/pulls': createHandler,
    '/api/repositories/acme-demo/acme-docs/pulls/3': () => ({
      status: 200,
      body: { ok: true, pull: createdPull(), role: 'admin' },
    }),
  });

  it('scenario 1: clicking Create pull request opens the Title/Description form and submitting redirects to the new PR detail page', async () => {
    const user = userEvent.setup();
    const postSpy = vi.fn((_init?: RequestInit) => ({
      status: 201,
      body: { ok: true, pull: createdPull(), role: 'admin' },
    }));
    mockFetch(createRoutes(postSpy));
    navigate(
      '#/repositories/acme-demo/acme-docs/pulls/new?base=main&compare=feature-search'
    );
    render(<App />);

    // The valid comparison result is shown with an enabled creation entry.
    expect(
      await screen.findByRole('heading', { name: 'Comparing changes' })
    ).toBeInTheDocument();
    expect(await screen.findByText('1 commit')).toBeInTheDocument();
    const openButton = screen.getByRole('button', { name: 'Create pull request' });
    expect(openButton).not.toBeDisabled();

    // Clicking it opens the form: a Title field, an optional Description
    // field, and a single Create pull request submit button. The
    // comparison-page action is no longer a competing active button (only
    // the form's submit button remains under that name).
    await user.click(openButton);
    expect(await screen.findByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Create pull request' })).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'base' })).toHaveValue('main');
    expect(screen.getByRole('combobox', { name: 'compare' })).toHaveValue('feature-search');

    // The user enters a 1–256 character title and an optional description.
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Land the search flow');
    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Adds the search flow commit to main.'
    );
    await user.click(screen.getByRole('button', { name: 'Create pull request' }));

    // The submitted payload confirms base = main and compare = feature-search.
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(postSpy.mock.calls[0][0]?.body))).toEqual({
      title: 'Land the search flow',
      description: 'Adds the search flow commit to main.',
      base: 'main',
      compare: 'feature-search',
    });

    // The system redirects to the new PR detail page: the entered title is
    // the exact heading, the status is Open, and the author is the user.
    expect(
      await screen.findByRole('heading', { name: 'Land the search flow' })
    ).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('feature-search → main')).toBeInTheDocument();
    // The current user is the author (scoped to the detail header, since the
    // account menu also shows the username).
    const detailHeader = screen.getByRole('heading', { name: 'Land the search flow' }).parentElement;
    expect(detailHeader).not.toBeNull();
    expect(within(detailHeader as HTMLElement).getByText('alice-dev')).toBeInTheDocument();
    expect(
      screen.getByText('Adds the search flow commit to main.')
    ).toBeInTheDocument();
  });

  it('scenario 1 rejection: a title containing only spaces shows Title is required and creates no PR', async () => {
    const user = userEvent.setup();
    const postSpy = vi.fn(() => ({
      status: 400,
      body: { ok: false, errors: { title: 'Title is required' } },
    }));
    mockFetch(createRoutes(postSpy));
    navigate(
      '#/repositories/acme-demo/acme-docs/pulls/new?base=main&compare=feature-search'
    );
    render(<App />);

    expect(await screen.findByText('1 commit')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Create pull request' })
    );
    const titleBox = await screen.findByRole('textbox', { name: 'Title' });
    await user.type(titleBox, '   ');
    await user.click(screen.getByRole('button', { name: 'Create pull request' }));

    // The exact visible message appears next to the field, the form stays
    // open, and no navigation to a PR detail page happens (no PR created).
    expect(await screen.findByRole('alert', { name: '' })).toBeInTheDocument();
    expect(screen.getByText('Title is required')).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: 'base' })).toHaveValue('main');
    expect(screen.queryByRole('heading', { name: 'Comparing changes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Title is required' })).not.toBeInTheDocument();
  });

  it('a duplicate-pair / no-changes rejection shows the general error and keeps the form values', async () => {
    const user = userEvent.setup();
    const postSpy = vi.fn(() => ({
      status: 400,
      body: {
        ok: false,
        errors: { general: 'A pull request already exists for these branches' },
      },
    }));
    mockFetch(createRoutes(postSpy));
    navigate(
      '#/repositories/acme-demo/acme-docs/pulls/new?base=main&compare=feature-search'
    );
    render(<App />);

    expect(await screen.findByText('1 commit')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Create pull request' })
    );
    const titleBox = await screen.findByRole('textbox', { name: 'Title' });
    await user.type(titleBox, 'Second attempt');
    await user.click(screen.getByRole('button', { name: 'Create pull request' }));

    expect(
      await screen.findByText('A pull request already exists for these branches')
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Second attempt'
    );
    expect(screen.getByRole('combobox', { name: 'base' })).toHaveValue('main');
  });

  it('changing a branch selection closes the open creation form', async () => {
    const user = userEvent.setup();
    mockFetch(createRoutes(() => ({
      status: 201,
      body: { ok: true, pull: createdPull(), role: 'admin' },
    })));
    navigate(
      '#/repositories/acme-demo/acme-docs/pulls/new?base=main&compare=feature-search'
    );
    render(<App />);

    expect(await screen.findByText('1 commit')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Create pull request' })
    );
    expect(await screen.findByRole('textbox', { name: 'Title' })).toBeInTheDocument();

    // Selecting the same branch in both fields shows No changes and closes
    // the form (the creation entry returns to its disabled state).
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'compare' }),
      'main'
    );
    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Title' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create pull request' })
    ).toBeDisabled();
  });
});

describe('REQ-6-2-4 Draft creation from comparison results', () => {
  const draftPull = (overrides: Record<string, unknown> = {}) => ({
    ...seededPulls[0],
    title: 'Draft the search flow',
    description: 'Draft of the search flow changes.',
    number: 3,
    status: 'draft',
    baseCommitId: 'main-head',
    compareCommitId: 'feature-head',
    currentCompareCommitId: 'feature-head',
    activity: [
      {
        type: 'created',
        actor: 'alice-dev',
        createdAt: '2026-01-22T00:00:00.000Z',
      },
    ],
    commits: [
      {
        id: 'feature-head',
        shortId: 'feature-h',
        message: 'Add main-only.md',
        author: 'alice-dev',
        createdAt: '2026-01-19T00:00:00.000Z',
      },
    ],
    filesChanged: comparePayload.files,
    additions: comparePayload.additions,
    deletions: comparePayload.deletions,
    checks: {
      test: { status: 'pending', setter: null, updatedAt: null },
    },
    mergeable: false,
    blockedReasons: ['Pull request is not open.'],
    ...overrides,
  });

  const draftRoutes = (
    createHandler: (init?: RequestInit) => { status: number; body: unknown }
  ) => ({
    '/api/auth/session': () => ({
      status: 200,
      body: {
        authenticated: true,
        username: 'alice-dev',
        email: 'alice.dev@example.test',
      },
    }),
    '/api/repositories/acme-demo/acme-docs/branches': () => ({
      status: 200,
      body: { ok: true, defaultBranch: 'main', canCreate: true, branches },
    }),
    '/api/repositories/acme-demo/acme-docs/pulls/compare': () => ({
      status: 200,
      body: comparePayload,
    }),
    'POST /api/repositories/acme-demo/acme-docs/pulls': createHandler,
    '/api/repositories/acme-demo/acme-docs/pulls/3': () => ({
      status: 200,
      body: { ok: true, pull: draftPull(), role: 'admin' },
    }),
  });

  it('scenario 1: clicking Create draft pull request opens the Title/Description form and submitting creates a Draft PR', async () => {
    const user = userEvent.setup();
    const postSpy = vi.fn((_init?: RequestInit) => ({
      status: 201,
      body: { ok: true, pull: draftPull(), role: 'admin' },
    }));
    mockFetch(draftRoutes(postSpy));
    navigate(
      '#/repositories/acme-demo/acme-docs/pulls/new?base=main&compare=feature-search'
    );
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Comparing changes' })
    ).toBeInTheDocument();
    expect(await screen.findByText('1 commit')).toBeInTheDocument();

    // The visible draft comparison entry offers a Create draft pull request
    // button next to the normal creation entry, both enabled for the valid
    // comparison.
    const draftButton = screen.getByRole('button', {
      name: 'Create draft pull request',
    });
    expect(draftButton).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Create pull request' })
    ).not.toBeDisabled();

    // Clicking it opens the form containing Title, optional Description,
    // and one Create draft pull request submit button; the comparison-page
    // actions are hidden while the form is open.
    await user.click(draftButton);
    expect(
      await screen.findByRole('textbox', { name: 'Title' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Description' })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Create draft pull request' })
    ).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Create pull request' })
    ).not.toBeInTheDocument();

    // The user enters a valid title and an optional description and
    // confirms creation.
    await user.type(
      screen.getByRole('textbox', { name: 'Title' }),
      'Draft the search flow'
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Draft of the search flow changes.'
    );
    await user.click(
      screen.getByRole('button', { name: 'Create draft pull request' })
    );

    // The submitted payload confirms the branches and draft: true.
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(postSpy.mock.calls[0][0]?.body))).toEqual({
      title: 'Draft the search flow',
      description: 'Draft of the search flow changes.',
      base: 'main',
      compare: 'feature-search',
      draft: true,
    });

    // The detail page displays the Draft marker, source/target branches,
    // and a present but disabled Merge pull request entry.
    expect(
      await screen.findByRole('heading', { name: 'Draft the search flow' })
    ).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('feature-search → main')).toBeInTheDocument();
    const mergeButton = screen.getByRole('button', {
      name: 'Merge pull request',
    });
    expect(mergeButton).toBeInTheDocument();
    expect(mergeButton).toBeDisabled();
  });

  it('scenario 1 rejection: a rejected draft submission shows the reason and creates no record', async () => {
    const user = userEvent.setup();
    const postSpy = vi.fn((_init?: RequestInit) => ({
      status: 400,
      body: { ok: false, errors: { title: 'Title is required' } },
    }));
    mockFetch(draftRoutes(postSpy));
    navigate(
      '#/repositories/acme-demo/acme-docs/pulls/new?base=main&compare=feature-search'
    );
    render(<App />);

    expect(await screen.findByText('1 commit')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Create draft pull request' })
    );
    const titleBox = await screen.findByRole('textbox', { name: 'Title' });
    await user.type(titleBox, '   ');
    await user.click(
      screen.getByRole('button', { name: 'Create draft pull request' })
    );

    // The exact visible message appears next to the field, the draft form
    // stays open, and no navigation happens (no draft record created).
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(postSpy.mock.calls[0][0]?.body))).toEqual({
      title: '   ',
      description: '',
      base: 'main',
      compare: 'feature-search',
      draft: true,
    });
    expect(screen.getByRole('combobox', { name: 'base' })).toHaveValue('main');
    expect(
      screen.queryByRole('heading', { name: 'Comparing changes' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Title is required' })
    ).not.toBeInTheDocument();
  });
});
