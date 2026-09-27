import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PasswordSettingsPage from './PasswordSettingsPage';

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
});

const CURRENT = 'Valid-password-123!';
const NEW = 'New-password-456!';

describe('PasswordSettingsPage change password workflow', () => {
  it('renders the security page with uniquely labeled fields and the Update password button', () => {
    render(<PasswordSettingsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Password and authentication');
    expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Update password' })).toBeInTheDocument();
  });

  it('submitting an empty current-password field shows Current password is required', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: { ok: true, message: 'Password updated' } }));
    const user = userEvent.setup();
    render(<PasswordSettingsPage />);

    await user.type(screen.getByLabelText('New password'), NEW);
    await user.type(screen.getByLabelText('Confirm password'), NEW);
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(screen.getByText('Current password is required')).toBeInTheDocument();
    expect(screen.queryByText('Password updated')).not.toBeInTheDocument();
    // Client-side validation blocks the request; password fields are cleared.
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/change-password'),
      expect.anything()
    );
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('shows Current password is incorrect beside the field when the current password fails', async () => {
    stubFetch(() => ({
      status: 422,
      body: { error: 'Password change failed', fieldErrors: { currentPassword: 'Current password is incorrect' } },
    }));
    const user = userEvent.setup();
    render(<PasswordSettingsPage />);

    await user.type(screen.getByLabelText('Current password'), 'Wrong-password-123!');
    await user.type(screen.getByLabelText('New password'), NEW);
    await user.type(screen.getByLabelText('Confirm password'), NEW);
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(screen.getByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.queryByText('Password updated')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
    expect(document.body.textContent).not.toContain('Wrong-password-123!');
  });

  it('rejects a mismatched confirmation beside the Confirm password field', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: { ok: true, message: 'Password updated' } }));
    const user = userEvent.setup();
    render(<PasswordSettingsPage />);

    await user.type(screen.getByLabelText('Current password'), CURRENT);
    await user.type(screen.getByLabelText('New password'), NEW);
    await user.type(screen.getByLabelText('Confirm password'), 'does-not-match');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(screen.getByText('Password confirmation does not match')).toBeInTheDocument();
    expect(screen.queryByText('Password updated')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/change-password'),
      expect.anything()
    );
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('rejects a noncompliant new password with the requirements message', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: { ok: true, message: 'Password updated' } }));
    const user = userEvent.setup();
    render(<PasswordSettingsPage />);

    await user.type(screen.getByLabelText('Current password'), CURRENT);
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(screen.getByText('Password requirements are not satisfied')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/change-password'),
      expect.anything()
    );
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('updates the password, displays Password updated, and never echoes the passwords', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true, message: 'Password updated' } }));
    const user = userEvent.setup();
    render(<PasswordSettingsPage />);

    await user.type(screen.getByLabelText('Current password'), CURRENT);
    await user.type(screen.getByLabelText('New password'), NEW);
    await user.type(screen.getByLabelText('Confirm password'), NEW);
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(screen.getByRole('status')).toHaveTextContent('Password updated');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
    expect(document.body.textContent).not.toContain(NEW);
    expect(document.body.textContent).not.toContain(CURRENT);
  });
});
