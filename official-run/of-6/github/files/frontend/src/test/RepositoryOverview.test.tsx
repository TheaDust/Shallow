import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  role: 'read',
};

const acmeDocsContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c1' },
    files: [{ path: 'README.md', content: '# acme-docs\n\nDocumentation for the Acme platform.\n' }],
  },
});

const acmeDocsCommits = () => ({
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

describe('REQ-3-3 View a Public Repository Overview (visitor)', () => {
  beforeEach(() => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: acmeDocsOverview },
      }),
      '/api/repositories/acme-demo/acme-docs/contents': acmeDocsContents,
      '/api/repositories/acme-demo/acme-docs/commits': acmeDocsCommits,
      '/api/repositories/acme-demo/acme-docs/contents/main/README.md': () => ({
        status: 200,
        body: {
          ok: true,
          branch: 'main',
          file: { path: 'README.md', content: '# acme-docs\n\nDocumentation for the Acme platform.\n' },
        },
      }),
      '/api/repositories/alice-dev/secret-research': () => ({
        status: 403,
        body: { error: 'Access denied' },
      }),
    });
  });

  it('the overview shows heading, Public marker, description, default branch, file list and the Code/Issues/Pull requests entries', async () => {
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText('Documentation for the Acme platform')).toBeInTheDocument();
    expect(screen.getByText('Default branch')).toBeInTheDocument();
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);

    // The navigation entries are links with the exact required names.
    const codeLink = screen.getByRole('link', { name: 'Code' });
    expect(codeLink).toHaveAttribute('href', '#/repositories/acme-demo/acme-docs');
    expect(screen.getByRole('link', { name: 'Issues' })).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/issues'
    );
    expect(screen.getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/pulls'
    );
    // A visitor without admin rights does not see Settings.
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();

    // The file list contains the seeded README file.
    const readmeLink = await screen.findByRole('link', { name: 'README.md' });
    expect(readmeLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/blob/main/README.md'
    );
  });

  it('clicking a file name enters the file-content page with the saved content', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'README.md' }));

    expect(await screen.findByText(/# acme-docs/)).toBeInTheDocument();
    expect(screen.getByText(/Documentation for the Acme platform\./)).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/blob/main/README.md');
  });

  it('reopening the same address keeps the same repository state', async () => {
    render(<App />);
    navigate('#/repositories/acme-demo/acme-docs');

    expect(await screen.findByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();

    // Reopening through the same address (refresh / direct reopen) shows the
    // same heading and the same seeded content.
    navigate('#/repositories/acme-demo/acme-docs');
    expect(await screen.findByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Code' })).toBeInTheDocument();
  });

  it('a private repository without authorization does not show its content to the visitor', async () => {
    navigate('#/repositories/alice-dev/secret-research');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '#/signin');
    expect(screen.queryByRole('heading', { name: 'alice-dev/secret-research' })).not.toBeInTheDocument();
    expect(screen.queryByText('Confidential research project data')).not.toBeInTheDocument();
  });
});
