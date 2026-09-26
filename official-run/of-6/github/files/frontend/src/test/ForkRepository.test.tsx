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

const acmeDocsSource = {
  owner: 'acme-demo',
  ownerType: 'organization',
  name: 'acme-docs',
  description: 'Documentation for the Acme platform',
  visibility: 'public',
  defaultBranch: 'main',
  updatedAt: '2026-01-10T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'read',
  forkedFrom: null,
};

const forkOverview = {
  owner: 'alice-dev',
  ownerType: 'user',
  name: 'acme-docs',
  description: 'Documentation for the Acme platform',
  visibility: 'public',
  defaultBranch: 'main',
  updatedAt: '2026-01-11T00:00:00.000Z',
  createdAt: '2026-01-11T00:00:00.000Z',
  role: 'admin',
  forkedFrom: { owner: 'acme-demo', name: 'acme-docs' },
};

const forkContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c1' },
    files: [{ path: 'README.md', content: '# acme-docs\n\nDocumentation for the Acme platform.\n' }],
  },
});

const forkCommits = () => ({
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-3-2-2 Fork a Repository into Another Namespace', () => {
  it('the source overview has a Fork button and the fork form shows the required defaults', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: acmeDocsSource },
      }),
      '/api/repositories/acme-demo/acme-docs/contents': () => ({
        status: 200,
        body: { ok: true, branch: { name: 'main', headCommitId: 'c1' }, files: [{ path: 'README.md', content: '# acme-docs\n' }] },
      }),
      '/api/repositories/acme-demo/acme-docs/commits': forkCommits,
      '/api/organizations': organizationsBody,
    });

    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    const forkButton = screen.getByRole('button', { name: 'Fork' });
    await user.click(forkButton);

    // The fork form defaults to the personal namespace and an allowed
    // visibility, so submission works after editing only the name.
    expect(await screen.findByRole('button', { name: 'Create fork' })).toBeEnabled();
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/fork');
    const ownerSelect = screen.getByLabelText('Owner');
    expect(ownerSelect).toHaveValue('alice-dev');
    expect(screen.getByRole('option', { name: 'acme-demo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Repository name')).toHaveValue('acme-docs');
    expect(screen.getByLabelText('Description')).toHaveValue('Documentation for the Acme platform');
    expect(screen.getByRole('radio', { name: 'Public' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Private' })).not.toBeChecked();
  });

  it('keeping the default name and clicking Create fork opens the fork overview with the source link', async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetch({
      '/api/auth/session': signedInSession,
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: acmeDocsSource },
      }),
      '/api/organizations': organizationsBody,
      'POST /api/repositories/acme-demo/acme-docs/forks': () => ({
        status: 201,
        body: { ok: true, repository: forkOverview },
      }),
      '/api/repositories/alice-dev/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: forkOverview },
      }),
      '/api/repositories/alice-dev/acme-docs/contents': forkContents,
      '/api/repositories/alice-dev/acme-docs/commits': forkCommits,
    });

    navigate('#/repositories/acme-demo/acme-docs/fork');
    render(<App />);

    await screen.findByRole('button', { name: 'Create fork' });
    await user.click(screen.getByRole('button', { name: 'Create fork' }));

    // The new fork overview page opens with a heading containing the fork
    // name and the source relationship “Forked from <source repository name>”.
    expect(await screen.findByRole('heading', { name: 'alice-dev/acme-docs' })).toBeInTheDocument();
    const forkedFrom = screen.getByText(/Forked from/);
    expect(forkedFrom.textContent).toContain('Forked from');
    const sourceLink = screen.getByRole('link', { name: 'acme-demo/acme-docs' });
    expect(sourceLink).toHaveAttribute('href', '#/repositories/acme-demo/acme-docs');
    expect(window.location.hash).toBe('#/repositories/alice-dev/acme-docs');

    // The default branch contains the copied README and the copied history.
    expect(await screen.findByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.getByText('1 commit')).toBeInTheDocument();

    const postCalls = fetchSpy.mock.calls.filter(
      (call) => String(call[0]) === '/api/repositories/acme-demo/acme-docs/forks' && call[1]?.method === 'POST'
    );
    expect(postCalls.length).toBe(1);
    expect(JSON.parse(String(postCalls[0][1]?.body))).toEqual({
      owner: 'alice-dev',
      name: 'acme-docs',
      description: 'Documentation for the Acme platform',
      visibility: 'public',
    });
  });

  it('a conflicting fork name stays on the form with the conflict error', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: acmeDocsSource },
      }),
      '/api/organizations': organizationsBody,
      'POST /api/repositories/acme-demo/acme-docs/forks': () => ({
        status: 400,
        body: { ok: false, errors: { name: 'Repository name already exists' } },
      }),
    });

    navigate('#/repositories/acme-demo/acme-docs/fork');
    render(<App />);

    const nameField = await screen.findByLabelText('Repository name');
    await user.clear(nameField);
    await user.type(nameField, 'acme-docs-fork');
    await user.click(screen.getByRole('button', { name: 'Create fork' }));

    expect(await screen.findByText('Repository name already exists')).toBeInTheDocument();
    expect(screen.getByLabelText('Repository name')).toHaveValue('acme-docs-fork');
    expect(screen.getByRole('heading', { name: 'Fork repository' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/fork');
    // The fork overview was not opened.
    expect(screen.queryByRole('heading', { name: 'alice-dev/acme-docs-fork' })).not.toBeInTheDocument();
  });

  it('a private source forces the fork to stay Private', async () => {
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/repositories/alice-dev/secret-research': () => ({
        status: 200,
        body: {
          ok: true,
          repository: {
            owner: 'alice-dev',
            ownerType: 'user',
            name: 'secret-research',
            description: 'Confidential research project data',
            visibility: 'private',
            defaultBranch: 'main',
            updatedAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            role: 'admin',
            forkedFrom: null,
          },
        },
      }),
      '/api/organizations': organizationsBody,
    });

    navigate('#/repositories/alice-dev/secret-research/fork');
    render(<App />);

    await screen.findByRole('button', { name: 'Create fork' });
    expect(screen.getByRole('radio', { name: 'Private' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Public' })).toBeDisabled();
  });

  it('the user can select an organization namespace for the fork', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: acmeDocsSource },
      }),
      '/api/organizations': organizationsBody,
      'POST /api/repositories/acme-demo/acme-docs/forks': () => ({
        status: 201,
        body: {
          ok: true,
          repository: {
            owner: 'acme-demo',
            ownerType: 'organization',
            name: 'docs-org-fork',
            description: 'Documentation for the Acme platform',
            visibility: 'private',
            defaultBranch: 'main',
            createdAt: '2026-01-11T00:00:00.000Z',
            updatedAt: '2026-01-11T00:00:00.000Z',
          },
        },
      }),
      '/api/repositories/acme-demo/docs-org-fork': () => ({
        status: 200,
        body: {
          ok: true,
          repository: {
            owner: 'acme-demo',
            ownerType: 'organization',
            name: 'docs-org-fork',
            description: 'Documentation for the Acme platform',
            visibility: 'private',
            defaultBranch: 'main',
            updatedAt: '2026-01-11T00:00:00.000Z',
            createdAt: '2026-01-11T00:00:00.000Z',
            role: 'admin',
            forkedFrom: { owner: 'acme-demo', name: 'acme-docs' },
          },
        },
      }),
      '/api/repositories/acme-demo/docs-org-fork/contents': forkContents,
      '/api/repositories/acme-demo/docs-org-fork/commits': forkCommits,
    });

    navigate('#/repositories/acme-demo/acme-docs/fork');
    render(<App />);

    const ownerSelect = await screen.findByLabelText('Owner');
    await screen.findByRole('option', { name: 'acme-demo' });
    await user.selectOptions(ownerSelect, 'acme-demo');
    await user.clear(screen.getByLabelText('Repository name'));
    await user.type(screen.getByLabelText('Repository name'), 'docs-org-fork');
    await user.click(screen.getByRole('radio', { name: 'Private' }));
    await user.click(screen.getByRole('button', { name: 'Create fork' }));

    expect(await screen.findByRole('heading', { name: 'acme-demo/docs-org-fork' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/acme-demo/docs-org-fork');
  });

  it('an unauthenticated visitor is redirected from the fork page to sign-in', async () => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    });
    navigate('#/repositories/acme-demo/acme-docs/fork');
    render(<App />);

    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/signin');
    expect(screen.queryByRole('button', { name: 'Create fork' })).not.toBeInTheDocument();
  });

  it('a source repository without read access shows Access denied on the fork page', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/alice-dev/secret-research': () => ({
        status: 403,
        body: { error: 'Access denied' },
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
    });

    navigate('#/repositories/alice-dev/secret-research/fork');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create fork' })).not.toBeInTheDocument();
  });
});
