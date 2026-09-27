import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepositoryOverviewPage from './RepositoryOverviewPage';
import type { RepositoryDetail } from '../api';

const ACRE_DOCS: RepositoryDetail = {
  owner: 'alice-dev',
  name: 'acme-docs',
  description: 'Acme documentation and guides',
  visibility: 'public',
  defaultBranch: 'main',
  createdAt: '2026-01-10T09:00:00.000Z',
  updatedAt: '2026-01-15T10:30:00.000Z',
  files: [
    { name: 'docs', path: 'docs', type: 'directory' },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ],
};

function stubDetail(repository?: RepositoryDetail, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/repositories/alice-dev/acme-docs') {
        return new Response(
          JSON.stringify(repository ? { repository } : { error: 'Not found' }),
          { status, headers: { 'Content-Type': 'application/json' } }
        );
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

describe('RepositoryOverviewPage', () => {
  it('shows heading, Public marker, description, default branch, file list and entries', async () => {
    stubDetail(ACRE_DOCS);
    render(<RepositoryOverviewPage owner="alice-dev" name="acme-docs" />);

    await screen.findByRole('heading', { name: 'alice-dev/acme-docs' });
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText('Acme documentation and guides')).toBeInTheDocument();
    expect(screen.getByText('Default branch:')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Issues' })).toHaveAttribute(
      'href',
      '#/alice-dev/acme-docs/issues'
    );
    expect(screen.getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
      'href',
      '#/alice-dev/acme-docs/pulls'
    );
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '#/alice-dev/acme-docs/settings'
    );

    // File list: the README file link opens the file-content page.
    const readme = screen.getByRole('link', { name: 'README.md' });
    expect(readme).toHaveAttribute('href', '#/alice-dev/acme-docs/blob/main/README.md');
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute(
      'href',
      '#/alice-dev/acme-docs/tree/main/docs'
    );
  });

  it('shows Repository not found when access is denied or the repository is missing', async () => {
    stubDetail(undefined, 404);
    render(<RepositoryOverviewPage owner="alice-dev" name="acme-docs" />);
    await screen.findByRole('heading', { name: 'Repository not found' });
    expect(screen.queryByRole('heading', { name: 'alice-dev/acme-docs' })).not.toBeInTheDocument();
  });
});
