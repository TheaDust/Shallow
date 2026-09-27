import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignInPage from '../pages/SignInPage';
import { SessionContext } from '../App';

function renderSignIn(refresh = vi.fn()) {
  return render(
    <SessionContext.Provider
      value={{ user: null, loading: false, refresh, signOut: vi.fn() }}
    >
      <SignInPage />
    </SessionContext.Provider>,
  );
}

function mockFetchOnce(response: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

beforeEach(() => {
  window.location.hash = '#/signin';
  vi.unstubAllGlobals();
});

describe('SignInPage (REQ-1-1-2)', () => {
  it('renders the sign-in form with its links', () => {
    renderSignIn();
    expect(screen.getByRole('textbox', { name: 'Username or email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password' })).toBeInTheDocument();
  });

  it('shows exactly Invalid credentials on failed authentication and stays on the page', async () => {
    const user = userEvent.setup();
    renderSignIn();
    mockFetchOnce({ ok: false, message: 'Invalid credentials' }, 401);

    await user.type(screen.getByRole('textbox', { name: 'Username or email' }), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Wrong-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(window.location.hash).toBe('#/signin');
    // identifier retained, password cleared
    expect(screen.getByRole('textbox', { name: 'Username or email' })).toHaveValue('alice-dev');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('signs in successfully and navigates to the workspace', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderSignIn(refresh);
    mockFetchOnce({ ok: true, user: { id: '1', username: 'alice-dev', email: 'alice.dev@example.test' } });

    await user.type(screen.getByRole('textbox', { name: 'Username or email' }), 'alice.dev@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(refresh).toHaveBeenCalled();
    expect(window.location.hash).toBe('#/');
  });

  it('shows Registration successful after being redirected from a successful registration', () => {
    window.location.hash = '#/signin?created=1';
    renderSignIn();
    expect(screen.getByRole('status')).toHaveTextContent('Registration successful');
  });
});
