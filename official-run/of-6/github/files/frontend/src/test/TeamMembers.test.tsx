import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const org = {
  name: 'acme-demo',
  displayName: 'Acme Demo',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const teams = [
  { name: 'platform-team', description: 'Platform engineering team', parentTeamName: null },
  { name: 'frontend-team', description: 'Frontend engineering team', parentTeamName: 'platform-team' },
  { name: 'frontend-core-team', description: 'Frontend core team', parentTeamName: 'frontend-team' },
  { name: 'design-team', description: 'Design and UX team', parentTeamName: null },
];

function frontendTeamDetail(parentTeamName: string | null) {
  return {
    name: 'frontend-team',
    description: 'Frontend engineering team',
    parentTeamName,
    creator: 'alice-dev',
    createdAt: '2026-01-01T00:00:00.000Z',
    ancestorNames: parentTeamName ? [parentTeamName] : [],
    organization: org,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-2-2-2 Manage Organization Team Members and Hierarchy', () => {
  function teamPageRoutes(options: {
    role?: string;
    members?: { username: string }[];
    patchHandler?: (init?: RequestInit) => { status: number; body: unknown };
  }) {
    const state = {
      members: options.members ? [...options.members] : [],
      parentTeam: 'platform-team' as string | null,
    };
    const fetchSpy = mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/organizations/acme-demo': () => ({
        status: 200,
        body: { ok: true, organization: org, role: options.role ?? 'owner' },
      }),
      'GET /api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
      'GET /api/organizations/acme-demo/teams/frontend-team': () => ({
        status: 200,
        body: { ok: true, team: frontendTeamDetail(state.parentTeam) },
      }),
      'GET /api/organizations/acme-demo/teams/frontend-team/members': () => ({
        status: 200,
        body: { ok: true, members: [...state.members] },
      }),
      'POST /api/organizations/acme-demo/teams/frontend-team/members': (init) => {
        const payload = JSON.parse(String(init?.body));
        const username = String(payload.username ?? '').trim();
        if (username === 'not-a-member') {
          return {
            status: 400,
            body: { ok: false, errors: { username: 'User is not a member of this organization' } },
          };
        }
        if (!state.members.some((m) => m.username === username)) {
          state.members.push({ username });
        }
        return { status: 201, body: { ok: true, member: { username } } };
      },
      'DELETE /api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer': () => {
        state.members = state.members.filter((m) => m.username !== 'bob-reviewer');
        return { status: 200, body: { ok: true } };
      },
      'PATCH /api/organizations/acme-demo/teams/frontend-team': (init) => {
        if (options.patchHandler) {
          return options.patchHandler(init);
        }
        const payload = JSON.parse(String(init?.body));
        state.parentTeam = String(payload.parentTeamName ?? '');
        return {
          status: 200,
          body: {
            ok: true,
            team: {
              name: 'frontend-team',
              description: 'Frontend engineering team',
              parentTeamName: state.parentTeam,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          },
        };
      },
    });
    return { state, fetchSpy };
  }

  it('Members shows Add member, which opens the Username field and submit button', async () => {
    const user = userEvent.setup();
    teamPageRoutes({});
    navigate('#/organizations/acme-demo/teams/frontend-team');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'acme-demo/frontend-team' })).toBeInTheDocument();

    // Only one actionable "Add member" button exists before opening.
    const openButton = await screen.findByRole('button', { name: 'Add member' });
    await user.click(openButton);

    const usernameField = screen.getByLabelText('Username');
    expect(usernameField).toBeInTheDocument();
    const submitButton = screen.getByRole('button', { name: 'Add member' });
    expect(submitButton).toBeInTheDocument();
    // The opening button is gone while the form is open: still exactly one
    // "Add member" button (the current step's submit).
    expect(screen.getAllByRole('button', { name: 'Add member' })).toHaveLength(1);
  });

  it('adding a member shows the username once with a Remove <username> button', async () => {
    const user = userEvent.setup();
    teamPageRoutes({});
    navigate('#/organizations/acme-demo/teams/frontend-team');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add member' }));
    await user.type(await screen.findByLabelText('Username'), 'bob-reviewer');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    // The member list displays the account once with its removal button.
    const removeButton = await screen.findByRole('button', { name: 'Remove bob-reviewer' });
    expect(removeButton).toBeInTheDocument();
    const listItems = screen.getAllByText('bob-reviewer');
    expect(listItems).toHaveLength(1);
    // The form closed, so the opening Add member button is back (one match).
    expect(screen.getAllByRole('button', { name: 'Add member' })).toHaveLength(1);
  });

  it('removing a member removes it immediately without confirmation', async () => {
    const user = userEvent.setup();
    const { state, fetchSpy } = teamPageRoutes({ members: [{ username: 'bob-reviewer' }] });
    navigate('#/organizations/acme-demo/teams/frontend-team');
    render(<App />);

    const removeButton = await screen.findByRole('button', { name: 'Remove bob-reviewer' });
    await user.click(removeButton);

    await waitFor(() => {
      expect(screen.queryByText('bob-reviewer')).not.toBeInTheDocument();
    });
    expect(state.members).toEqual([]);
    // The removal was a DELETE request (no other confirmation step).
    expect(
      fetchSpy.mock.calls.some(
        ([input, init]) =>
          String(input).includes('/members/bob-reviewer') && (init?.method ?? 'GET') === 'DELETE'
      )
    ).toBe(true);
  });

  it('a non-organization member is rejected with the field error and the input is kept', async () => {
    const user = userEvent.setup();
    teamPageRoutes({});
    navigate('#/organizations/acme-demo/teams/frontend-team');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add member' }));
    await user.type(await screen.findByLabelText('Username'), 'not-a-member');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    expect(await screen.findByText('User is not a member of this organization')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('not-a-member');
    // The form stays open (the submit Add member button is the current step).
    expect(screen.getAllByRole('button', { name: 'Add member' })).toHaveLength(1);
  });

  it('a plain member sees the member list without Add member or Remove controls', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/organizations/acme-demo': () => ({
        status: 200,
        body: { ok: true, organization: org, role: 'member' },
      }),
      'GET /api/organizations/acme-demo/teams/frontend-team': () => ({
        status: 200,
        body: { ok: true, team: frontendTeamDetail('platform-team') },
      }),
      'GET /api/organizations/acme-demo/teams/frontend-team/members': () => ({
        status: 200,
        body: { ok: true, members: [{ username: 'alice-dev' }] },
      }),
    });
    navigate('#/organizations/acme-demo/teams/frontend-team');
    render(<App />);

    expect(await screen.findByText('alice-dev')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove alice-dev' })).not.toBeInTheDocument();
  });

  it('Settings: a rejected cycle keeps the original parent selected and after reload', async () => {
    const user = userEvent.setup();
    teamPageRoutes({
      patchHandler: () => ({
        status: 400,
        body: { ok: false, errors: { parentTeam: 'Cyclic team hierarchy is not allowed' } },
      }),
    });
    navigate('#/organizations/acme-demo/teams/frontend-team/settings');
    render(<App />);

    const select = await screen.findByLabelText('Parent team');
    expect(select).toHaveValue('platform-team');
    // The descendant team is selectable by name.
    expect(screen.getByRole('option', { name: 'frontend-core-team' })).toBeInTheDocument();

    await user.selectOptions(select, 'frontend-core-team');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Cyclic team hierarchy is not allowed')).toBeInTheDocument();
    expect(select).toHaveValue('platform-team');

    // Reload: the original parent remains selected.
    navigate('#/organizations/acme-demo/teams/frontend-team/members');
    navigate('#/organizations/acme-demo/teams/frontend-team/settings');
    const reloadedSelect = await screen.findByLabelText('Parent team');
    expect(reloadedSelect).toHaveValue('platform-team');
  });

  it('Settings: selecting the candidate parent and saving shows the new hierarchy in the tree', async () => {
    const user = userEvent.setup();
    teamPageRoutes({});
    navigate('#/organizations/acme-demo/teams/frontend-team/settings');
    render(<App />);

    const select = await screen.findByLabelText('Parent team');
    expect(select).toHaveValue('platform-team');
    await user.selectOptions(select, 'design-team');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Parent team updated')).toBeInTheDocument();
    // The team tree now displays the new parent-child relationship.
    expect(screen.getByRole('link', { name: 'design-team' })).toBeInTheDocument();
    expect(screen.getByText('frontend-team')).toBeInTheDocument();
  });
});
