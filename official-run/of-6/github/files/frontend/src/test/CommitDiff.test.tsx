import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const SEARCH_TS_CONTENT =
  '// Search flow\n//\n// This file documents the search flow used by the Acme platform.\nexport const searchFlow = true;\n';

const branchCommits = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'commit-2' },
    commits: [
      {
        id: 'commit-2',
        shortId: 'c2abc12',
        message: 'Document search flow',
        author: 'alice-dev',
        createdAt: '2026-01-05T00:00:00.000Z',
        parents: [{ id: 'commit-1', shortId: 'c1abc01', message: 'Initial commit' }],
        files: ['README.md', 'src/search.ts'],
      },
      {
        id: 'commit-1',
        shortId: 'c1abc01',
        message: 'Initial commit',
        author: 'alice-dev',
        createdAt: '2026-01-01T00:00:00.000Z',
        parents: [],
        files: ['README.md'],
      },
    ],
  },
});

const commitDetail2 = () => ({
  status: 200,
  body: {
    ok: true,
    commit: {
      id: 'commit-2',
      shortId: 'c2abc12',
      message: 'Document search flow',
      author: 'alice-dev',
      createdAt: '2026-01-05T00:00:00.000Z',
      parents: [{ id: 'commit-1', shortId: 'c1abc01', message: 'Initial commit' }],
      base: { id: 'commit-1', shortId: 'c1abc01', message: 'Initial commit' },
      additions: 7,
      deletions: 1,
      files: [
        {
          path: 'README.md',
          content: '# acme-docs\n\nDocumentation for the Acme platform.\n\n## Search flow\n',
          additions: 3,
          deletions: 1,
          lines: [
            { type: 'context', text: '# acme-docs' },
            { type: 'context', text: '' },
            { type: 'del', text: 'Documentation for the Acme platform' },
            { type: 'add', text: 'Documentation for the Acme platform.' },
            { type: 'add', text: '' },
            { type: 'add', text: '## Search flow' },
          ],
        },
        {
          path: 'src/search.ts',
          content: SEARCH_TS_CONTENT,
          additions: 4,
          deletions: 0,
          lines: [
            { type: 'add', text: '// Search flow' },
            { type: 'add', text: '//' },
            { type: 'add', text: '// This file documents the search flow used by the Acme platform.' },
            { type: 'add', text: 'export const searchFlow = true;' },
          ],
        },
      ],
    },
  },
});

