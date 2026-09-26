import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type { RepoAccessGrant } from '../types';

const repo = (role: string | null, visibility = 'public') => ({
  ok: true,
  repository: {
    owner: 'acme-demo',
    ownerType: 'organization',
    name: 'acme-docs',
    description: 'Documentation for the Acme platform',
    visibility,
    defaultBranch: 'main',
    updatedAt: '2026-01-10T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    role,
  },
});

function repoResponse(role: string | null, visibility = 'public') {
  return { status: 200, body: repo(role, visibility) };
}

const people = [
  { username: 'alice-dev', role: 'owner' },
  { username: 'bob-reviewer', role: 'member' },
];

const teams = [{ name: 'frontend-team', description: 'Frontend engineering team', parentTeamName: 'platform-team' }];

function grant(subjectType: 'user' | 'team', subjectName: string, role: string): RepoAccessGrant {
  return {
    subjectType,
    subjectName,
    role: role as RepoAccessGrant['role'],
    grantedBy: 'alice-dev',
    updatedAt: '2026-01-20T00:00:00.000Z',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-2-3 Grant Repository Access to People and Teams', () => {
  it('the repository overview shows the Settings link to an Admin and hides it from a Read collaborator', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs': () => repoResponse('admin'),
    });
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    const settingsLink = await screen.findByRole('link', { name: 'Settings' });
    expect(settingsLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/settings'
    );
  });

  it('a plain Read collaborator does not see the Settings link', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs': () => repoResponse('read'),
    });
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('the repository Settings page provides the Manage access link', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs': () => repoResponse('admin'),
    });
    navigate('#/repositories/acme-demo/acme-docs/settings');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('acme-demo/acme-docs')).toBeInTheDocument();
    const manageAccess = screen.getByRole('link', { name: 'Manage access' });
    expect(manageAccess).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/settings/access'
    );
  });

  it('a non-admin opening the settings page directly sees Access denied', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs': () => repoResponse('read'),
    });
    navigate('#/repositories/acme-demo/acme-docs/settings');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });

  it('the Manage access page opens the picker: Add people or teams is hidden while the picker is active', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs': () => repoResponse('admin'),
      'GET /api/repositories/acme-demo/acme-docs/access': () => ({
        status: 200,
        body: { ok: true, grants: [] },
      }),
      '/api/organizations/acme-demo/people': () => ({ status: 200, body: { ok: true, members: people } }),
      '/api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
    });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/settings/access');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Manage access' })).toBeInTheDocument();
    const openButton = screen.getByRole('button', { name: 'Add people or teams' });
    await user.click(openButton);

    // The opening button is hidden while the picker is active so the submit
    // action (Add) is unambiguous.
    expect(screen.queryByRole('button', { name: 'Add people or teams' })).not.toBeInTheDocument();
    const search = screen.getByRole('textbox', { name: 'Search' });
    expect(search).toBeInTheDocument();
    // Matching selectable member and team options whose names contain the query.
    expect(screen.getByRole('radio', { name: 'bob-reviewer' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'frontend-team' })).toBeInTheDocument();
    const role = screen.getByRole('combobox', { name: 'Role' });
    expect(role).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Write' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Read' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Triage' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Maintain' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('the subject options update as the administrator types without submitting', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs': () => repoResponse('admin'),
      'GET /api/repositories/acme-demo/acme-docs/access': () => ({
        status: 200,
        body: { ok: true, grants: [] },
      }),
      '/api/organizations/acme-demo/people': () => ({ status: 200, body: { ok: true, members: people } }),
      '/api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
    });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/settings/access');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add people or teams' }));
    const search = screen.getByRole('textbox', { name: 'Search' });
    await user.type(search, 'frontend');

    // The matching team option remains, the non-matching member is filtered out.
    expect(screen.getByRole('radio', { name: 'frontend-team' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'bob-reviewer' })).not.toBeInTheDocument();
  });

  it('adding a team with the Write role shows exactly one row and retains it after reload', async () => {
    let grants: RepoAccessGrant[] = [];
    const postSpy = vi.fn();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs': () => repoResponse('admin'),
      'GET /api/repositories/acme-demo/acme-docs/access': () => ({
        status: 200,
        body: { ok: true, grants },
      }),
      'POST /api/repositories/acme-demo/acme-docs/access': (init) => {
        postSpy(init);
        const payload = JSON.parse(String(init?.body));
        grants = [
          grant(payload.subjectType, payload.subjectName, payload.role),
          ...grants.filter(
            (g) => !(g.subjectType === payload.subjectType && g.subjectName === payload.subjectName)
          ),
        ];
        return { status: 201, body: { ok: true, grants } };
      },
      '/api/organizations/acme-demo/people': () => ({ status: 200, body: { ok: true, members: people } }),
      '/api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
    });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/settings/access');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add people or teams' }));
    await user.click(screen.getByRole('radio', { name: 'frontend-team' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'write');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(postSpy).toHaveBeenCalledTimes(1);
    const row = await screen.findByRole('row', { name: /frontend-team/ });
    expect(within(row).getByLabelText('Role')).toHaveValue('write');
    // The picker closed and the opening button is back.
    expect(screen.getByRole('button', { name: 'Add people or teams' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Search' })).not.toBeInTheDocument();

    // After reload the grant is still there (server-persisted list).
    navigate('#/repositories/acme-demo/acme-docs');
    await user.click(await screen.findByRole('link', { name: 'Settings' }));
    await user.click(await screen.findByRole('link', { name: 'Manage access' }));
    const reloadedRow = await screen.findByRole('row', { name: /frontend-team/ });
    expect(within(reloadedRow).getByLabelText('Role')).toHaveValue('write');
  });

  it('selecting Read and saving replaces Write; exactly one row remains', async () => {
    let grants: RepoAccessGrant[] = [grant('team', 'frontend-team', 'write')];
    const patchSpy = vi.fn();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/acme-demo/acme-docs': () => repoResponse('admin'),
      'GET /api/repositories/acme-demo/acme-docs/access': () => ({
        status: 200,
        body: { ok: true, grants },
      }),
      'PATCH /api/repositories/acme-demo/acme-docs/access/team/frontend-team': (init) => {
        patchSpy(init);
        const payload = JSON.parse(String(init?.body));
        grants = [grant('team', 'frontend-team', payload.role)];
        return { status: 200, body: { ok: true, grants } };
      },
      '/api/organizations/acme-demo/people': () => ({ status: 200, body: { ok: true, members: people } }),
      '/api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
    });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/settings/access');
    render(<App />);

    const row = await screen.findByRole('row', { name: /frontend-team/ });
    const roleSelect = within(row).getByLabelText('Role');
    expect(roleSelect).toHaveValue('write');

    await user.selectOptions(roleSelect, 'read');
    await user.click(within(row).getByRole('button', { name: 'Save' }));

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const updated = await screen.findByRole('row', { name: /frontend-team/ });
    expect(within(updated).getByLabelText('Role')).toHaveValue('read');
    // Exactly one row for the team remains.
    expect(screen.getAllByRole('row', { name: /frontend-team/ })).toHaveLength(1);
  });
});
