import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../session';
import SignInPage from '../pages/SignInPage';
import { mockFetch } from './mockFetch';

const providerValue = {
  auth: { status: 'ready', user: null } as const,
  refresh: async () => {},
  updateUser: () => {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSignIn() {
  return render(
    <SessionContext.Provider value={providerValue}>
      <SignInPage />
    </SessionContext.Provider>
  );
}

describe('SignInPage (account-access page for REQ-1-1-1 flow)', () => {
  it('renders the sign-in form with the unique "Create an account" link', () => {
    renderSignIn();
    expect(screen.getByLabelText('Username or email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '#/register');
    expect(screen.getByRole('link', { name: 'Forgot password' })).toHaveAttribute('href', '#/forgot');
  });

  it('shows "Invalid credentials" on failure, retains the identifier, and clears the password', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/signin': () => ({ status: 401, body: { ok: false, message: 'Invalid credentials' } }),
    });

    renderSignIn();
    await user.type(screen.getByLabelText('Username or email'), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Wrong-password-999!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.getByLabelText('Username or email')).toHaveValue('alice-dev');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('enters the workspace after a successful sign-in and updates the session user', async () => {
    const user = userEvent.setup();
    const updateUser = vi.fn();
    mockFetch({
      '/api/auth/signin': () => ({
        status: 200,
        body: { ok: true, username: 'pw-user-abc', email: 'pw-user-abc@example.test' },
      }),
    });

    render(
      <SessionContext.Provider
        value={{ auth: { status: 'ready', user: null }, refresh: async () => {}, updateUser }}
      >
        <SignInPage />
      </SessionContext.Provider>
    );
    await user.type(screen.getByLabelText('Username or email'), 'pw-user-abc@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ username: 'pw-user-abc', email: 'pw-user-abc@example.test' }));
    await waitFor(() => expect(window.location.hash).toBe('#/workspace'));
  });
});
