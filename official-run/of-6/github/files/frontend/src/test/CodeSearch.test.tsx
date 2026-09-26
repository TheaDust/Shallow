import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const repoOverview = {
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

const readmeContent = '# acme-docs\n\nDocumentation for the Acme platform.\n\n## Search flow\n';

const searchResults = [
  { path: 'README.md', name: 'README.md', line: 5, snippet: '## Search flow', branch: 'main' },
  { path: 'src/search.ts', name: 'search.ts', line: 1, snippet: '// Search flow', branch: 'main' },
];

function repoPageMocks(overrides: Record<string, (init?: RequestInit) => { status: number; body: unknown }> = {}) {
  mockFetch({
    '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    '/api/repositories/acme-demo/acme-docs': () => ({
      status: 200,
      body: { ok: true, repository: repoOverview },
    }),
    '/api/repositories/acme-demo/acme-docs/contents': () => ({
      status: 200,
      body: {
        ok: true,
        branch: { name: 'main', headCommitId: 'abc1234' },
        files: [
          { path: 'README.md', content: readmeContent },
          { path: 'src/search.ts', content: '// Search flow\n' },
        ],
        entries: [
          { name: 'src', type: 'directory', path: 'src' },
          { name: 'README.md', type: 'file', path: 'README.md' },
        ],
      },
    }),
    '/api/repositories/acme-demo/acme-docs/commits': () => ({
      status: 200,
      body: {
        ok: true,
        branch: { name: 'main', headCommitId: 'abc1234' },
        commits: [
          {
            id: 'abc1234',
            message: 'Document search flow',
            author: 'alice-dev',
            createdAt: '2026-01-08T00:00:00.000Z',
            parents: [],
            files: ['README.md', 'src/search.ts'],
          },
        ],
      },
    }),
    '/api/repositories/acme-demo/acme-docs/search': () => ({
      status: 200,
      body: {
        ok: true,
        repository: { owner: 'acme-demo', name: 'acme-docs' },
        branch: { name: 'main', headCommitId: 'abc1234' },
        query: 'search flow',
        path: '',
        language: '',
        languages: ['Markdown', 'TypeScript'],
        results: searchResults,
      },
    }),
    '/api/repositories/acme-demo/acme-docs/contents/main/README.md': () => ({
      status: 200,
      body: {
        ok: true,
        branch: 'main',
        file: { path: 'README.md', content: readmeContent },
        commit: {
          id: 'abc1234',
          message: 'Document search flow',
          author: 'alice-dev',
          createdAt: '2026-01-08T00:00:00.000Z',
        },
      },
    }),
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-4-2-3 Search Code Within a Repository (visitor)', () => {
  beforeEach(() => {
    repoPageMocks();
  });

  it('the repository page exposes one searchbox named Search and Enter lands on the Code results page', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    // Exactly one searchbox named "Search" on the repository page.
    expect(screen.getAllByRole('searchbox', { name: 'Search' })).toHaveLength(1);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'search flow{Enter}');

    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/search?q=search%20flow'
    );
    expect(await screen.findByRole('heading', { name: 'Code search' })).toBeInTheDocument();
  });

  it('the Code results page lists matching files with snippet, path, and branch context and one Code link', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/search?q=search%20flow');
    render(<App />);

    // Matching files with links whose accessible names are the file names.
    const readmeLink = await screen.findByRole('link', { name: 'README.md' });
    expect(readmeLink).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'search.ts' })).toBeInTheDocument();
    // File paths, matching snippet, and branch context are displayed.
    expect(screen.getByText('src/search.ts')).toBeInTheDocument();
    expect(screen.getByText('## Search flow')).toBeInTheDocument();
    expect(screen.getByText('// Search flow')).toBeInTheDocument();
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);

    // The active search page has exactly one Code link (the results-type link).
    const codeLinks = screen.getAllByRole('link', { name: 'Code' });
    expect(codeLinks).toHaveLength(1);
    expect(codeLinks[0]).toHaveAttribute('aria-current', 'page');

    // Selecting the Code result type keeps the code results.
    await user.click(codeLinks[0]);
    expect(await screen.findByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/search?q=search+flow'
    );
  });

  it('the path filter narrows the search route and clearing it shows the other matching files again', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/search?q=search%20flow');
    render(<App />);

    await screen.findByRole('link', { name: 'README.md' });
    const pathFilter = screen.getByLabelText('Path');
    await user.type(pathFilter, 'src/');
    expect(window.location.hash).toContain('path=src%2F');

    // The server performs the filtering; the page keeps rendering returned hits.
    expect(await screen.findByRole('link', { name: 'search.ts' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Path'));
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/search?q=search+flow'
    );
    // Both matching files of the current repository are visible again and no
    // content from unauthorized private repositories is ever rendered.
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'search.ts' })).toBeInTheDocument();
    expect(screen.queryByText('acme-internal')).not.toBeInTheDocument();
  });

  it('the language filter offers repository languages and narrows the search route', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/search?q=search%20flow');
    render(<App />);

    await screen.findByRole('link', { name: 'README.md' });
    const languageFilter = screen.getByLabelText('Language');
    await user.selectOptions(languageFilter, 'TypeScript');
    expect(window.location.hash).toContain('lang=TypeScript');
    expect(await screen.findByRole('link', { name: 'search.ts' })).toBeInTheDocument();
  });

  it('clicking a matching file opens the file location and reopening preserves the file context and the file-name link', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    navigate('#/repositories/acme-demo/acme-docs/search?q=search%20flow');

    await user.click(await screen.findByRole('link', { name: 'README.md' }));

    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/blob/main/README.md'
    );
    expect(await screen.findByText(/## Search flow/)).toBeInTheDocument();

    // Reopening the visible destination preserves the file context, the text,
    // and a link named exactly after the file.
    unmount();
    navigate('#/repositories/acme-demo/acme-docs/search?q=search%20flow');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/search?q=search%20flow'
    );
  });

  it('an unauthorized private repository code search is denied', async () => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/repositories/acme-demo/acme-internal/search': () => ({
        status: 403,
        body: { error: 'Access denied' },
      }),
    });
    navigate('#/repositories/acme-demo/acme-internal/search?q=search%20flow');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '#/signin');
  });
});

