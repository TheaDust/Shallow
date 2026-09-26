import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../session';
import PasswordSettingsPage from '../pages/PasswordSettingsPage';
import SettingsPage from '../pages/SettingsPage';
import AccountMenu from '../components/AccountMenu';
import { mockFetch } from './mockFetch';
import { navigate } from '../router';

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

const signedIn = {
  auth: {
    status: 'ready' as const,
    user: { username: 'alice-dev', email: 'alice.dev@example.test' },
  },
  refresh: async () => {},
  updateUser: () => {},
};

const unauthenticated = {
  auth: { status: 'ready' as const, user: null },
  refresh: async () => {},
  updateUser: () => {},
};

describe('PasswordSettingsPage (REQ-1-3)', () => {
  it('renders the heading, uniquely labeled password fields, and Update password button', () => {
    render(
      <SessionContext.Provider value={signedIn}>
        <PasswordSettingsPage />
      </SessionContext.Provider>
    );

    expect(screen.getByRole('heading', { name: 'Password and authentication' })).toBeInTheDocument();
    const current = screen.getByLabelText('Current password');
    const fresh = screen.getByLabelText('New password');
    const confirm = screen.getByLabelText('Confirm password');
    expect(current).toHaveAttribute('type', 'password');
    expect(fresh).toHaveAttribute('type', 'password');
    expect(confirm).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
  });

  it('displays "Password updated" after a successful change and clears the fields', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/change-password': () => ({
        status: 200,
        body: { ok: true, message: 'Password updated' },
      }),
    });

    render(
      <SessionContext.Provider value={signedIn}>
        <PasswordSettingsPage />
      </SessionContext.Provider>
    );

    await user.type(screen.getByLabelText('Current password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('New password'), 'New-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'New-password-456!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Password updated');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('shows "Current password is required" beside the field when it is empty', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/change-password': () => ({
        status: 400,
        body: { ok: false, errors: { currentPassword: 'Current password is required' } },
      }),
    });

    render(
      <SessionContext.Provider value={signedIn}>
        <PasswordSettingsPage />
      </SessionContext.Provider>
    );

    await user.type(screen.getByLabelText('New password'), 'Required-password-789!');
    await user.type(screen.getByLabelText('Confirm password'), 'Required-password-789!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Current password is required')).toBeInTheDocument();
    const current = screen.getByLabelText('Current password');
    expect(current).toHaveAttribute('aria-invalid', 'true');
    expect(current).toHaveAccessibleDescription('Current password is required');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows "Current password is incorrect" beside the field when the current password is wrong', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/change-password': () => ({
        status: 400,
        body: { ok: false, errors: { currentPassword: 'Current password is incorrect' } },
      }),
    });

    render(
      <SessionContext.Provider value={signedIn}>
        <PasswordSettingsPage />
      </SessionContext.Provider>
    );

    await user.type(screen.getByLabelText('Current password'), 'Wrong-current-000!');
    await user.type(screen.getByLabelText('New password'), 'New-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'New-password-456!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows "Password confirmation does not match" beside the confirm field', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/change-password': () => ({
        status: 400,
        body: { ok: false, errors: { confirmPassword: 'Password confirmation does not match' } },
      }),
    });

    render(
      <SessionContext.Provider value={signedIn}>
        <PasswordSettingsPage />
      </SessionContext.Provider>
    );

    await user.type(screen.getByLabelText('Current password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('New password'), 'New-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'Different-password-000!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Password confirmation does not match')).toBeInTheDocument();
    const confirm = screen.getByLabelText('Confirm password');
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(confirm).toHaveAccessibleDescription('Password confirmation does not match');
  });

  it('shows the new-password compliance reason beside the New password field', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/change-password': () => ({
        status: 400,
        body: {
          ok: false,
          errors: { newPassword: 'Password requirements are not satisfied' },
        },
      }),
    });

    render(
      <SessionContext.Provider value={signedIn}>
        <PasswordSettingsPage />
      </SessionContext.Provider>
    );

    await user.type(screen.getByLabelText('Current password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(
      await screen.findByText('Password requirements are not satisfied')
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('clears every password field after a rejected submission', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/change-password': () => ({
        status: 400,
        body: { ok: false, errors: { currentPassword: 'Current password is incorrect' } },
      }),
    });

    render(
      <SessionContext.Provider value={signedIn}>
        <PasswordSettingsPage />
      </SessionContext.Provider>
    );

    await user.type(screen.getByLabelText('Current password'), 'Wrong-current-000!');
    await user.type(screen.getByLabelText('New password'), 'New-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'New-password-456!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    await screen.findByText('Current password is incorrect');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('renders nothing and redirects to sign-in for unauthenticated visitors', () => {
    render(
      <SessionContext.Provider value={unauthenticated}>
        <PasswordSettingsPage />
      </SessionContext.Provider>
    );
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#/signin');
  });
});

describe('Settings navigation (REQ-1-3 entry chain)', () => {
  it('SettingsPage shows the heading and the Password and authentication entry', () => {
    render(
      <SessionContext.Provider value={signedIn}>
        <SettingsPage />
      </SessionContext.Provider>
    );
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Password and authentication' })).toHaveAttribute(
      'href',
      '#/settings/password'
    );
  });

  it('SettingsPage redirects unauthenticated visitors to sign-in', () => {
    render(
      <SessionContext.Provider value={unauthenticated}>
        <SettingsPage />
      </SessionContext.Provider>
    );
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#/signin');
  });

  it('the account menu exposes the Settings entry', async () => {
    const user = userEvent.setup();
    render(
      <SessionContext.Provider value={signedIn}>
        <AccountMenu user={{ username: 'alice-dev', email: 'alice.dev@example.test' }} onSignOut={vi.fn()} />
      </SessionContext.Provider>
    );

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const settingsLink = screen.getByRole('link', { name: 'Settings' });
    expect(settingsLink).toHaveAttribute('href', '#/settings');
  });

  it('navigates from Settings to the password form when opening Password and authentication', async () => {
    const user = userEvent.setup();
    navigate('#/settings');
    render(
      <SessionContext.Provider value={signedIn}>
        <SettingsPage />
      </SessionContext.Provider>
    );

    await user.click(screen.getByRole('link', { name: 'Password and authentication' }));
    // The hash route now targets the password settings page; re-render it.
    expect(window.location.hash).toBe('#/settings/password');
  });
});
