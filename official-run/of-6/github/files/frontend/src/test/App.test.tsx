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
  window.location.hash = '';
  mockFetch({
    '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
  });
});

describe('App navigation chain (REQ-1-1-1 scenario path)', () => {
  it('goes from the home page through Sign in to the registration form', async () => {
    const user = userEvent.setup();
    render(<App />);

    const signInLink = await screen.findByRole('link', { name: 'Sign in' });
    await user.click(signInLink);

    const usernameOrEmail = await screen.findByLabelText('Username or email');
    expect(usernameOrEmail).toBeInTheDocument();

    const createAccountLink = await screen.findByRole('link', { name: 'Create an account' });
    await user.click(createAccountLink);

    expect(await screen.findByRole('button', { name: 'Create account' })).toBeEnabled();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Agree to the terms' })).not.toBeChecked();
  });

  it('goes from the home page to the password-recovery form via the Forgot password link', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Forgot password' }));

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
    expect(window.location.hash).toBe('#/forgot');
  });

  it('renders the unique main region for the page content', async () => {
    render(<App />);
    await screen.findByRole('link', { name: 'Sign in' });
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('enters the workspace after signing in and keeps the user in the account menu', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/auth/signin': () => ({
        status: 200,
        body: { ok: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
    });

    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Username or email'), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getAllByText('alice-dev').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
  });

  it('keeps the signed-in user and account menu after reloading the workspace (persisted session)', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
    });
    window.location.hash = '#/workspace';
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    expect(screen.getAllByText('alice-dev').length).toBeGreaterThan(0);
  });

  it('redirects an unauthenticated visitor from the protected workspace to the sign-in page', async () => {
    window.location.hash = '#/workspace';
    render(<App />);

    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/signin');
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
  });

  it('stays on the sign-in page with the generic error and no account menu after a failed sign-in', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/auth/signin': () => ({
        status: 401,
        body: { ok: false, message: 'Invalid credentials' },
      }),
    });

    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Username or email'), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Wrong-password-999!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.getByLabelText('Username or email')).toHaveValue('alice-dev');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(window.location.hash).toBe('#/signin');
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
  });

  it('signs out via the confirmation dialog: Cancel keeps the page, Confirm restores the unauthenticated home', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/auth/signout': () => ({ status: 200, body: { ok: true } }),
    });
    navigate('#/workspace');
    render(<App />);

    await screen.findByRole('heading', { name: 'Workspace' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    expect(screen.getByRole('dialog', { name: 'Sign out' })).toBeInTheDocument();

    // Cancel retains the session and the original protected page stays accessible.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();

    // Confirm sign out ends the session.
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Confirm sign out' }));

    // Unauthenticated home: the Sign in entry is displayed and the account menu is gone.
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#/');
  });

  it('after sign-out, browser back to the recorded protected page requires re-authentication', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/auth/signout': () => ({ status: 200, body: { ok: true } }),
    });
    navigate('#/workspace');
    render(<App />);

    await screen.findByRole('heading', { name: 'Workspace' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Confirm sign out' }));
    await screen.findByRole('link', { name: 'Sign in' });

    // Browser back navigation to the previously accessible protected page.
    navigate('#/workspace');

    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/signin');
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
  });

  it('after sign-out, a refreshed session stays unauthenticated and reopening the protected page requires sign-in', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/auth/signout': () => ({ status: 200, body: { ok: true } }),
    });
    navigate('#/workspace');
    const { unmount } = render(<App />);

    await screen.findByRole('heading', { name: 'Workspace' });
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Confirm sign out' }));
    await screen.findByRole('link', { name: 'Sign in' });

    // A reload queries the server again; the invalidated session yields the
    // unauthenticated state and the Sign in entry.
    unmount();
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    });
    navigate('#/');
    render(<App />);

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    // Directly reopening the previously accessible protected page requires sign-in.
    navigate('#/workspace');
    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/signin');
  });
});