describe('REQ-4-2-3 Search Code Within a Repository (absent query)', () => {
  beforeEach(() => {
    repoPageMocks({
      '/api/repositories/acme-demo/acme-docs/search': () => ({
        status: 200,
        body: {
          ok: true,
          repository: { owner: 'acme-demo', name: 'acme-docs' },
          branch: { name: 'main', headCommitId: 'abc1234' },
          query: 'no-such-token',
          path: '',
          language: '',
          languages: [],
          results: [],
        },
      }),
    });
  });

  it('an absent query shows No code results and retains the exact query in Search', async () => {
    navigate('#/repositories/acme-demo/acme-docs/search?q=no-such-token');
    render(<App />);

    expect(await screen.findByText('No code results')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'README.md' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'search.ts' })).not.toBeInTheDocument();
    // The exact query stays in the Search box and in the route.
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('no-such-token');
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/search?q=no-such-token'
    );
  });

  it('returning to the repository and repeating the same search keeps the same empty state without stale matches', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/search?q=no-such-token');
    render(<App />);

    await screen.findByText('No code results');

    // Return to the repository overview.
    navigate('#/repositories/acme-demo/acme-docs');
    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });

    // Repeat the same search: the same empty state, no stale matches.
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'no-such-token{Enter}');
    expect(await screen.findByText('No code results')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'README.md' })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('no-such-token');
  });
});

describe('REQ-4-2-3 Search Code Within a Repository (signed-in)', () => {
  it('a signed-in authorized account can search a private repository and reopening keeps the result', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-internal/search': () => ({
        status: 200,
        body: {
          ok: true,
          repository: { owner: 'acme-demo', name: 'acme-internal' },
          branch: { name: 'main', headCommitId: 'abc1234' },
          query: 'search flow',
          path: '',
          language: '',
          languages: ['Markdown'],
          results: [
            {
              path: 'README.md',
              name: 'README.md',
              line: 5,
              snippet: 'Search flow experiments for the Acme platform.',
              branch: 'main',
            },
          ],
        },
      }),
    });
    const { unmount } = render(<App />);
    navigate('#/repositories/acme-demo/acme-internal/search?q=search%20flow');

    expect(await screen.findByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.getByText('Search flow experiments for the Acme platform.')).toBeInTheDocument();
    // The signed-in username is visible before opening the repository entry.
    expect(screen.getAllByText('alice-dev').length).toBeGreaterThan(0);

    // Reopening the visible destination keeps the successful result.
    unmount();
    navigate('#/repositories/acme-demo/acme-internal/search?q=search%20flow');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'README.md' })).toBeInTheDocument();
  });
});
