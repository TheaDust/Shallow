import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  // Reset both the URL and the router's module-level route so every test
  // starts from a fresh unauthenticated home page.
  window.location.hash = '';
  navigate('#/');
});

/**
 * Full REQ-1-3 chain: sign in → account menu → Settings → Password and
 * authentication → change the password → sign out → sign in with the new
 * password (old one rejected).
 */
describe('Change account password end-to-end (REQ-1-3 scenario 1)', () => {
  it('updates the password and the new password works for a later sign-in', async () => {
    const user = userEvent.setup();
    const SEED = 'Valid-password-123!';
    const NEW = 'New-password-456!';
    let currentPassword = SEED;

    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/auth/signin': (init) => {
        const body = JSON.parse(String(init?.body));
        if (body.password === currentPassword) {
          return {
            status: 200,
            body: { ok: true, username: 'alice-dev', email: 'alice.dev@example.test' },
          };
        }
        return { status: 401, body: { ok: false, message: 'Invalid credentials' } };
      },
      '/api/auth/change-password': (init) => {
        const body = JSON.parse(String(init?.body));
        if (body.currentPassword !== currentPassword) {
          return {
            status: 400,
            body: { ok: false, errors: { currentPassword: 'Current password is incorrect' } },
          };
        }
        currentPassword = body.newPassword;
        return { status: 200, body: { ok: true, message: 'Password updated' } };
      },
      '/api/auth/signout': () => ({ status: 200, body: { ok: true } }),
    });

    render(<App />);

    // Sign in with the seeded credentials.
    await user.click(await screen.findByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Username or email'), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), SEED);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Workspace' });

    // Account menu → Settings.
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });

    // Open Password and authentication.
    await user.click(screen.getByRole('link', { name: 'Password and authentication' }));
    await screen.findByRole('heading', { name: 'Password and authentication' });

    // Submit the change with the seed password and a new compliant candidate.
    await user.type(screen.getByLabelText('Current password'), SEED);
    await user.type(screen.getByLabelText('New password'), NEW);
    await user.type(screen.getByLabelText('Confirm password'), NEW);
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Password updated');

    // Sign out through the confirmation dialog.
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Confirm sign out' }));
    await screen.findByRole('link', { name: 'Sign in' });

    // The old password no longer works; the new password signs in.
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Username or email'), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), SEED);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');

    await user.type(screen.getByLabelText('Password'), NEW);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/workspace');
  });

  it('a rejected change leaves the original credentials usable after sign-out', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/auth/signin': () => ({
        status: 200,
        body: { ok: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/auth/change-password': () => ({
        status: 400,
        body: { ok: false, errors: { currentPassword: 'Current password is incorrect' } },
      }),
      '/api/auth/signout': () => ({ status: 200, body: { ok: true } }),
    });

    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Username or email'), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Workspace' });

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    await user.click(screen.getByRole('link', { name: 'Password and authentication' }));
    await screen.findByRole('heading', { name: 'Password and authentication' });

    await user.type(screen.getByLabelText('Current password'), 'Wrong-current-000!');
    await user.type(screen.getByLabelText('New password'), 'New-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'New-password-456!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
