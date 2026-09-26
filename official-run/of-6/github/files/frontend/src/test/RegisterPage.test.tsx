import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionContext } from '../session';
import RegisterPage from '../pages/RegisterPage';
import SignInPage from '../pages/SignInPage';
import { mockFetch } from './mockFetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RegisterPage (REQ-1-1-1)', () => {
  it('renders exactly one labeled field per control, an unchecked terms checkbox, and an enabled Create account button', () => {
    render(<RegisterPage />);

    const username = screen.getByLabelText('Username');
    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    const confirmPassword = screen.getByLabelText('Confirm password');
    expect(username).toHaveAttribute('type', 'text');
    expect(email).toHaveAttribute('type', 'text');
    expect(password).toHaveAttribute('type', 'password');
    expect(confirmPassword).toHaveAttribute('type', 'password');

    const terms = screen.getByRole('checkbox', { name: 'Agree to the terms' });
    expect(terms).not.toBeChecked();

    const button = screen.getByRole('button', { name: 'Create account' });
    expect(button).toBeEnabled();
  });

  it('shows every violated-field message together, retains username/email, and clears password fields', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/register': () => ({
        status: 400,
        body: {
          ok: false,
          errors: {
            username: 'Username format is invalid',
            email: 'Email format is invalid',
            password: 'Password requirements are not satisfied',
            confirmPassword: 'Password confirmation does not match',
            agreeToTerms: 'Agree to terms is required',
          },
        },
      }),
    });

    render(<RegisterPage />);
    await user.type(screen.getByLabelText('Username'), '-bad-user');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Username format is invalid')).toBeInTheDocument();
    expect(screen.getByText('Email format is invalid')).toBeInTheDocument();
    expect(screen.getByText('Password requirements are not satisfied')).toBeInTheDocument();
    expect(screen.getByText('Password confirmation does not match')).toBeInTheDocument();
    expect(screen.getByText('Agree to terms is required')).toBeInTheDocument();

    expect(screen.getByLabelText('Username')).toHaveValue('-bad-user');
    expect(screen.getByLabelText('Email')).toHaveValue('not-an-email');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');

    // The submit button stays actionable so the messages can be read.
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('shows "Username already exists" for a duplicate username and retains both attempted values', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/register': () => ({
        status: 400,
        body: { ok: false, errors: { username: 'Username already exists' } },
      }),
    });

    render(<RegisterPage />);
    await user.type(screen.getByLabelText('Username'), 'alice-dev');
    await user.type(screen.getByLabelText('Email'), 'unused@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('Confirm password'), 'Valid-password-123!');
    await user.click(screen.getByRole('checkbox', { name: 'Agree to the terms' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Username already exists')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('alice-dev');
    expect(screen.getByLabelText('Email')).toHaveValue('unused@example.test');
  });

  it('on success redirects to the sign-in page which shows "Registration successful"', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/register': () => ({
        status: 201,
        body: {
          ok: true,
          username: 'pw-user-abc',
          email: 'pw-user-abc@example.test',
          emailVerified: true,
        },
      }),
    });

    const { unmount } = render(<RegisterPage />);
    await user.type(screen.getByLabelText('Username'), 'pw-user-abc');
    await user.type(screen.getByLabelText('Email'), 'pw-user-abc@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('Confirm password'), 'Valid-password-123!');
    await user.click(screen.getByRole('checkbox', { name: 'Agree to the terms' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(window.location.hash).toBe('#/signin'));
    expect(sessionStorage.getItem('registerSuccess')).toBe('1');
    unmount();

    render(
      <SessionContext.Provider
        value={{ auth: { status: 'ready', user: null }, refresh: async () => {}, updateUser: () => {} }}
      >
        <SignInPage />
      </SessionContext.Provider>
    );
    expect(screen.getByRole('status')).toHaveTextContent('Registration successful');
  });
});
