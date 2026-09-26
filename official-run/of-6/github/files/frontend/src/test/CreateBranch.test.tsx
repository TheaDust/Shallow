import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const acmeDocsOverview = {
  owner: 'acme-demo',
  ownerType: 'organization',
  name: 'acme-docs',
  description: 'Documentation for the Acme platform',
  visibility: 'public',
  defaultBranch: 'main',
  updatedAt: '2026-01-10T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'admin',
};

const MAIN_README =
  '# acme-docs\n\nDocumentation for the Acme platform.\n\n## Search flow\n';

const rootContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c2' },
    files: [
      { path: 'README.md', content: MAIN_README },
      { path: 'src/search.ts', content: '// Search flow\n' },
    ],
    entries: [
      { name: 'src', type: 'directory', path: 'src' },
      { name: 'README.md', type: 'file', path: 'README.md' },
    ],
  },
});

const acmeDocsCommits = () => ({
  status: 200,
  body: {
    ok: true,
    commits: [
      { id: 'c2', message: 'Document search flow', author: 'alice-dev', createdAt: '2026-01-05T00:00:00.000Z' },
      { id: 'c1', message: 'Initial commit', author: 'alice-dev', createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  },
});

const treeFor = (branch: string, entries: unknown[]) => () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: branch, headCommitId: 'c2' },
    path: '',
    entries,
  },
});

const createdTreeEntries = [
  { name: 'src', type: 'directory', path: 'src' },
  { name: 'README.md', type: 'file', path: 'README.md' },
];

// A mutable branch list so the POST handler and the GET list stay consistent
// (the selector refetches the list after creation and on the new page).
const branchList = [
  { name: 'main', headCommitId: 'c2' },
  { name: 'feature-search', headCommitId: 'c3' },
];

function branchesPayload(canCreate: boolean) {
  return {
    status: 200,
    body: {
      ok: true,
      defaultBranch: 'main',
      canCreate,
      branches: branchList.map((b) => ({ ...b })),
    },
  };
}

interface CreateTestOptions {
  authenticated: boolean;
  canCreate: boolean;
  createResponse?: { status: number; body: unknown };
}

