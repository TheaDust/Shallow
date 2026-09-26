import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const MAIN_README =
  '# acme-docs\n\nDocumentation for the Acme platform.\n\n## Search flow\n';

let defaultBranch: string;

const acmeDocsOverview = () => ({
  status: 200,
  body: {
    ok: true,
    repository: {
      owner: 'acme-demo',
      ownerType: 'organization',
      name: 'acme-docs',
      description: 'Documentation for the Acme platform',
      visibility: 'public',
      defaultBranch,
      updatedAt: '2026-01-10T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      role: 'admin',
    },
  },
});

const branchNames = () => ['main', 'feature-search', 'release'];

const branchesPayload = () => ({
  status: 200,
  body: {
    ok: true,
    defaultBranch,
    canCreate: true,
    branches: branchNames().map((name, index) => ({
      name,
      headCommitId: `c${index + 1}`,
    })),
  },
});

const contentsPayload = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: defaultBranch, headCommitId: 'c2' },
    files: [{ path: 'README.md', content: MAIN_README }],
    entries: [{ name: 'README.md', type: 'file', path: 'README.md' }],
  },
});

const commitsPayload = () => ({
  status: 200,
  body: {
    ok: true,
    commits: [
      { id: 'c2', message: 'Document search flow', author: 'alice-dev', createdAt: '2026-01-05T00:00:00.000Z' },
      { id: 'c1', message: 'Initial commit', author: 'alice-dev', createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  },
});

function adminRoutes(patchSpy?: (init?: RequestInit) => void) {
  const routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }> = {
    '/api/auth/session': () => ({
      status: 200,
      body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
    }),
    '/api/repositories/acme-demo/acme-docs': acmeDocsOverview,
    '/api/repositories/acme-demo/acme-docs/contents': contentsPayload,
    '/api/repositories/acme-demo/acme-docs/commits': commitsPayload,
    '/api/repositories/acme-demo/acme-docs/branches': branchesPayload,
    'PATCH /api/repositories/acme-demo/acme-docs/default-branch': (init) => {
      patchSpy?.(init);
      const body = JSON.parse(String(init?.body));
      defaultBranch = body.branch;
      return { status: 200, body: { ok: true, repository: acmeDocsOverview().body.repository } };
    },
  };
  return routes;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  defaultBranch = 'main';
  window.location.hash = '';
});

describe('REQ-4-3-3 Change the Repository Default Branch', () => {
  it('scenario 1: an Admin changes the default branch through Settings → Branches and the overview then opens release', async () => {
    const user = userEvent.setup();
    const patchSpy = vi.fn();
    mockFetch(adminRoutes(patchSpy));

    // The Admin opens the repository overview; main is the current default.
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);
    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    expect(screen.getByRole('button', { name: 'Branch main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();

    // Settings → Branches (unique links on their respective pages).
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Branches' })).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/settings/branches'
    );
    await user.click(screen.getByRole('link', { name: 'Branches' }));

    // The Branches page exposes a native select (combobox) labeled "Default
    // branch" whose options are the exact existing branch names.
    expect(await screen.findByRole('heading', { name: 'Branches' })).toBeInTheDocument();
    const combobox = screen.getByRole('combobox', { name: 'Default branch' });
    expect(combobox).toHaveValue('main');
    for (const name of branchNames()) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();

    // Select release, activate Update, then Confirm in the confirmation
    // dialog (native selection behavior).
    await user.selectOptions(combobox, 'release');
    expect(combobox).toHaveValue('release');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    const dialog = await screen.findByRole('dialog', { name: 'Change default branch' });
    expect(within(dialog).getByText(/from main to release/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    // The change is saved (operator and time stored server-side), the dialog
    // closes, and the page shows the success status.
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(patchSpy.mock.calls[0][0]?.body))).toEqual({
      branch: 'release',
    });
    expect(await screen.findByText('Default branch updated')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Default branch' })).toHaveValue('release');

    // Newly opening the repository overview shows the new default branch in
    // the selector while the old default branch stays available as an option.
    navigate('#/repositories/acme-demo/acme-docs');
    expect(
      await screen.findByRole('button', { name: 'Branch release' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Branch release' }));
    await screen.findByRole('textbox', { name: 'Find branch' });
    expect(screen.getByRole('option', { name: 'main' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('option', { name: 'release' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('option', { name: 'feature-search' })).toBeInTheDocument();
  });

  it('scenario 1 THEN: after refreshing the settings page the default branch is still release', async () => {
    const user = userEvent.setup();
    const patchSpy = vi.fn();
    mockFetch(adminRoutes(patchSpy));

    navigate('#/repositories/acme-demo/acme-docs/settings/branches');
    render(<App />);
    await screen.findByRole('heading', { name: 'Branches' });
    const combobox = screen.getByRole('combobox', { name: 'Default branch' });
    expect(combobox).toHaveValue('main');

    await user.selectOptions(combobox, 'release');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    await user.click(
      await screen.findByRole('button', { name: 'Confirm' })
    );
    await screen.findByText('Default branch updated');

    // Refreshing / reopening the settings page keeps the persisted value and
    // only existing branches are offered.
    navigate('#/repositories/acme-demo/acme-docs/settings/branches');
    expect(await screen.findByRole('heading', { name: 'Branches' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Default branch' })).toHaveValue('release');
    const options = screen
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options.sort()).toEqual(['feature-search', 'main', 'release']);
  });

  it('scenario 2: a non-Admin never sees the Default branch combobox or the update button', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
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
      '/api/repositories/acme-demo/acme-docs/contents': () => ({
        status: 200,
        body: { ok: true, branch: { name: 'main', headCommitId: 'c2' }, files: [], entries: [] },
      }),
      '/api/repositories/acme-demo/acme-docs/commits': () => ({
        status: 200,
        body: { ok: true, commits: [] },
      }),
      '/api/repositories/acme-demo/acme-docs/branches': () => ({
        status: 200,
        body: { ok: true, defaultBranch: 'main', canCreate: false, branches: [] },
      }),
    });

    // The Read collaborator sees no Settings link on the overview.
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);
    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();

    // Opening the Branches page directly shows Access denied and never the
    // Default branch combobox or the default-branch Update button (a merely
    // disabled selector is insufficient).
    navigate('#/repositories/acme-demo/acme-docs/settings/branches');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Default branch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Branches' })).not.toBeInTheDocument();
  });
});
