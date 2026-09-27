import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignUpPage from '../pages/SignUpPage';
import { SessionContext } from '../App';

function renderSignUp() {
  return render(
    <SessionContext.Provider
      value={{ user: null, loading: false, refresh: vi.fn(), signOut: vi.fn() }}
    >
      <SignUpPage />
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
  window.location.hash = '#/signup';
  vi.unstubAllGlobals();
});

describe('SignUpPage (REQ-1-1-1)', () => {
  it('renders exactly the required labeled controls', () => {
    renderSignUp();
    expect(screen.getByRole('textbox', { name: 'Username' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    const terms = screen.getByRole('checkbox', { name: 'Agree to the terms' });
    expect(terms).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('shows all invalid-field errors together and retains username/email, clears passwords', async () => {
    const user = userEvent.setup();
    renderSignUp();
    mockFetchOnce(
      {
        ok: false,
        fieldErrors: {
          username: 'Username format is invalid',
          email: 'Email format is invalid',
          password: 'Password requirements are not satisfied',
          confirmPassword: 'Password confirmation does not match',
          agreeToTerms: 'Agree to terms is required',
        },
      },
      422,
    );

    await user.type(screen.getByRole('textbox', { name: 'Username' }), '-leading');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Username format is invalid')).toBeInTheDocument();
    expect(screen.getByText('Email format is invalid')).toBeInTheDocument();
    expect(screen.getByText('Password requirements are not satisfied')).toBeInTheDocument();
    expect(screen.getByText('Password confirmation does not match')).toBeInTheDocument();
    expect(screen.getByText('Agree to terms is required')).toBeInTheDocument();

    // Non-sensitive inputs retained; passwords not redisplayed.
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('-leading');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('not-an-email');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');

    // Submit stays actionable so messages can be read.
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('shows Username already exists for a duplicate username and retains both values', async () => {
    const user = userEvent.setup();
    renderSignUp();
    mockFetchOnce(
      { ok: false, fieldErrors: { username: 'Username already exists' } },
      422,
    );

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'alice-dev');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'new.user@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('Confirm password'), 'Valid-password-123!');
    await user.click(screen.getByRole('checkbox', { name: 'Agree to the terms' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Username already exists')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('alice-dev');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('new.user@example.test');
  });

  it('redirects to the sign-in page with success on valid submission', async () => {
    const user = userEvent.setup();
    renderSignUp();
    mockFetchOnce({ ok: true });

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'pw-user-1');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), '@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('Confirm password'), 'Valid-password-123!');
    await user.click(screen.getByRole('checkbox', { name: 'Agree to the terms' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(window.location.hash).toBe('#/signin?created=1');
  });
});
