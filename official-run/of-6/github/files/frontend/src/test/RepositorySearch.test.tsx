import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const publicResult = {
  owner: 'acme-demo',
  ownerType: 'organization',
  name: 'acme-docs',
  description: 'Documentation for the Acme platform',
  visibility: 'public',
  updatedAt: '2026-01-10T00:00:00.000Z',
};

const privateResult = {
  owner: 'alice-dev',
  ownerType: 'user',
  name: 'secret-research',
  description: 'Confidential research project data',
  visibility: 'private',
  updatedAt: '2026-01-09T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-3-1 Search for and Locate Repositories (visitor)', () => {
  beforeEach(() => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      // The server filters by permission; a visitor never receives private repos.
      '/api/search/repositories': () => ({
        status: 200,
        body: { ok: true, repositories: [publicResult] },
      }),
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
      '/api/repositories/alice-dev/secret-research': () => ({
        status: 403,
        body: { error: 'Access denied' },
      }),
    });
  });

  it('the top global search control is a searchbox named Search and Enter shows repository results directly', async () => {
    const user = userEvent.setup();
    render(<App />);

    const searchbox = await screen.findByRole('searchbox', { name: 'Search' });
    await user.type(searchbox, 'acme{Enter}');

    expect(window.location.hash).toBe('#/search?q=acme');
    expect(await screen.findByRole('heading', { name: 'Search results' })).toBeInTheDocument();

    // Repository results appear without any additional type-filter click.
    const docsLink = await screen.findByRole('link', { name: 'acme-docs' });
    expect(docsLink).toHaveAttribute('href', '#/repositories/acme-demo/acme-docs');
    // Owner/name metadata, description, visibility, and update time are shown.
    expect(screen.getByText('acme-demo/acme-docs')).toBeInTheDocument();
    expect(screen.getByText('Documentation for the Acme platform')).toBeInTheDocument();
    expect(screen.getAllByText('Public').length).toBeGreaterThan(0);
    expect(screen.getByText(/^Updated/)).toBeInTheDocument();
    // The unauthorized private repository never appears.
    expect(screen.queryByRole('link', { name: 'secret-research' })).not.toBeInTheDocument();
  });

  it('selecting the Repositories type filter on the results page keeps the repository results', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'acme{Enter}');
    await screen.findByRole('link', { name: 'acme-docs' });

    const repositoriesTab = screen.getByRole('link', { name: 'Repositories' });
    await user.click(repositoriesTab);

    expect(await screen.findByRole('link', { name: 'acme-docs' })).toBeInTheDocument();
    expect(screen.getByText('acme-demo/acme-docs')).toBeInTheDocument();
  });

  it('clicking the result opens the repository overview titled owner/repository name', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'acme{Enter}');
    await user.click(await screen.findByRole('link', { name: 'acme-docs' }));

    expect(await screen.findByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs');
    expect(screen.getByText('Public')).toBeInTheDocument();
  });

  it('clearing the search term does not retain old results', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'acme{Enter}');
    await screen.findByRole('link', { name: 'acme-docs' });

    const searchbox = screen.getByRole('searchbox', { name: 'Search' });
    await user.clear(searchbox);
    await user.type(searchbox, '{Enter}');

    expect(window.location.hash).toBe('#/search?q=');
    expect(await screen.findByText('No results')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'acme-docs' })).not.toBeInTheDocument();
    expect(screen.queryByText('acme-demo/acme-docs')).not.toBeInTheDocument();
  });

  it('switching to a non-matching type filter removes the old results', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'acme{Enter}');
    await screen.findByRole('link', { name: 'acme-docs' });

    await user.click(screen.getByRole('link', { name: 'Issues' }));

    expect(await screen.findByText('No results')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'acme-docs' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#/search?q=acme&type=issues');
  });

  it('directly accessing the unauthorized private repository page still denies access', async () => {
    navigate('#/repositories/alice-dev/secret-research');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '#/signin');
  });
});

describe('REQ-3-1 Search for and Locate Repositories (no-match query)', () => {
  beforeEach(() => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/search/repositories': () => ({
        status: 200,
        body: { ok: true, repositories: [] },
      }),
    });
  });

  it('a query with no matching repository displays No results, including after returning home and repeating the query', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'zzz{Enter}');
    expect(await screen.findByText('No results')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'acme-docs' })).not.toBeInTheDocument();

    // Return home and repeat the same query: still No results.
    await user.click(screen.getByRole('link', { name: 'GitHub Collaboration Platform' }));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();

    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'zzz{Enter}');
    expect(await screen.findByText('No results')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/search?q=zzz');
  });
});

describe('REQ-3-1 Search for and Locate Repositories (signed-in Owner)', () => {
  beforeEach(() => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      // The server returns private repositories the signed-in user may view.
      '/api/search/repositories': () => ({
        status: 200,
        body: { ok: true, repositories: [privateResult] },
      }),
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
            updatedAt: '2026-01-09T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            role: 'admin',
          },
        },
      }),
    });
  });

  it('an authorized signed-in user searches their private repository and opens its overview', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'secret{Enter}');

    const link = await screen.findByRole('link', { name: 'secret-research' });
    expect(link).toHaveAttribute('href', '#/repositories/alice-dev/secret-research');
    expect(screen.getByText('alice-dev/secret-research')).toBeInTheDocument();
    expect(screen.getByText('Confidential research project data')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();

    await user.click(link);
    expect(await screen.findByRole('heading', { name: 'alice-dev/secret-research' })).toBeInTheDocument();

    // Reopening the same address keeps the overview (persisted destination).
    navigate('#/repositories/alice-dev/secret-research');
    expect(await screen.findByRole('heading', { name: 'alice-dev/secret-research' })).toBeInTheDocument();
  });
});
