import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  { name: 'frontend-team', description: 'Frontend engineering team', parentTeamName: null },
];

function mobileTeamDetail(parentTeamName: string | null) {
  return {
    name: 'mobile-team',
    description: 'Mobile engineering team',
    parentTeamName,
    creator: 'alice-dev',
    createdAt: '2026-02-01T00:00:00.000Z',
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

describe('REQ-2-2-1 Create an Organization Team', () => {
  beforeEach(() => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/organizations/acme-demo': () => ({
        status: 200,
        body: { ok: true, organization: org, role: 'owner' },
      }),
      '/api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
      'POST /api/organizations/acme-demo/teams': (init) => {
        const payload = JSON.parse(String(init?.body));
        if (payload.name === '-invalid-team') {
          return { status: 400, body: { ok: false, errors: { name: 'Team name format is invalid' } } };
        }
        if (payload.name === 'frontend-team') {
          return { status: 400, body: { ok: false, errors: { name: 'Team name already exists' } } };
        }
        return {
          status: 201,
          body: {
            ok: true,
            team: {
              name: payload.name,
              description: payload.description ?? '',
              parentTeamName: payload.parentTeamName || null,
              createdAt: '2026-02-01T00:00:00.000Z',
            },
          },
        };
      },
      'GET /api/organizations/acme-demo/teams/mobile-team': () => ({
        status: 200,
        body: { ok: true, team: mobileTeamDetail('frontend-team') },
      }),
      'GET /api/organizations/acme-demo/teams/mobile-team/members': () => ({
        status: 200,
        body: { ok: true, members: [] },
      }),
    });
  });

  it('the Teams tab shows New team to the Owner and links teams to their pages', async () => {
    navigate('#/organizations/acme-demo/teams');
    render(<App />);

    const newTeam = await screen.findByRole('link', { name: 'New team' });
    expect(newTeam).toHaveAttribute('href', '#/organizations/acme-demo/teams/new');

    const frontendTeam = screen.getByRole('link', { name: 'frontend-team' });
    expect(frontendTeam).toHaveAttribute(
      'href',
      '#/organizations/acme-demo/teams/frontend-team'
    );
    // The team tree shows the owning organization next to the heading.
    expect(screen.getAllByText('acme-demo').length).toBeGreaterThan(1);
  });

  it('a plain member does not see the New team link', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/organizations/acme-demo': () => ({
        status: 200,
        body: { ok: true, organization: org, role: 'member' },
      }),
      '/api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
    });
    navigate('#/organizations/acme-demo/teams');
    render(<App />);

    await screen.findByRole('link', { name: 'frontend-team' });
    expect(screen.queryByRole('link', { name: 'New team' })).not.toBeInTheDocument();
  });

  it('a non-owner opening the create page directly sees Access denied', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      }),
      '/api/organizations/acme-demo': () => ({
        status: 200,
        body: { ok: true, organization: org, role: 'member' },
      }),
      '/api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
    });
    navigate('#/organizations/acme-demo/teams/new');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });

  it('the create page shows the Team name, Description and Parent team fields with Create team', async () => {
    navigate('#/organizations/acme-demo/teams/new');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'New team' })).toBeInTheDocument();
    expect(screen.getByLabelText('Team name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    const parentSelect = screen.getByLabelText('Parent team');
    expect(parentSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'frontend-team' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create team' })).toBeInTheDocument();
  });

  it('a malformed team name displays "Team name format is invalid" and creates nothing', async () => {
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo/teams/new');
    render(<App />);

    await user.type(await screen.findByLabelText('Team name'), '-invalid-team');
    await user.click(screen.getByRole('button', { name: 'Create team' }));

    expect(await screen.findByText('Team name format is invalid')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/organizations/acme-demo/teams/new');
  });

  it('a duplicated team name displays "Team name already exists" and stays on the page', async () => {
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo/teams/new');
    render(<App />);

    await user.type(await screen.findByLabelText('Team name'), 'frontend-team');
    await user.click(screen.getByRole('button', { name: 'Create team' }));

    expect(await screen.findByText('Team name already exists')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/organizations/acme-demo/teams/new');
  });

  it('creating a team redirects to the team page titled organization name/team name with the tree', async () => {
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo/teams/new');
    render(<App />);

    await user.type(await screen.findByLabelText('Team name'), 'mobile-team');
    await user.selectOptions(screen.getByLabelText('Parent team'), 'frontend-team');
    await user.click(screen.getByRole('button', { name: 'Create team' }));

    expect(await screen.findByRole('heading', { name: 'acme-demo/mobile-team' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/organizations/acme-demo/teams/mobile-team');
    // The team tree displays the organization and the selected parent team.
    expect(screen.getByText('acme-demo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'frontend-team' })).toBeInTheDocument();
  });
});

describe('REQ-2-2-1 team page tabs', () => {
  function teamPageRoutes(patchHandler: () => { status: number; body: unknown }) {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/organizations/acme-demo': () => ({
        status: 200,
        body: { ok: true, organization: org, role: 'owner' },
      }),
      '/api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
      'GET /api/organizations/acme-demo/teams/mobile-team': () => ({
        status: 200,
        body: { ok: true, team: mobileTeamDetail('frontend-team') },
      }),
      'GET /api/organizations/acme-demo/teams/mobile-team/members': () => ({
        status: 200,
        body: { ok: true, members: [{ username: 'bob-reviewer' }] },
      }),
      'PATCH /api/organizations/acme-demo/teams/mobile-team': patchHandler,
    });
  }

  beforeEach(() => {
    teamPageRoutes(() => ({
      status: 200,
      body: {
        ok: true,
        team: {
          name: 'mobile-team',
          description: 'Mobile engineering team',
          parentTeamName: 'frontend-team',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      },
    }));
  });

  it('the Members tab lists the team direct members and the tabs link to Members/Settings', async () => {
    navigate('#/organizations/acme-demo/teams/mobile-team');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'acme-demo/mobile-team' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '#/organizations/acme-demo/teams/mobile-team'
    );
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '#/organizations/acme-demo/teams/mobile-team/settings'
    );
    expect(await screen.findByText('bob-reviewer')).toBeInTheDocument();
  });

  it('Settings shows the Parent team select with team-name options and saves', async () => {
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo/teams/mobile-team/settings');
    render(<App />);

    const select = await screen.findByLabelText('Parent team');
    expect(select).toHaveValue('frontend-team');
    expect(screen.getByRole('option', { name: 'frontend-team' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'No parent' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Parent team updated')).toBeInTheDocument();
  });

  it('a rejected parent change shows the cycle error and keeps the original parent selected', async () => {
    teamPageRoutes(() => ({
      status: 400,
      body: { ok: false, errors: { parentTeam: 'Cyclic team hierarchy is not allowed' } },
    }));
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo/teams/mobile-team/settings');
    render(<App />);

    const select = await screen.findByLabelText('Parent team');
    await user.selectOptions(select, 'frontend-team');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Cyclic team hierarchy is not allowed')).toBeInTheDocument();
    expect(select).toHaveValue('frontend-team');
  });
});