const compareResult = () => ({
  status: 200,
  body: {
    ok: true,
    base: { id: 'commit-1', shortId: 'c1abc01', message: 'Initial commit' },
    compare: { id: 'commit-2', shortId: 'c2abc12', message: 'Document search flow' },
    additions: 7,
    deletions: 1,
    files: [
      {
        path: 'README.md',
        content: '# acme-docs\n\nDocumentation for the Acme platform.\n\n## Search flow\n',
        additions: 3,
        deletions: 1,
        lines: [
          { type: 'context', text: '# acme-docs' },
          { type: 'context', text: '' },
          { type: 'del', text: 'Documentation for the Acme platform' },
          { type: 'add', text: 'Documentation for the Acme platform.' },
          { type: 'add', text: '' },
          { type: 'add', text: '## Search flow' },
        ],
      },
      {
        path: 'src/search.ts',
        content: SEARCH_TS_CONTENT,
        additions: 4,
        deletions: 0,
        lines: [
          { type: 'add', text: '// Search flow' },
          { type: 'add', text: '//' },
          { type: 'add', text: '// This file documents the search flow used by the Acme platform.' },
          { type: 'add', text: 'export const searchFlow = true;' },
        ],
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

describe('REQ-4-2-2 Inspect Commit and Revision Differences (visitor)', () => {
  it('clicking the short hash of a commit opens the diff page with base/compare identifiers, changed files and the numeric additions/deletions summary', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs/commits': branchCommits,
      '/api/repositories/acme-demo/acme-docs/commits/commit-2': commitDetail2,
    });

    navigate('#/repositories/acme-demo/acme-docs/commits');
    render(<App />);

    await screen.findByRole('heading', { name: 'Commits' });
    await user.click(await screen.findByRole('link', { name: 'c2abc12' }));

    expect(await screen.findByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Document search flow' })).toBeInTheDocument();
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/commit/commit-2'
    );

    // The base (parent) and compare (commit) identifiers are displayed.
    expect(screen.getByRole('link', { name: 'c1abc01' })).toBeInTheDocument();
    expect(screen.getAllByText('c2abc12').length).toBeGreaterThan(0);

    // The changed-file path is an exact text value, the "Changed files"
    // summary and the numeric additions/deletions summary are shown.
    expect(screen.getByRole('heading', { name: 'Changed files' })).toBeInTheDocument();
    expect(
      screen.getByText('2 files changed, 7 additions and 1 deletions')
    ).toBeInTheDocument();
    const searchLink = screen.getByRole('link', { name: 'src/search.ts' });
    expect(searchLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/commit/commit-2/src/search.ts'
    );
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.getByText('+4 -0')).toBeInTheDocument();
    expect(screen.getByText('+3 -1')).toBeInTheDocument();
  });

  it('clicking a changed file navigates to that file diff with the added/deleted lines', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs/commits/commit-2': commitDetail2,
    });

    navigate('#/repositories/acme-demo/acme-docs/commit/commit-2');
    render(<App />);

    await screen.findByRole('heading', { name: 'Changed files' });
    await user.click(screen.getByRole('link', { name: 'src/search.ts' }));

    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/commit/commit-2/src/search.ts'
    );
    expect(await screen.findByRole('heading', { name: 'src/search.ts' })).toBeInTheDocument();
    // Base and compare identifiers of the file diff (breadcrumb + identifier
    // row may both show the compare short hash).
    expect(screen.getByRole('link', { name: 'c1abc01' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'c2abc12' }).length).toBeGreaterThan(0);
    // The line-by-line additions of the new file are displayed.
    expect(screen.getByText(/^\+export const searchFlow = true;$/)).toBeInTheDocument();
    expect(screen.getByText(/^\+[/][/] Search flow$/)).toBeInTheDocument();
    expect(document.querySelectorAll('.diff-line.add').length).toBe(4);
  });

  it('the comparison page lets a visitor select a base and compare revision and click Compare to open the diff page', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs/commits': branchCommits,
      '/api/repositories/acme-demo/acme-docs/compare': compareResult,
    });

    navigate('#/repositories/acme-demo/acme-docs/compare');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Compare changes' })).toBeInTheDocument();
    const baseSelect = await screen.findByLabelText('Base');
    const compareSelect = screen.getByLabelText('Compare');
    await user.selectOptions(baseSelect, 'c1abc01 Initial commit');
    await user.selectOptions(compareSelect, 'c2abc12 Document search flow');
    await user.click(screen.getByRole('button', { name: 'Compare' }));

    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/compare/commit-1/commit-2'
    );
    expect(await screen.findByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    // The diff page displays the base and compare identifiers.
    expect(screen.getByRole('link', { name: 'c1abc01' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'c2abc12' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Changed files' })).toBeInTheDocument();
    const searchLink = screen.getByRole('link', { name: 'src/search.ts' });
    expect(searchLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/compare/commit-1/commit-2/src/search.ts'
    );
    expect(screen.getByText('2 files changed, 7 additions and 1 deletions')).toBeInTheDocument();
    expect(screen.getByText('+4 -0')).toBeInTheDocument();
  });

  it('refreshing the diff page keeps the same base, compare, files and numbers', async () => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs/compare': compareResult,
    });

    window.location.hash = '#/repositories/acme-demo/acme-docs/compare/commit-1/commit-2';
    const { unmount } = render(<App />);

    await screen.findByRole('heading', { name: 'Changed files' });
    expect(screen.getByRole('link', { name: 'src/search.ts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.getByText('+4 -0')).toBeInTheDocument();

    unmount();
    window.location.hash = '#/repositories/acme-demo/acme-docs/compare/commit-1/commit-2';
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Changed files' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'src/search.ts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/compare/commit-1/commit-2'
    );
    // Unchanged files do not appear (the list only contains changed files).
    const items = document.querySelectorAll('.commit-file-item');
    expect(items.length).toBe(2);
  });

  it('without permission to view a revision the diff content is not displayed', async () => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/alice-dev/secret-research/commits/any-id': () => ({
        status: 403,
        body: { error: 'Access denied' },
      }),
      '/api/repositories/alice-dev/secret-research/compare': () => ({
        status: 403,
        body: { error: 'Access denied' },
      }),
    });

    navigate('#/repositories/alice-dev/secret-research/commit/any-id');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByText('Changed files')).not.toBeInTheDocument();
    expect(screen.queryByText('src/search.ts')).not.toBeInTheDocument();
  });
});
