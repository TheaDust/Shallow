import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SearchPage from './SearchPage';
import type { RepositorySummary } from '../api';

const ACRE_DOCS: RepositorySummary = {
  owner: 'alice-dev',
  name: 'acme-docs',
  description: 'Acme documentation and guides',
  visibility: 'public',
  updatedAt: '2026-01-15T10:30:00.000Z',
};

function stubSearch(results: RepositorySummary[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/search')) {
        return new Response(JSON.stringify({ results }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('SearchPage', () => {
  it('shows repository results with owner/name, description, visibility and update time', async () => {
    stubSearch([ACRE_DOCS]);
    window.location.hash = '#/search?q=acme';
    render(<SearchPage />);

    const resultLink = await screen.findByRole('link', { name: 'acme-docs' });
    expect(resultLink).toHaveAttribute('href', '#/alice-dev/acme-docs');
    expect(screen.getByRole('heading', { name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByText('alice-dev/acme-docs')).toBeInTheDocument();
    expect(screen.getByText('Acme documentation and guides')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'secret-research' })).not.toBeInTheDocument();
  });

  it('displays exactly No results for a query without matches', async () => {
    stubSearch([]);
    window.location.hash = '#/search?q=secret';
    render(<SearchPage />);
    await screen.findByText('No results');
    expect(screen.queryByRole('link', { name: 'acme-docs' })).not.toBeInTheDocument();
  });

  it('has a selectable Repositories filter and clears results on a non-matching filter', async () => {
    stubSearch([ACRE_DOCS]);
    window.location.hash = '#/search?q=acme';
    render(<SearchPage />);

    await screen.findByRole('link', { name: 'acme-docs' });
    const repositoriesFilter = screen.getByRole('link', { name: 'Repositories' });
    expect(repositoriesFilter).toHaveAttribute('href', '#/search?q=acme&type=Repositories');

    const user = userEvent.setup();
    await user.click(repositoriesFilter);
    // The same repository results remain under the Repositories scope.
    expect(await screen.findByRole('link', { name: 'acme-docs' })).toBeInTheDocument();
    expect(repositoriesFilter).toHaveAttribute('aria-current', 'page');

    // Switching to a non-matching scope does not retain old results.
    await user.click(screen.getByRole('link', { name: 'Code' }));
    await screen.findByText('No results');
    expect(screen.queryByRole('link', { name: 'acme-docs' })).not.toBeInTheDocument();
  });

  it('shows an empty query as No results', async () => {
    stubSearch([]);
    window.location.hash = '#/search?q=';
    render(<SearchPage />);
    await screen.findByText('No results');
  });
});
