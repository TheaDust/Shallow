import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForgotPasswordPage from '../pages/ForgotPasswordPage';
import { mockFetch } from './mockFetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockRecovery(resetResponse: { status: number; body: unknown }) {
  return mockFetch({
    '/api/auth/recovery/request': () => ({ status: 200, body: { ok: true, code: '123456' } }),
    '/api/auth/recovery/reset': () => resetResponse,
  });
}

describe('ForgotPasswordPage (REQ-1-1-3)', () => {
  it('renders the Email field and the "Send reset link" button on the first step', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole('heading', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });

  it('switches to the reset step for a registered email and shows the distinct code "123456" with the labeled fields', async () => {
    const user = userEvent.setup();
    const fetchSpy = mockRecovery({ status: 200, body: { ok: true, message: 'Password updated' } });

    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText('Email'), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    // The fixed code is its own distinct visible text value, not only embedded
    // inside a longer instruction.
    expect(await screen.findByText('123456')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/recovery/request',
      expect.objectContaining({ method: 'POST' })
    );
    expect(screen.getByLabelText('Email')).toHaveValue('alice.dev@example.test');
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeEnabled();
  });

  it('enters the same reset step for an unknown email without indicating whether the email exists', async () => {
    const user = userEvent.setup();
    mockRecovery({ status: 200, body: { ok: true, message: 'Password updated' } });

    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText('Email'), 'nobody@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText('123456')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('nobody@example.test');
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeEnabled();
    expect(screen.queryByText(/not registered|does not exist|unknown/i)).not.toBeInTheDocument();
  });

  it('shows "Verification code is invalid" beside the code field and clears the password fields', async () => {
    const user = userEvent.setup();
    mockRecovery({
      status: 400,
      body: { ok: false, errors: { verificationCode: 'Verification code is invalid' } },
    });

    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText('Email'), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await user.type(await screen.findByLabelText('Verification code'), '000000');
    await user.type(screen.getByLabelText('New password'), 'Replacement-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password-456!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Verification code is invalid')).toBeInTheDocument();
    // Non-sensitive input is retained; password fields are never redisplayed.
    expect(screen.getByLabelText('Email')).toHaveValue('alice.dev@example.test');
    expect(screen.getByLabelText('Verification code')).toHaveValue('000000');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('shows "Email is not registered" beside the Email field for an unknown email', async () => {
    const user = userEvent.setup();
    mockRecovery({
      status: 400,
      body: { ok: false, errors: { email: 'Email is not registered' } },
    });

    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText('Email'), 'unknown@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'Replacement-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password-456!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Email is not registered')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('unknown@example.test');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('shows password and confirmation errors together without modifying anything', async () => {
    const user = userEvent.setup();
    mockRecovery({
      status: 400,
      body: {
        ok: false,
        errors: {
          newPassword: 'Password requirements are not satisfied',
          confirmPassword: 'Password confirmation does not match',
        },
      },
    });

    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText('Email'), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Password requirements are not satisfied')).toBeInTheDocument();
    expect(screen.getByText('Password confirmation does not match')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('displays "Password updated" after a successful reset and produces no email or link', async () => {
    const user = userEvent.setup();
    mockRecovery({ status: 200, body: { ok: true, message: 'Password updated' } });

    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText('Email'), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'Replacement-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password-456!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Password updated');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
