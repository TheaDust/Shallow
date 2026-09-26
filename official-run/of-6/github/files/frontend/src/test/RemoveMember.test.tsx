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

describe('REQ-2-2-4 Remove a Member from an Organization', () => {
  /**
   * Routes the People page with a mutable member list. The DELETE handler
   * mirrors the server contract: it removes the member from the list (or
   * rejects with the given status/message).
   */
  function peopleRoutes(options: {
    sessionUser?: { username: string; email: string };
    role?: string | null;
    members?: { username: string; role: 'owner' | 'member' }[];
    deleteResponse?: { status: number; body: unknown };
  }) {
    const state = {
      members: options.members
        ? [...options.members]
        : [
            { username: 'alice-dev', role: 'owner' as const },
            { username: 'bob-reviewer', role: 'member' as const },
          ],
    };
    const deleteCalls: string[] = [];
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
      'DELETE /api/organizations/acme-demo/people/bob-reviewer': (init) => {
        const path = String(init?.method ?? 'DELETE');
        deleteCalls.push(path);
        if (options.deleteResponse) {
          return options.deleteResponse;
        }
        state.members = state.members.filter((m) => m.username !== 'bob-reviewer');
        return { status: 200, body: { ok: true } };
      },
    });
    return { state, deleteCalls };
  }

  it('the Owner removes bob-reviewer through the member menu and the Remove confirmation', async () => {
    const user = userEvent.setup();
    const { state, deleteCalls } = peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'acme-demo' })).toBeInTheDocument();

    // Each removable member row has a "Member menu <username>" button.
    const menuButton = await screen.findByRole('button', {
      name: 'Member menu bob-reviewer',
    });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(menuButton);
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    // The menu opens the menuitem "Remove from organization".
    const menuitem = await screen.findByRole('menuitem', {
      name: 'Remove from organization',
    });
    await user.click(menuitem);

    // The menuitem is followed by the confirmation dialog with the "Remove"
    // button.
    const dialog = await screen.findByRole('dialog', { name: 'Remove member' });
    expect(dialog).toBeInTheDocument();
    const removeButton = screen.getByRole('button', { name: 'Remove' });
    await user.click(removeButton);

    // The complete username is absent from People immediately.
    await waitFor(() =>
      expect(screen.queryByText('bob-reviewer')).not.toBeInTheDocument()
    );
    expect(state.members.some((m) => m.username === 'bob-reviewer')).toBe(false);
    expect(deleteCalls.length).toBe(1);
    // The Owner's own row remains and the Owner's own menu button is absent
    // (the last Owner cannot be removed).
    expect(screen.getAllByText('alice-dev').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: 'Member menu alice-dev' })
    ).not.toBeInTheDocument();
  });

  it('after leaving and reopening the People page the removed username stays absent', async () => {
    const user = userEvent.setup();
    const { state } = peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Member menu bob-reviewer' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from organization' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(screen.queryByText('bob-reviewer')).not.toBeInTheDocument()
    );
    expect(state.members.some((m) => m.username === 'bob-reviewer')).toBe(false);

    // Reopening the People page refetches from the (persisted) server state.
    navigate('#/organizations/acme-demo');
    await screen.findByRole('link', { name: 'Repositories' });
    navigate('#/organizations/acme-demo/people');
    await screen.findByRole('heading', { name: 'acme-demo' });
    await waitFor(() =>
      expect(screen.queryByText('bob-reviewer')).not.toBeInTheDocument()
    );
    expect(screen.getAllByText('alice-dev').length).toBeGreaterThan(0);
  });

  it('Cancel keeps the member and never calls the removal endpoint', async () => {
    const user = userEvent.setup();
    const { deleteCalls } = peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Member menu bob-reviewer' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from organization' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Remove member' })).not.toBeInTheDocument();
    expect(screen.getAllByText('bob-reviewer').length).toBeGreaterThan(0);
    expect(deleteCalls.length).toBe(0);
  });

  it('a rejected removal shows the server message and keeps the member', async () => {
    const user = userEvent.setup();
    const { deleteCalls } = peopleRoutes({
      deleteResponse: {
        status: 400,
        body: { ok: false, message: 'The last organization Owner cannot be removed' },
      },
    });
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Member menu bob-reviewer' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from organization' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(
      await screen.findByText('The last organization Owner cannot be removed')
    ).toBeInTheDocument();
    // The dialog stays open and the member remains in the list.
    expect(screen.getByRole('dialog', { name: 'Remove member' })).toBeInTheDocument();
    expect(screen.getAllByText('bob-reviewer').length).toBeGreaterThan(0);
    expect(deleteCalls.length).toBe(1);
  });

  it('the menu and the menuitem support keyboard activation', async () => {
    const user = userEvent.setup();
    const { deleteCalls } = peopleRoutes({});
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    const menuButton = await screen.findByRole('button', {
      name: 'Member menu bob-reviewer',
    });
    menuButton.focus();
    await user.keyboard('{ArrowDown}');
    const menuitem = await screen.findByRole('menuitem', {
      name: 'Remove from organization',
    });
    expect(menuitem).toHaveFocus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Remove member' });
    expect(dialog).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Remove member' })
    ).not.toBeInTheDocument();
    expect(deleteCalls.length).toBe(0);
    expect(screen.getAllByText('bob-reviewer').length).toBeGreaterThan(0);
  });

  it('a non-Owner viewing the same member has no member-menu button and no Remove from organization menuitem', async () => {
    peopleRoutes({
      sessionUser: { username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
      role: 'member',
    });
    navigate('#/organizations/acme-demo/people');
    render(<App />);

    // The People list loads asynchronously; wait until the members are shown.
    const aliceMatches = await screen.findAllByText('alice-dev');
    expect(aliceMatches.length).toBeGreaterThan(0);
    expect(screen.getAllByText('bob-reviewer').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: 'Member menu bob-reviewer' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Member menu alice-dev' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Remove from organization' })
    ).not.toBeInTheDocument();
  });
});
