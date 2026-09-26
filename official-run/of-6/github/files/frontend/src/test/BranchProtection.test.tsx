import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

let rules: {
  branchName: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
  updatedAt: string;
}[];

const overviewBody = (role: string) => ({
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
      role,
    },
  },
});

function adminRoutes() {
  return {
    '/api/auth/session': () => ({
      status: 200,
      body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
    }),
    '/api/repositories/acme-demo/acme-docs': () => overviewBody('admin'),
    '/api/repositories/acme-demo/acme-docs/contents': () => ({
      status: 200,
      body: {
        ok: true,
        branch: { name: 'main', headCommitId: 'c2' },
        files: [{ path: 'README.md', content: '# acme-docs' }],
        entries: [{ name: 'README.md', type: 'file', path: 'README.md' }],
      },
    }),
    '/api/repositories/acme-demo/acme-docs/commits': () => ({
      status: 200,
      body: { ok: true, commits: [] },
    }),
    '/api/repositories/acme-demo/acme-docs/branches': () => ({
      status: 200,
      body: {
        ok: true,
        defaultBranch: 'main',
        canCreate: true,
        branches: [
          { name: 'main', headCommitId: 'c2' },
          { name: 'feature-search', headCommitId: 'c1' },
        ],
      },
    }),
    '/api/repositories/acme-demo/acme-docs/branch-protection': () => ({
      status: 200,
      body: { ok: true, rules },
    }),
    'POST /api/repositories/acme-demo/acme-docs/branch-protection': (init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      rules = [
        {
          branchName: body.branchName,
          requireApproval: body.requireApproval === true,
          requireStatusCheck: body.requireStatusCheck === true,
          updatedAt: '2026-01-22T00:00:00.000Z',
        },
      ];
      return { status: 201, body: { ok: true, rules } };
    },
    'PATCH /api/repositories/acme-demo/acme-docs/branch-protection/main': (init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      rules = rules.map((rule) => ({
        ...rule,
        requireApproval: body.requireApproval === true,
        requireStatusCheck: body.requireStatusCheck === true,
        updatedAt: '2026-01-22T00:00:00.000Z',
      }));
      return { status: 200, body: { ok: true, rules } };
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  rules = [];
  window.location.hash = '';
});

describe('REQ-6-1 Protect Branches with Review and Status-Check Requirements', () => {
  it('scenario 1: an Admin creates a branch protection rule for main with both requirements', async () => {
    const user = userEvent.setup();
    mockFetch(adminRoutes());

    navigate('#/repositories/acme-demo/acme-docs/settings/branches');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Branches' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Default branch' })).toBeInTheDocument();
    // Initially no rule exists.
    expect(screen.getByText('No branch protection rules.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add branch protection rule' }));
    const pattern = screen.getByRole('textbox', { name: 'Branch name pattern' });
    await user.type(pattern, 'main');
    await user.click(screen.getByRole('checkbox', { name: 'Require 1 approval' }));
    await user.click(screen.getByRole('checkbox', { name: 'Require status check test' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    // The settings page displays exactly one rule for main with both
    // requirements (branch name verbatim + the summaries).
    expect(
      await screen.findByText('main', { selector: '.branch-protection-rule-name' })
    ).toBeInTheDocument();
    expect(screen.getByText('1 approval')).toBeInTheDocument();
    expect(screen.getByText('Require status check test')).toBeInTheDocument();
    expect(screen.queryByText('No branch protection rules.')).not.toBeInTheDocument();

    // After refreshing the settings page the rule still exists.
    navigate('#/repositories/acme-demo/acme-docs/settings/branches');
    expect(
      await screen.findByText('main', { selector: '.branch-protection-rule-name' })
    ).toBeInTheDocument();
    expect(screen.getByText('1 approval')).toBeInTheDocument();
    expect(screen.getByText('Require status check test')).toBeInTheDocument();

    // An existing rule uses Save changes: re-entering the branch name changes
    // the submit button label.
    await user.click(screen.getByRole('button', { name: 'Add branch protection rule' }));
    const reopened = screen.getByRole('textbox', { name: 'Branch name pattern' });
    await user.type(reopened, 'main');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  });

  it('scenario 2: a non-Admin never sees the Add branch protection rule entry and no rule is saved', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs': () => overviewBody('read'),
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
      '/api/repositories/acme-demo/acme-docs/branch-protection': () => ({
        status: 403,
        body: { error: 'Access denied' },
      }),
    });

    // The readable non-Admin account opens the branch-protection settings
    // page: branch-protection controls are unavailable (no savable
    // rule-editing entry) and no protection rule is saved.
    navigate('#/repositories/acme-demo/acme-docs/settings/branches');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add branch protection rule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Branch name pattern' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(rules).toEqual([]);
  });
});
