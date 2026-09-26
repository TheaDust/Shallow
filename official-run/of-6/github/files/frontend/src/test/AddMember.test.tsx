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

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-2-2-3 Directly Add a User as an Organization Member', () => {
  /**
   * Routes the People page as an organization Owner with a mutable member
   * list. The POST handler mirrors the server contract: unknown accounts get
   * "Account not found", existing members get "Account is already a member".
   */
  function peopleRoutes(options: {
    sessionUser?: { username: string; email: string };
    role?: string | null;
    members?: { username: string; role: 'owner' | 'member' }[];
  }) {
    const state = {
      members: options.members
        ? [...options.members]
        : [
            { username: 'alice-dev', role: 'owner' as const },
            { username: 'bob-reviewer', role: 'member' as const },
          ],
    };
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: {
          authenticated: true,
          username: options.sessionUser?.username ?? 'alice-dev',
          email: options.sessionUser?.email ?? 'alice.dev@example.test',
        },
      }),
      '/api/organizations/acme-demo': () => ({
        status: 200,
        body: {
          ok: true,
          organization: org,
          role: options.role === undefined ? 'owner' : options.role,
        },
      }),
      'GET /api/organizations/acme-demo/people': () => ({
        status: 200,
        body: { ok: true, members: [...state.members] },
      }),
      'POST /api/organizations/acme-demo/people': (init) => {
        const payload = JSON.parse(String(init?.body));
        const identifier = String(payload.identifier ?? '').trim();
        const role = String(payload.role ?? '');
        if (identifier === 'unknown-reviewer') {
          return {
            status: 400,
            body: { ok: false, errors: { identifier: 'Account not found' } },
          };
        }
        if (state.members.some((m) => m.username === identifier)) {
          return {
            status: 400,
            body: { ok: false, errors: { identifier: 'Account is already a member' } },
          };
        }
        const member = { username: identifier, role: role === 'owner' ? ('owner' as const) : ('member' as const) };
        state.members.push(member);
        return { status: 201, body: { ok: true, member } };
      },
    });
    return state;
  }

  it('Add member opens the Username or email field, the Role combobox and the submit button after the opener', async () => {
    const user = userEvent.setup();
    peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'acme-demo' })).toBeInTheDocument();
    const openButton = await screen.findByRole('button', { name: 'Add member' });
    await user.click(openButton);

    // The labeled field and the Role combobox (defaulting to Member) are open.
    const identifierField = screen.getByLabelText('Username or email');
    expect(identifierField).toBeInTheDocument();
    const roleCombobox = screen.getByRole('combobox', { name: 'Role' });
    expect(roleCombobox).toHaveValue('member');
    expect(screen.getByRole('option', { name: 'Member' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Owner' })).toBeInTheDocument();

    // The opening button remains present; the submit button follows it in
    // page order (two "Add member" buttons, submit after the opener).
    const buttons = screen.getAllByRole('button', { name: 'Add member' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('type')).toBe('button');
    expect(buttons[1].getAttribute('type')).toBe('submit');
  });

  it('adding a nonmember by username with the default Member role shows the full username and role', async () => {
    const user = userEvent.setup();
    const state = peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add member' }));
    await user.type(await screen.findByLabelText('Username or email'), 'carol-dev');
    // Default role is Member; submit is the second "Add member" button.
    await user.click(screen.getAllByRole('button', { name: 'Add member' })[1]);

    // The successful People list displays the full username and Member role.
    const carolItem = await screen.findByText('carol-dev');
    expect(carolItem).toBeInTheDocument();
    expect(state.members.some((m) => m.username === 'carol-dev' && m.role === 'member')).toBe(true);
    // The member appears exactly once and the form closed (one button again).
    expect(screen.getAllByText('carol-dev')).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Add member' })).toHaveLength(1)
    );
  });

  it('selecting Owner and adding stores the Owner role in the People list', async () => {
    const user = userEvent.setup();
    const state = peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add member' }));
    await user.type(await screen.findByLabelText('Username or email'), 'dave-dev');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'owner');
    await user.click(screen.getAllByRole('button', { name: 'Add member' })[1]);

    expect(await screen.findByText('dave-dev')).toBeInTheDocument();
    expect(state.members.some((m) => m.username === 'dave-dev' && m.role === 'owner')).toBe(true);
    const ownerLabels = screen.getAllByText('Owner');
    expect(ownerLabels.length).toBeGreaterThan(0);
  });

  it('an existing member is rejected with the exact message, keeps the form open and appears once', async () => {
    const user = userEvent.setup();
    peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add member' }));
    await user.type(await screen.findByLabelText('Username or email'), 'bob-reviewer');
    await user.click(screen.getAllByRole('button', { name: 'Add member' })[1]);

    expect(await screen.findByText('Account is already a member')).toBeInTheDocument();
    // The form stays open so the username can be corrected and resubmitted.
    expect(screen.getByLabelText('Username or email')).toHaveValue('bob-reviewer');
    expect(screen.getAllByRole('button', { name: 'Add member' })).toHaveLength(2);
    // bob-reviewer's complete username appears only once in the People list.
    expect(screen.getAllByText('bob-reviewer')).toHaveLength(1);
  });

  it('the unknown username unknown-reviewer shows Account not found and the form stays open', async () => {
    const user = userEvent.setup();
    peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add member' }));
    await user.type(await screen.findByLabelText('Username or email'), 'unknown-reviewer');
    await user.click(screen.getAllByRole('button', { name: 'Add member' })[1]);

    expect(await screen.findByText('Account not found')).toBeInTheDocument();
    expect(screen.getByLabelText('Username or email')).toHaveValue('unknown-reviewer');
    expect(screen.getAllByRole('button', { name: 'Add member' })).toHaveLength(2);
    expect(screen.queryByText('unknown-reviewer')).not.toBeInTheDocument();
  });

  it('after reload the added member row remains (persisted)', async () => {
    const user = userEvent.setup();
    peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add member' }));
    await user.type(await screen.findByLabelText('Username or email'), 'carol-dev');
    await user.click(screen.getAllByRole('button', { name: 'Add member' })[1]);
    await screen.findByText('carol-dev');

    // Leave the People page and reopen it: the row is still there.
    navigate('#/organizations/acme-demo');
    await screen.findByRole('link', { name: 'Repositories' });
    navigate('#/organizations/acme-demo/people');
    expect(await screen.findByText('carol-dev')).toBeInTheDocument();
    expect(screen.getAllByText('carol-dev')).toHaveLength(1);
  });

  it('a non-Owner member sees the People list without an Add member control', async () => {
    peopleRoutes({
      sessionUser: { username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      role: 'member',
    });
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    expect(await screen.findByText('alice-dev')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
  });
});
