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

const SEARCH_TS_CONTENT =
  '// Search flow\n//\n// This file documents the search flow used by the Acme platform.\nexport const searchFlow = true;\n';

const rootContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c2' },
    files: [
      { path: 'README.md', content: '# acme-docs\n\nDocumentation for the Acme platform.\n' },
      { path: 'src/search.ts', content: SEARCH_TS_CONTENT },
    ],
    entries: [
      { name: 'src', type: 'directory', path: 'src' },
      { name: 'README.md', type: 'file', path: 'README.md' },
    ],
  },
});

const treeMain = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c2' },
    path: '',
    entries: [
      { name: 'src', type: 'directory', path: 'src' },
      { name: 'README.md', type: 'file', path: 'README.md' },
    ],
  },
});

const treeMainSrc = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c2' },
    path: 'src',
    entries: [{ name: 'search.ts', type: 'file', path: 'src/search.ts' }],
  },
});

const treeFeatureSearch = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'feature-search', headCommitId: 'c1' },
    path: '',
    entries: [{ name: 'README.md', type: 'file', path: 'README.md' }],
  },
});

const searchTsFile = () => ({
  status: 200,
  body: {
    ok: true,
    branch: 'main',
    file: { path: 'src/search.ts', content: SEARCH_TS_CONTENT },
    commit: {
      id: 'c2',
      message: 'Document search flow',
      author: 'alice-dev',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  },
});

const readmeFile = () => ({
  status: 200,
  body: {
    ok: true,
    branch: 'main',
    file: { path: 'README.md', content: '# acme-docs\n\nDocumentation for the Acme platform.\n' },
    commit: {
      id: 'c2',
      message: 'Document search flow',
      author: 'alice-dev',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
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

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

function mockBrowseRoutes() {
  mockFetch({
    '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    '/api/repositories/acme-demo/acme-docs': () => ({
      status: 200,
      body: { ok: true, repository: acmeDocsOverview },
    }),
    '/api/repositories/acme-demo/acme-docs/contents': rootContents,
    '/api/repositories/acme-demo/acme-docs/commits': acmeDocsCommits,
    '/api/repositories/acme-demo/acme-docs/branches': () => ({
      status: 200,
      body: {
        ok: true,
        defaultBranch: 'main',
        canCreate: false,
        branches: [
          { name: 'main', headCommitId: 'c2' },
          { name: 'feature-search', headCommitId: 'c1' },
        ],
      },
    }),
    '/api/repositories/acme-demo/acme-docs/tree/main': treeMain,
    '/api/repositories/acme-demo/acme-docs/tree/main/src': treeMainSrc,
    '/api/repositories/acme-demo/acme-docs/tree/feature-search': treeFeatureSearch,
    '/api/repositories/acme-demo/acme-docs/contents/main/src/search.ts': searchTsFile,
    '/api/repositories/acme-demo/acme-docs/contents/main/README.md': readmeFile,
    '/api/repositories/acme-demo/acme-docs/contents/feature-search/src/search.ts': () => ({
      status: 404,
      body: { error: 'File not found' },
    }),
  });
}

describe('REQ-4-1 Browse Repository Files and Directories (visitor)', () => {
  beforeEach(() => {
    mockBrowseRoutes();
  });

  it('the Code page lists the nested directory and the root file with exact accessible names', async () => {
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    const srcLink = screen.getByRole('link', { name: 'src' });
    expect(srcLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/tree/main/src'
    );
    const readmeLink = screen.getByRole('link', { name: 'README.md' });
    expect(readmeLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/blob/main/README.md'
    );
  });

  it('clicking the nested-directory name opens the directory page with branch, breadcrumbs and the file list', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'src' }));

    expect(await screen.findByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    // Current branch and path breadcrumbs.
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);
    expect(screen.getByText('src')).toBeInTheDocument();
    // The file list of that directory: the text file with its exact name.
    const searchLink = screen.getByRole('link', { name: 'search.ts' });
    expect(searchLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/blob/main/src/search.ts'
    );
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/tree/main/src');
  });

  it('clicking the text-file name opens the saved content with the full path, branch and most recent commit', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'src' }));
    await user.click(await screen.findByRole('link', { name: 'search.ts' }));

    // The expected content is visible as a complete text value.
    expect(await screen.findByText(/export const searchFlow = true;/)).toBeInTheDocument();
    expect(document.querySelector('.file-content')?.textContent).toBe(SEARCH_TS_CONTENT);
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/blob/main/src/search.ts'
    );
    // Full path breadcrumbs: owner/name, branch, parent directory, file name.
    expect(screen.getByRole('link', { name: 'src' })).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/tree/main/src'
    );
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('search.ts')).toBeInTheDocument();
    // Most recent commit of the file is displayed.
    expect(screen.getByText('Document search flow')).toBeInTheDocument();
    expect(screen.getByText(/alice-dev/)).toBeInTheDocument();
  });

  it('the breadcrumbs can return to the parent directory', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/blob/main/src/search.ts');
    render(<App />);

    await screen.findByText(/export const searchFlow = true;/);
    await user.click(screen.getByRole('link', { name: 'src' }));

    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/tree/main/src');
    expect(await screen.findByRole('link', { name: 'search.ts' })).toBeInTheDocument();
  });

  it('reloading the file page retains the same branch, path and content', async () => {
    window.location.hash = '#/repositories/acme-demo/acme-docs/blob/main/src/search.ts';
    const { unmount } = render(<App />);

    await screen.findByText(/export const searchFlow = true;/);
    expect(document.querySelector('.file-content')?.textContent).toBe(SEARCH_TS_CONTENT);
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('search.ts')).toBeInTheDocument();

    // Reopening the same address (refresh / direct reopen) reads the same
    // branch, path and content from the persisted server state.
    unmount();
    window.location.hash = '#/repositories/acme-demo/acme-docs/blob/main/src/search.ts';
    render(<App />);

    await screen.findByText(/export const searchFlow = true;/);
    expect(document.querySelector('.file-content')?.textContent).toBe(SEARCH_TS_CONTENT);
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/blob/main/src/search.ts'
    );
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('a branch that does not contain the file does not display it', async () => {
    navigate('#/repositories/acme-demo/acme-docs/tree/feature-search');
    render(<App />);

    // The directory page of that branch lists only what the branch contains.
    await screen.findByRole('link', { name: 'README.md' });
    expect(screen.queryByRole('link', { name: 'search.ts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'src' })).not.toBeInTheDocument();

    // Directly opening the file on that branch shows that it is not there.
    navigate('#/repositories/acme-demo/acme-docs/blob/feature-search/src/search.ts');
    expect(await screen.findByText(/does not exist or is not accessible/)).toBeInTheDocument();
    expect(screen.queryByText(SEARCH_TS_CONTENT)).not.toBeInTheDocument();
  });
});
