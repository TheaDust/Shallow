import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const signedInSession = () => ({
  status: 200,
  body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
});

const organizationsBody = () => ({
  status: 200,
  body: {
    ok: true,
    organizations: [
      { name: 'acme-demo', displayName: 'Acme Demo', createdAt: '2026-01-01T00:00:00.000Z', role: 'owner' },
    ],
  },
});

const newProjectOverview = {
  owner: 'alice-dev',
  ownerType: 'user',
  name: 'new-project',
  description: 'Repository created by Playwright',
  visibility: 'private',
  defaultBranch: 'main',
  updatedAt: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-02T00:00:00.000Z',
  role: 'admin',
};

const contentsBody = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c1' },
    files: [{ path: 'README.md', content: '# new-project\n' }],
  },
});

const commitsBody = () => ({
  status: 200,
  body: {
    ok: true,
    commits: [
      {
        id: 'c1',
        message: 'Initial commit',
        author: 'alice-dev',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-3-2-1 Create a Repository with Owner, Visibility, and Initialization Options', () => {
  it('the signed-in workspace provides the New repository link and the creation form has the required controls', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/organizations': organizationsBody,
      '/api/repositories': () => ({
        status: 200,
        body: { ok: true, repositories: [{ owner: 'alice-dev', ownerType: 'user', name: 'secret-research', description: 'Confidential research project data', visibility: 'private', defaultBranch: 'main', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] },
      }),
    });
    navigate('#/workspace');
    render(<App />);

    const newRepoLink = await screen.findByRole('link', { name: 'New repository' });
    expect(newRepoLink).toHaveAttribute('href', '#/new-repository');
    await user.click(newRepoLink);

    expect(await screen.findByRole('button', { name: 'Create repository' })).toBeEnabled();
    // The personal namespace is selected by default and the organization the
    // user may create repositories for is also offered.
    await screen.findByRole('option', { name: 'alice-dev' });
    const ownerSelect = screen.getByLabelText('Owner');
    expect(ownerSelect).toHaveValue('alice-dev');
    expect(screen.getByRole('option', { name: 'acme-demo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Repository name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Public' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Private' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Add a README file' })).not.toBeChecked();
    expect(window.location.hash).toBe('#/new-repository');
  });

  it('creating an initialized private repository enters the overview with README link and initialization commit', async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetch({
      '/api/auth/session': signedInSession,
      '/api/organizations': organizationsBody,
      'POST /api/repositories': () => ({
        status: 201,
        body: { ok: true, repository: newProjectOverview },
      }),
      '/api/repositories/alice-dev/new-project': () => ({
        status: 200,
        body: { ok: true, repository: newProjectOverview },
      }),
      '/api/repositories/alice-dev/new-project/contents': contentsBody,
      '/api/repositories/alice-dev/new-project/commits': commitsBody,
    });

    navigate('#/new-repository');
    render(<App />);

    await screen.findByRole('button', { name: 'Create repository' });
    await screen.findByRole('option', { name: 'alice-dev' });
    await user.selectOptions(screen.getByLabelText('Owner'), 'alice-dev');
    await user.type(screen.getByLabelText('Repository name'), 'new-project');
    await user.type(screen.getByLabelText('Description'), 'Repository created by Playwright');
    await user.click(screen.getByRole('radio', { name: 'Private' }));
    await user.click(screen.getByRole('checkbox', { name: 'Add a README file' }));
    await user.click(screen.getByRole('button', { name: 'Create repository' }));

    // The system enters the "owner/repository name" overview page, marked Private.
    expect(await screen.findByRole('heading', { name: 'alice-dev/new-project' })).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/alice-dev/new-project');

    // The default branch contains a README file link and the commit history
    // contains exactly one initialization commit.
    const readmeLink = await screen.findByRole('link', { name: 'README.md' });
    expect(readmeLink).toHaveAttribute(
      'href',
      '#/repositories/alice-dev/new-project/blob/main/README.md'
    );
    expect(screen.getByText('1 commit')).toBeInTheDocument();
    expect(screen.getByText('Initial commit')).toBeInTheDocument();
    expect(screen.getByText('Repository created by Playwright')).toBeInTheDocument();

    const postCalls = fetchSpy.mock.calls.filter(
      (call) => String(call[0]) === '/api/repositories' && call[1]?.method === 'POST'
    );
    expect(postCalls.length).toBe(1);
    expect(JSON.parse(String(postCalls[0][1]?.body))).toEqual({
      owner: 'alice-dev',
      name: 'new-project',
      description: 'Repository created by Playwright',
      visibility: 'private',
      initialize: true,
    });
  });

  it('the README file link opens the persisted file content and the commits page shows the initialization commit', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/repositories/alice-dev/new-project': () => ({
        status: 200,
        body: { ok: true, repository: newProjectOverview },
      }),
      '/api/repositories/alice-dev/new-project/contents': contentsBody,
      '/api/repositories/alice-dev/new-project/commits': commitsBody,
      '/api/repositories/alice-dev/new-project/contents/main/README.md': () => ({
        status: 200,
        body: { ok: true, branch: 'main', file: { path: 'README.md', content: '# new-project\n' } },
      }),
    });

    navigate('#/repositories/alice-dev/new-project');
    render(<App />);

    await screen.findByRole('heading', { name: 'alice-dev/new-project' });
    await user.click(await screen.findByRole('link', { name: 'README.md' }));

    expect(await screen.findByText('# new-project')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/alice-dev/new-project/blob/main/README.md');

    // Back to the overview and into the commits page.
    navigate('#/repositories/alice-dev/new-project');
    await user.click(await screen.findByRole('link', { name: '1 commit' }));
    expect(await screen.findByRole('heading', { name: 'Commits' })).toBeInTheDocument();
    expect(screen.getByText('Initial commit')).toBeInTheDocument();
  });

  it('a duplicate repository name in the default personal namespace stays on the form with the conflict', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/organizations': organizationsBody,
      'POST /api/repositories': () => ({
        status: 400,
        body: { ok: false, errors: { name: 'Repository name already exists' } },
      }),
    });
    navigate('#/new-repository');
    render(<App />);

    await screen.findByRole('button', { name: 'Create repository' });
    await user.type(screen.getByLabelText('Repository name'), 'secret-research');
    await user.click(screen.getByRole('button', { name: 'Create repository' }));

    expect(await screen.findByText('Repository name already exists')).toBeInTheDocument();
    expect(screen.getByLabelText('Repository name')).toHaveValue('secret-research');
    expect(screen.getByRole('heading', { name: 'Create a new repository' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/new-repository');
    // The existing repository heading was not opened.
    expect(screen.queryByRole('heading', { name: 'alice-dev/secret-research' })).not.toBeInTheDocument();
  });

  it('an empty repository name is rejected with the required message and the form stays open', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/organizations': organizationsBody,
      'POST /api/repositories': () => ({
        status: 400,
        body: { ok: false, errors: { name: 'Repository name is required' } },
      }),
    });
    navigate('#/new-repository');
    render(<App />);

    await screen.findByRole('button', { name: 'Create repository' });
    // The default personal owner allows submission without changing it.
    await user.click(screen.getByRole('button', { name: 'Create repository' }));

    expect(await screen.findByText('Repository name is required')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create a new repository' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/new-repository');
  });

  it('a user without organization-creation permission is rejected with the reason shown on the owner field', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/organizations': () => ({
        status: 200,
        body: {
          ok: true,
          organizations: [
            { name: 'acme-demo', displayName: 'Acme Demo', createdAt: '2026-01-01T00:00:00.000Z', role: 'member' },
          ],
        },
      }),
      'POST /api/repositories': () => ({
        status: 403,
        body: { ok: false, errors: { owner: 'Access denied' } },
      }),
    });
    navigate('#/new-repository');
    render(<App />);

    const ownerSelect = await screen.findByLabelText('Owner');
    await screen.findByRole('option', { name: 'bob-reviewer' });
    // bob-reviewer is not an organization Owner, so only the personal
    // namespace is offered.
    expect(ownerSelect).toHaveValue('bob-reviewer');
    expect(screen.queryByRole('option', { name: 'acme-demo' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Repository name'), 'sneaky-repo');
    await user.click(screen.getByRole('button', { name: 'Create repository' }));

    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create a new repository' })).toBeInTheDocument();
  });

  it('an unauthenticated visitor is redirected from the creation page to sign-in', async () => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    });
    navigate('#/new-repository');
    render(<App />);

    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/signin');
    expect(screen.queryByRole('button', { name: 'Create repository' })).not.toBeInTheDocument();
  });

  it('a new personal repository appears in the workspace repository list after creation', async () => {
    const user = userEvent.setup();
    const created = { ...newProjectOverview };
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/organizations': organizationsBody,
      'POST /api/repositories': () => ({
        status: 201,
        body: { ok: true, repository: created },
      }),
      '/api/repositories/alice-dev/new-project': () => ({
        status: 200,
        body: { ok: true, repository: newProjectOverview },
      }),
      '/api/repositories/alice-dev/new-project/contents': contentsBody,
      '/api/repositories/alice-dev/new-project/commits': commitsBody,
      '/api/repositories': () => ({
        status: 200,
        body: {
          ok: true,
          repositories: [
            { owner: 'alice-dev', ownerType: 'user', name: 'secret-research', description: 'Confidential research project data', visibility: 'private', defaultBranch: 'main', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
            { owner: 'alice-dev', ownerType: 'user', name: 'new-project', description: 'Repository created by Playwright', visibility: 'private', defaultBranch: 'main', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
          ],
        },
      }),
    });

    navigate('#/workspace');
    render(<App />);
    await screen.findByRole('link', { name: 'New repository' });
    await user.click(screen.getByRole('link', { name: 'New repository' }));

    await screen.findByRole('button', { name: 'Create repository' });
    await screen.findByRole('option', { name: 'alice-dev' });
    await user.type(screen.getByLabelText('Repository name'), 'new-project');
    await user.click(screen.getByRole('radio', { name: 'Private' }));
    await user.click(screen.getByRole('checkbox', { name: 'Add a README file' }));
    await user.click(screen.getByRole('button', { name: 'Create repository' }));

    await screen.findByRole('heading', { name: 'alice-dev/new-project' });
    navigate('#/workspace');

    expect(await screen.findByRole('link', { name: 'new-project' })).toBeInTheDocument();
    expect(screen.getByText('Repository created by Playwright')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'secret-research' })).toBeInTheDocument();
  });
});
