import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../session';
import AccountMenu from '../components/AccountMenu';
import HomePage from '../pages/HomePage';

afterEach(() => {
  vi.unstubAllGlobals();
});

const unauthenticated = {
  auth: { status: 'ready', user: null } as const,
  refresh: async () => {},
  updateUser: () => {},
};

describe('AccountMenu', () => {
  it('shows the signed-in account on the button and the Sign out entry after opening', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    render(
      <SessionContext.Provider value={unauthenticated}>
        <AccountMenu
          user={{ username: 'alice-dev', email: 'alice.dev@example.test' }}
          onSignOut={onSignOut}
        />
      </SessionContext.Provider>
    );

    const button = screen.getByRole('button', { name: 'Account menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('alice-dev');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    // The username is shown both on the button and inside the opened menu.
    expect(screen.getAllByText('alice-dev').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('link', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('clicking Sign out opens the confirmation dialog without signing out yet', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    render(
      <SessionContext.Provider value={unauthenticated}>
        <AccountMenu
          user={{ username: 'alice-dev', email: 'alice.dev@example.test' }}
          onSignOut={onSignOut}
        />
      </SessionContext.Provider>
    );

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));

    const dialog = screen.getByRole('dialog', { name: 'Sign out' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm sign out' })).toBeInTheDocument();
    expect(
      screen.getByText(/affects only the current browser session/i)
    ).toBeInTheDocument();
    // The dropdown is closed and the dialog holds focus.
    expect(screen.queryByRole('link', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('Cancel closes the dialog and does not sign out', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    render(
      <SessionContext.Provider value={unauthenticated}>
        <AccountMenu
          user={{ username: 'alice-dev', email: 'alice.dev@example.test' }}
          onSignOut={onSignOut}
        />
      </SessionContext.Provider>
    );

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(onSignOut).not.toHaveBeenCalled();
    // Focus returns to the account menu button after the dialog closes.
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveFocus();
  });

  it('Confirm sign out performs the sign-out action', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    render(
      <SessionContext.Provider value={unauthenticated}>
        <AccountMenu
          user={{ username: 'alice-dev', email: 'alice.dev@example.test' }}
          onSignOut={onSignOut}
        />
      </SessionContext.Provider>
    );

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Confirm sign out' }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Sign out' })).not.toBeInTheDocument();
  });
});

describe('HomePage', () => {
  it('shows Sign up, Sign in, and Forgot password entries for unauthenticated visitors', () => {
    render(
      <SessionContext.Provider value={unauthenticated}>
        <HomePage />
      </SessionContext.Provider>
    );
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '#/register');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '#/signin');
    expect(screen.getByRole('link', { name: 'Forgot password' })).toHaveAttribute('href', '#/forgot');
  });

  it('shows the workspace with the signed-in username for authenticated users', () => {
    render(
      <SessionContext.Provider
        value={{
          auth: { status: 'ready', user: { username: 'alice-dev', email: 'alice.dev@example.test' } },
          refresh: async () => {},
          updateUser: () => {},
        }}
      >
        <HomePage />
      </SessionContext.Provider>
    );
    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByText('alice-dev')).toBeInTheDocument();
  });
});