function mockCreateBranchRoutes(options: CreateTestOptions) {
  const createResponse = options.createResponse ?? {
    status: 201,
    body: { ok: true, branch: { name: 'feature/api-v2', headCommitId: 'c2' } },
  };
  return mockFetch({
    '/api/auth/session': () =>
      options.authenticated
        ? { status: 200, body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' } }
        : { status: 200, body: { authenticated: false } },
    '/api/repositories/acme-demo/acme-docs': () => ({
      status: 200,
      body: { ok: true, repository: acmeDocsOverview },
    }),
    '/api/repositories/acme-demo/acme-docs/contents': rootContents,
    '/api/repositories/acme-demo/acme-docs/commits': acmeDocsCommits,
    '/api/repositories/acme-demo/acme-docs/branches': () =>
      branchesPayload(options.canCreate),
    'POST /api/repositories/acme-demo/acme-docs/branches': (init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.name && body.name !== 'main' && !branchList.some((b) => b.name === body.name)) {
        branchList.push({ name: body.name, headCommitId: 'c2' });
      }
      return createResponse;
    },
    '/api/repositories/acme-demo/acme-docs/tree/feature%2Fapi-v2': treeFor(
      'feature/api-v2',
      createdTreeEntries
    ),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
  branchList.length = 0;
  branchList.push(
    { name: 'main', headCommitId: 'c2' },
    { name: 'feature-search', headCommitId: 'c3' }
  );
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-4-3-2 Create a Branch from an Existing Revision (write user)', () => {
  it('scenario 1: typing a valid unused name shows the create option and selecting it creates the branch and switches to it', async () => {
    const fetchSpy = mockCreateBranchRoutes({ authenticated: true, canCreate: true });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    await user.click(screen.getByRole('button', { name: 'Branch main' }));
    const input = await screen.findByRole('textbox', { name: 'Find branch' });

    // A valid unused name displays the create entry immediately (no Enter or
    // separate search action) with role option and the exact accessible name;
    // its displayed base is the current branch.
    await user.type(input, 'feature/api-v2');
    const createOption = screen.getByRole('option', {
      name: 'Create branch: feature/api-v2',
    });
    expect(screen.queryByText('Invalid branch')).not.toBeInTheDocument();
    expect(screen.queryByText('No matching branch')).not.toBeInTheDocument();
    expect(createOption.textContent).toContain("from 'main'");

    await user.click(createOption);

    // The creation request carries the typed name and the current branch as
    // the base, and the browsing context switches to the new branch.
    const createCalls = fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input).includes('/branches') && init?.method === 'POST'
    );
    expect(createCalls.length).toBe(1);
    const sent = JSON.parse(String(createCalls[0][1]?.body));
    expect(sent).toEqual({ name: 'feature/api-v2', base: 'main' });

    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/repositories/acme-demo/acme-docs/tree/feature%2Fapi-v2'
      )
    );
    expect(
      await screen.findByRole('button', { name: 'Branch feature/api-v2' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();

    // The new branch now appears in the selector list (persisted server-side)
    // and is the marked current branch.
    await user.click(screen.getByRole('button', { name: 'Branch feature/api-v2' }));
    const newBranchOption = await screen.findByRole('option', {
      name: 'feature/api-v2',
    });
    expect(newBranchOption).toHaveAttribute('aria-selected', 'true');
  });

  it('scenario 2: an invalid name immediately shows "Invalid branch" and cannot create a reference', async () => {
    const fetchSpy = mockCreateBranchRoutes({ authenticated: true, canCreate: true });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    await user.click(screen.getByRole('button', { name: 'Branch main' }));
    const input = await screen.findByRole('textbox', { name: 'Find branch' });

    await user.type(input, 'invalid..branch');
    expect(screen.getByText('Invalid branch')).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Create branch: invalid..branch' })
    ).not.toBeInTheDocument();

    // No creation request is ever sent for the invalid reference.
    const createCalls = fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input).includes('/branches') && init?.method === 'POST'
    );
    expect(createCalls.length).toBe(0);

    // The active branch is untouched (still main).
    expect(screen.getByRole('button', { name: 'Branch main' })).toBeInTheDocument();
  });

  it('scenario 2: a rejected creation shows the error and leaves the original state unchanged', async () => {
    const fetchSpy = mockCreateBranchRoutes({
      authenticated: true,
      canCreate: true,
      createResponse: {
        status: 400,
        body: { ok: false, errors: { name: 'Branch already exists' } },
      },
    });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    await user.click(screen.getByRole('button', { name: 'Branch main' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Find branch' }),
      'feature/api-v2'
    );
    await user.click(
      screen.getByRole('option', { name: 'Create branch: feature/api-v2' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Branch already exists'
    );
    // Still on the original branch; no navigation happened and the create
    // entry is no longer offered after the list refresh (server truth).
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs');
    expect(screen.getByRole('button', { name: 'Branch main' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('option', { name: 'Create branch: feature/api-v2' })
      ).not.toBeInTheDocument()
    );
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST').length).toBe(1);
  });

  it('a duplicate name shows the existing branch instead of a create entry', async () => {
    const fetchSpy = mockCreateBranchRoutes({ authenticated: true, canCreate: true });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    await user.click(screen.getByRole('button', { name: 'Branch main' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Find branch' }),
      'main'
    );
    expect(screen.getByRole('option', { name: 'main' })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Create branch: main' })
    ).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST').length).toBe(0);
  });
});

describe('REQ-4-3-2 Create a Branch from an Existing Revision (read-only)', () => {
  it('a visitor without write permission only browses: no create entry and the unmatched state stays', async () => {
    const fetchSpy = mockCreateBranchRoutes({ authenticated: false, canCreate: false });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    await user.click(screen.getByRole('button', { name: 'Branch main' }));
    const input = await screen.findByRole('textbox', { name: 'Find branch' });

    await user.type(input, 'no-such-branch');
    expect(screen.getByText('No matching branch')).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Create branch: no-such-branch' })
    ).not.toBeInTheDocument();

    // An invalid name still reports the invalid state immediately.
    await user.clear(input);
    await user.type(input, 'invalid..branch');
    expect(screen.getByText('Invalid branch')).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Create branch: invalid..branch' })
    ).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST').length).toBe(0);
  });
});
