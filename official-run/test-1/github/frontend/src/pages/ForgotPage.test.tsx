import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ForgotPage from './ForgotPage';

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const VALID_PASSWORD = 'Replacement-password-456!';

describe('ForgotPage recovery flow', () => {
  it('starts on the email step with a labeled field and the Send reset link button', () => {
    render(<ForgotPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reset your password');
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
  });

  it('switches to the reset step showing the fixed code as a distinct value', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true } }));
    const user = userEvent.setup();
    render(<ForgotPage />);

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    // The fixed verification code is displayed as its own distinct visible value.
    expect(screen.getByText('123456', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Verification code' })).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument();
    // The email entry step is replaced by the reset step.
    expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send reset link' })).not.toBeInTheDocument();
  });

  it('rejects an incorrect verification code and clears the password fields', async () => {
    stubFetch((url: string) => {
      if (url === '/api/forgot-password') {
        return { status: 200, body: { ok: true } };
      }
      if (url === '/api/reset-password') {
        return {
          status: 422,
          body: { error: 'Password reset failed', fieldErrors: { code: 'Verification code is invalid' } },
        };
      }
      return { status: 404, body: { error: 'Not found' } };
    });
    const user = userEvent.setup();
    render(<ForgotPage />);

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await user.type(screen.getByRole('textbox', { name: 'Verification code' }), '000000');
    await user.type(screen.getByLabelText('New password'), VALID_PASSWORD);
    await user.type(screen.getByLabelText('Confirm password'), VALID_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByText('Verification code is invalid')).toBeInTheDocument();
    expect(screen.queryByText('Password updated')).not.toBeInTheDocument();
    // Passwords must not be echoed or redisplayed after failure.
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
    expect(document.body.textContent).not.toContain(VALID_PASSWORD);
  });

  it('explains an unknown email beside the recovery flow and never shows success', async () => {
    stubFetch((url: string) => {
      if (url === '/api/forgot-password') {
        return { status: 200, body: { ok: true } };
      }
      if (url === '/api/reset-password') {
        return {
          status: 422,
          body: { error: 'Password reset failed', fieldErrors: { email: 'Email is not registered' } },
        };
      }
      return { status: 404, body: { error: 'Not found' } };
    });
    const user = userEvent.setup();
    render(<ForgotPage />);

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ghost@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    // The unknown email still opens the same next step with the fixed code.
    expect(screen.getByText('123456', { exact: true })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Verification code' }), '123456');
    await user.type(screen.getByLabelText('New password'), VALID_PASSWORD);
    await user.type(screen.getByLabelText('Confirm password'), VALID_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByText('Email is not registered')).toBeInTheDocument();
    expect(screen.queryByText('Password updated')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('rejects a noncompliant new password with the password requirements message', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: { ok: true } }));
    const user = userEvent.setup();
    render(<ForgotPage />);

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await user.type(screen.getByRole('textbox', { name: 'Verification code' }), '123456');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByText('Password requirements are not satisfied')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
    expect(document.body.textContent).not.toContain('short');
    // Client-side validation blocks the request for a noncompliant password.
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/reset-password'),
      expect.anything()
    );
  });

  it('rejects a mismatched confirmation beside the Confirm password field', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true } }));
    const user = userEvent.setup();
    render(<ForgotPage />);

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await user.type(screen.getByRole('textbox', { name: 'Verification code' }), '123456');
    await user.type(screen.getByLabelText('New password'), VALID_PASSWORD);
    await user.type(screen.getByLabelText('Confirm password'), 'Different-password-789!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.queryByText('Password updated')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('updates the password and displays Password updated on success', async () => {
    stubFetch((url: string) => {
      if (url === '/api/forgot-password') {
        return { status: 200, body: { ok: true } };
      }
      if (url === '/api/reset-password') {
        return { status: 200, body: { ok: true, message: 'Password updated' } };
      }
      return { status: 404, body: { error: 'Not found' } };
    });
    const user = userEvent.setup();
    render(<ForgotPage />);

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await user.type(screen.getByRole('textbox', { name: 'Verification code' }), '123456');
    await user.type(screen.getByLabelText('New password'), VALID_PASSWORD);
    await user.type(screen.getByLabelText('Confirm password'), VALID_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByRole('status')).toHaveTextContent('Password updated');
    // The reset form is replaced by the success result; no password material is echoed.
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(VALID_PASSWORD);
  });
});
