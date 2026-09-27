import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from '../pages/ForgotPasswordPage';

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
  window.location.hash = '#/forgot-password';
  vi.unstubAllGlobals();
});

describe('ForgotPasswordPage (REQ-1-1-3)', () => {
  it('starts with the Email field and Send reset link button', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });

  it('switches to the reset step showing the fixed code 123456 as its own visible value', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    mockFetchOnce({ ok: true, code: '123456' });

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ghost@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    // Distinct visible text value exactly 123456, not only inside a sentence.
    expect(await screen.findByText('123456')).toBeInTheDocument();
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument();
  });

  it('shows Verification code is invalid beside the code field and clears password fields', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    mockFetchOnce({ ok: true, code: '123456' });
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    mockFetchOnce(
      { ok: false, fieldErrors: { code: 'Verification code is invalid' } },
      422,
    );
    await user.type(screen.getByLabelText('Verification code'), '000000');
    await user.type(screen.getByLabelText('New password'), 'Replacement-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password-456!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Verification code is invalid')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('shows Email is not registered for an unknown email and Password updated on success', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    mockFetchOnce({ ok: true, code: '123456' });
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ghost@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    mockFetchOnce(
      { ok: false, fieldErrors: { email: 'Email is not registered' } },
      422,
    );
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'Replacement-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password-456!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('Email is not registered')).toBeInTheDocument();
    // non-sensitive email input is retained
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('ghost@example.test');

    mockFetchOnce({ ok: true });
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'Replacement-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password-456!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Password updated');
  });
});
