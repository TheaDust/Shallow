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

const README_CONTENT = '# acme-docs\n\nDocumentation for the Acme platform.\n';
const SEARCH_TS_CONTENT =
  '// Search flow\n//\n// This file documents the search flow used by the Acme platform.\nexport const searchFlow = true;\n';

const acmeDocsContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'commit-2' },
    files: [
      { path: 'README.md', content: README_CONTENT },
      { path: 'src/search.ts', content: SEARCH_TS_CONTENT },
    ],
    entries: [
      { name: 'src', type: 'directory', path: 'src' },
      { name: 'README.md', type: 'file', path: 'README.md' },
    ],
  },
});

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

const fileScopedCommits = () => ({
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
        files: ['src/search.ts'],
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
      files: [
        { path: 'README.md', content: README_CONTENT },
        { path: 'src/search.ts', content: SEARCH_TS_CONTENT },
      ],
    },
  },
});

const searchTsFile = () => ({
  status: 200,
  body: {
    ok: true,
    branch: 'main',
    file: { path: 'src/search.ts', content: SEARCH_TS_CONTENT },
    commit: {
      id: 'commit-2',
      message: 'Document search flow',
      author: 'alice-dev',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-4-2-1 View Repository Commit History (visitor)', () => {
  it('clicking the commit-count link above the file list opens the branch history newest first with short hash, message, author and time', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: acmeDocsOverview },
      }),
      '/api/repositories/acme-demo/acme-docs/contents': acmeDocsContents,
      '/api/repositories/acme-demo/acme-docs/commits': branchCommits,
      '/api/repositories/acme-demo/acme-docs/contents/main/README.md': () => ({
        status: 200,
        body: { ok: true, branch: 'main', file: { path: 'README.md', content: README_CONTENT } },
      }),
    });

    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    // The commit-count link is the single history link above the file list.
    const commitsLink = await screen.findByRole('link', { name: '2 commits' });
    expect(commitsLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/commits'
    );

    await user.click(commitsLink);

    expect(await screen.findByRole('heading', { name: 'Commits' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/commits');
    // The scope line shows the repository and the current branch.
    expect(screen.getByText('acme-demo/acme-docs')).toBeInTheDocument();
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);

    // Wait for the commit list to finish loading before reading it.
    expect(await screen.findByRole('link', { name: 'Document search flow' })).toBeInTheDocument();

    // Newest first: the later commit is listed above the older one.
    const items = document.querySelectorAll('.commit-list-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Document search flow');
    expect(items[1].textContent).toContain('Initial commit');

    // Each item shows the short hash, commit message, author and a relative
    // timestamp containing "ago".
    expect(screen.getByRole('link', { name: 'c2abc12' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'c1abc01' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Document search flow' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Initial commit' })).toBeInTheDocument();
    expect(screen.getAllByText(/alice-dev/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ago/).length).toBeGreaterThan(0);
  });

  it('clicking a commit enters its detail page showing the parent revision and the changed files', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: acmeDocsOverview },
      }),
      '/api/repositories/acme-demo/acme-docs/contents': acmeDocsContents,
      '/api/repositories/acme-demo/acme-docs/commits': branchCommits,
      '/api/repositories/acme-demo/acme-docs/commits/commit-2': commitDetail2,
      '/api/repositories/acme-demo/acme-docs/contents/main/README.md': () => ({
        status: 200,
        body: { ok: true, branch: 'main', file: { path: 'README.md', content: README_CONTENT } },
      }),
    });

    navigate('#/repositories/acme-demo/acme-docs/commits');
    render(<App />);

    await screen.findByRole('heading', { name: 'Commits' });
    // Wait for the commit list to finish loading before clicking an entry.
    await screen.findByRole('link', { name: 'Document search flow' });
    await user.click(screen.getByRole('link', { name: 'Document search flow' }));

    expect(await screen.findByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Document search flow' })).toBeInTheDocument();
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/commit/commit-2'
    );

    // The corresponding parent revision remains visible (short hash + message,
    // linked to its own detail page).
    const parentLink = screen.getByRole('link', { name: 'c1abc01' });
    expect(parentLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/commit/commit-1'
    );
    expect(screen.getByText('Initial commit')).toBeInTheDocument();

    // The changed files of the commit remain visible.
    expect(screen.getByText('Changed files')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('src/search.ts')).toBeInTheDocument();
    expect(screen.getByText(/alice-dev/)).toBeInTheDocument();
  });

  it('refreshing the history page keeps the commit order and content', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: acmeDocsOverview },
      }),
      '/api/repositories/acme-demo/acme-docs/contents': acmeDocsContents,
      '/api/repositories/acme-demo/acme-docs/commits': branchCommits,
      '/api/repositories/acme-demo/acme-docs/contents/main/README.md': () => ({
        status: 200,
        body: { ok: true, branch: 'main', file: { path: 'README.md', content: README_CONTENT } },
      }),
    });

    navigate('#/repositories/acme-demo/acme-docs');
    const { unmount } = render(<App />);
    await user.click(await screen.findByRole('link', { name: '2 commits' }));
    await screen.findByRole('heading', { name: 'Commits' });

    // Reopening the same address (refresh / direct reopen) reads the same
    // order and content from the persisted server state.
    unmount();
    window.location.hash = '#/repositories/acme-demo/acme-docs/commits';
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Commits' })).toBeInTheDocument();
    // Wait for the committed list to load before counting its items.
    expect(await screen.findByText('Document search flow')).toBeInTheDocument();
    expect(screen.getByText('Initial commit')).toBeInTheDocument();
    const items = document.querySelectorAll('.commit-list-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Document search flow');
    expect(items[1].textContent).toContain('Initial commit');
    expect(screen.getByRole('link', { name: 'c2abc12' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'c1abc01' })).toBeInTheDocument();
  });

  it('the file page exposes the Commits history link and the file-scoped history excludes commits that did not modify the file', async () => {
    const user = userEvent.setup();
    let commitsHandler = branchCommits;
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: { ok: true, repository: acmeDocsOverview },
      }),
      '/api/repositories/acme-demo/acme-docs/contents': acmeDocsContents,
      '/api/repositories/acme-demo/acme-docs/commits': () => commitsHandler(),
      '/api/repositories/acme-demo/acme-docs/contents/main/src/search.ts': searchTsFile,
    });

    navigate('#/repositories/acme-demo/acme-docs/blob/main/src/search.ts');
    render(<App />);

    await screen.findByText(/export const searchFlow = true;/);
    const commitsLink = screen.getByRole('link', { name: 'Commits' });
    expect(commitsLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/commits/main/src/search.ts'
    );

    // The server returns only the commits that modified this file.
    commitsHandler = fileScopedCommits;
    await user.click(commitsLink);

    expect(await screen.findByRole('heading', { name: 'Commits' })).toBeInTheDocument();
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/commits/main/src/search.ts'
    );
    // The scope line names the branch and the file path.
    expect(screen.getByText('src/search.ts')).toBeInTheDocument();
    // The later commit that added the file is shown; the commit that did not
    // modify this file is not displayed.
    expect(screen.getByRole('link', { name: 'Document search flow' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Initial commit' })).not.toBeInTheDocument();
  });
});
