import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

function mockSession(user: { id: string; username: string; email: string } | null) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/session') {
      return Promise.resolve(
        new Response(JSON.stringify({ user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url === '/api/auth/signout') {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: false, message: 'Not found' }), { status: 404 }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.location.hash = '#/';
  vi.unstubAllGlobals();
});

describe('App home page', () => {
  it('unauthenticated home shows the three account-access entries', async () => {
    mockSession(null);
    render(<App />);
    await screen.findByRole('heading', { name: 'GitHub' });
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('signed-in home shows the account menu with the username and Sign out', async () => {
    mockSession({ id: 'a1', username: 'alice-dev', email: 'alice.dev@example.test' });
    render(<App />);
    const menuButton = await screen.findByRole('button', { name: 'Account menu' });
    const user = userEvent.setup();
    await user.click(menuButton);
    expect(screen.getByText('alice-dev')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');
    expect(screen.getByRole('link', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('signed-in user can open the recovery page from any session state', async () => {
    mockSession({ id: 'a1', username: 'alice-dev', email: 'alice.dev@example.test' });
    window.location.hash = '#/forgot-password';
    render(<App />);
    expect(
      await screen.findByRole('button', { name: 'Send reset link' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
  });
});

describe('Sign out (REQ-1-2)', () => {
  it('Cancel keeps the session; Confirm sign out ends it and shows the Sign in entry', async () => {
    mockSession({ id: 'a1', username: 'alice-dev', email: 'alice.dev@example.test' });
    render(<App />);
    const user = userEvent.setup();

    const menuButton = await screen.findByRole('button', { name: 'Account menu' });

    // Open menu, activate Sign out → dialog appears
    await user.click(menuButton);
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out' });
    expect(dialog).toHaveTextContent('Signing out affects only the current browser session.');
    expect(screen.getByRole('button', { name: 'Confirm sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    // Cancel retains the session.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();

    // Confirm signs out.
    await user.click(menuButton);
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm sign out' }));

    await screen.findByRole('heading', { name: 'GitHub' });
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/');
  });
});
