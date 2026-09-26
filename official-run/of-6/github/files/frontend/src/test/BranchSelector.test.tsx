import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

const MAIN_README =
  '# acme-docs\n\nDocumentation for the Acme platform.\n\n## Search flow\n';
const FEATURE_README = '# acme-docs\n\nDocumentation for the Acme platform.\n';
const MAIN_ONLY_CONTENT =
  '# main-only\n\nThis file only exists on the feature-search branch.\n';

const branchesPayload = () => ({
  status: 200,
  body: {
    ok: true,
    defaultBranch: 'main',
    branches: [
      { name: 'main', headCommitId: 'c2' },
      { name: 'feature-search', headCommitId: 'c3' },
    ],
  },
});

const rootContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c2' },
    files: [
      { path: 'README.md', content: MAIN_README },
      { path: 'src/search.ts', content: '// Search flow\n' },
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

const treeFeatureSearch = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'feature-search', headCommitId: 'c3' },
    path: '',
    entries: [
      { name: 'README.md', type: 'file', path: 'README.md' },
      { name: 'main-only.md', type: 'file', path: 'main-only.md' },
    ],
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

function mockBranchRoutes() {
  mockFetch({
    '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    '/api/repositories/acme-demo/acme-docs': () => ({
      status: 200,
      body: { ok: true, repository: acmeDocsOverview },
    }),
    '/api/repositories/acme-demo/acme-docs/contents': rootContents,
    '/api/repositories/acme-demo/acme-docs/commits': acmeDocsCommits,
    '/api/repositories/acme-demo/acme-docs/branches': branchesPayload,
    '/api/repositories/acme-demo/acme-docs/tree/main': treeMain,
    '/api/repositories/acme-demo/acme-docs/tree/feature-search': treeFeatureSearch,
    '/api/repositories/acme-demo/acme-docs/contents/main/README.md': () => ({
      status: 200,
      body: {
        ok: true,
        branch: 'main',
        file: { path: 'README.md', content: MAIN_README },
        commit: { id: 'c2', message: 'Document search flow', author: 'alice-dev', createdAt: '2026-01-05T00:00:00.000Z' },
      },
    }),
    '/api/repositories/acme-demo/acme-docs/contents/feature-search/README.md': () => ({
      status: 200,
      body: {
        ok: true,
        branch: 'feature-search',
        file: { path: 'README.md', content: FEATURE_README },
        commit: { id: 'c3', message: 'Add main-only.md', author: 'alice-dev', createdAt: '2026-01-04T00:00:00.000Z' },
      },
    }),
    '/api/repositories/acme-demo/acme-docs/contents/feature-search/main-only.md': () => ({
      status: 200,
      body: {
        ok: true,
        branch: 'feature-search',
        file: { path: 'main-only.md', content: MAIN_ONLY_CONTENT },
        commit: { id: 'c3', message: 'Add main-only.md', author: 'alice-dev', createdAt: '2026-01-04T00:00:00.000Z' },
      },
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-4-3-1 List and Switch Repository Branches (visitor)', () => {
  beforeEach(() => {
    mockBranchRoutes();
  });

  it('scenario 1: the branch selector lists both branches, marks the current one, and switching to feature-search updates the page and file list', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    // The selector is the unique button named "Branch <current branch name>".
    const trigger = screen.getByRole('button', { name: 'Branch main' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    // It opens a textbox named "Find branch" and selectable options whose
    // exact accessible names are the branch names; the current branch is
    // marked.
    expect(screen.getByRole('textbox', { name: 'Find branch' })).toBeInTheDocument();
    const mainOption = await screen.findByRole('option', { name: 'main' });
    expect(mainOption).toHaveAttribute('aria-selected', 'true');
    const featureOption = screen.getByRole('option', { name: 'feature-search' });
    expect(featureOption).toHaveAttribute('aria-selected', 'false');

    // Typing filters the options live (no Enter/search button required).
    await user.type(screen.getByRole('textbox', { name: 'Find branch' }), 'feature-search');
    expect(screen.getByRole('option', { name: 'feature-search' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'main' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'feature-search' }));

    // The page, branch selector and file list all switch to feature-search:
    // the URL carries the branch, the button shows the new name, and the
    // target-only file name is a link.
    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/repositories/acme-demo/acme-docs/tree/feature-search'
      )
    );
    expect(
      await screen.findByRole('button', { name: 'Branch feature-search' })
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'main-only.md' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();

    // The target-only file is a working link with the saved content.
    await user.click(screen.getByRole('link', { name: 'main-only.md' }));
    await waitFor(() =>
      expect(document.querySelector('.file-content')?.textContent).toBe(
        MAIN_ONLY_CONTENT
      )
    );
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/blob/feature-search/main-only.md'
    );

    // Reopening the selector lists both branches and marks feature-search as
    // the current branch.
    navigate('#/repositories/acme-demo/acme-docs/tree/feature-search');
    await user.click(await screen.findByRole('button', { name: 'Branch feature-search' }));
    await screen.findByRole('textbox', { name: 'Find branch' });
    expect(screen.getByRole('option', { name: 'main' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('option', { name: 'feature-search' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // The known file displays the content from that branch.
    await user.click(screen.getByRole('option', { name: 'feature-search' }));
    await user.click(await screen.findByRole('link', { name: 'README.md' }));
    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/repositories/acme-demo/acme-docs/blob/feature-search/README.md'
      )
    );
    await waitFor(() =>
      expect(document.querySelector('.file-content')?.textContent).toBe(FEATURE_README)
    );

    // Selecting main again restores its file content.
    navigate('#/repositories/acme-demo/acme-docs/tree/feature-search');
    await user.click(await screen.findByRole('button', { name: 'Branch feature-search' }));
    await screen.findByRole('textbox', { name: 'Find branch' });
    await user.type(screen.getByRole('textbox', { name: 'Find branch' }), 'main');
    await user.click(screen.getByRole('option', { name: 'main' }));
    await waitFor(() =>
      expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/tree/main')
    );
    expect(
      await screen.findByRole('button', { name: 'Branch main' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'main-only.md' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'README.md' }));
    await waitFor(() =>
      expect(document.querySelector('.file-content')?.textContent).toBe(MAIN_README)
    );
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/blob/main/README.md'
    );
  });

  it('scenario 1 reload: the selected branch survives a reload because it is read from the page entry', async () => {
    window.location.hash = '#/repositories/acme-demo/acme-docs/tree/feature-search';
    const { unmount } = render(<App />);

    expect(
      await screen.findByRole('button', { name: 'Branch feature-search' })
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'main-only.md' })).toBeInTheDocument();

    unmount();
    window.location.hash = '#/repositories/acme-demo/acme-docs/tree/feature-search';
    render(<App />);

    expect(
      await screen.findByRole('button', { name: 'Branch feature-search' })
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'main-only.md' })).toBeInTheDocument();
  });

  it('scenario 2: an unmatched branch query shows "No matching branch" and retains the active branch after Escape and reload', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    const { unmount } = render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    const trigger = screen.getByRole('button', { name: 'Branch main' });
    await user.click(trigger);

    const input = await screen.findByRole('textbox', { name: 'Find branch' });
    await user.type(input, 'no-such-branch');

    // Empty branch-search state: no options and the exact state text.
    expect(screen.getByText('No matching branch')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    // Escape closes the selector; the original active branch is retained.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Find branch' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Branch main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();

    // Reloading keeps the original active branch (the URL never changed).
    unmount();
    window.location.hash = '#/repositories/acme-demo/acme-docs';
    render(<App />);
    expect(
      await screen.findByRole('button', { name: 'Branch main' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'main-only.md' })).not.toBeInTheDocument();
  });
});
