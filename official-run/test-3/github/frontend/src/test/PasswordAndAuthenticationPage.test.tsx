import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PasswordAndAuthenticationPage from '../pages/PasswordAndAuthenticationPage';
import { SessionContext } from '../App';

function renderPage() {
  return render(
    <SessionContext.Provider
      value={{ user: { id: 'a1', username: 'alice-dev', email: 'alice.dev@example.test' }, loading: false, refresh: vi.fn(), signOut: vi.fn() }}
    >
      <PasswordAndAuthenticationPage />
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
  window.location.hash = '#/settings/password-and-authentication';
  vi.unstubAllGlobals();
});

describe('PasswordAndAuthenticationPage (REQ-1-3)', () => {
  it('renders the security page with the required labeled password inputs and Update password', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Password and authentication' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
  });

  it('displays Password updated and clears all password fields on success', async () => {
    const user = userEvent.setup();
    renderPage();
    mockFetchOnce({ ok: true });

    await user.type(screen.getByLabelText('Current password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('New password'), 'New-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'New-password-456!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Password updated');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('shows Current password is required for an empty current-password field', async () => {
    const user = userEvent.setup();
    renderPage();
    mockFetchOnce(
      { ok: false, fieldErrors: { currentPassword: 'Current password is required' } },
      422,
    );

    await user.type(screen.getByLabelText('New password'), 'New-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'New-password-456!');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Current password is required')).toBeInTheDocument();
    // password fields are never echoed
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
  });

  it('shows the incorrect-current-password and mismatch errors beside their fields', async () => {
    const user = userEvent.setup();
    renderPage();
    mockFetchOnce(
      {
        ok: false,
        fieldErrors: {
          currentPassword: 'Current password is incorrect',
          confirmPassword: 'Password confirmation does not match',
        },
      },
      422,
    );

    await user.type(screen.getByLabelText('Current password'), 'Wrong-password-123!');
    await user.type(screen.getByLabelText('New password'), 'New-password-456!');
    await user.type(screen.getByLabelText('Confirm password'), 'does-not-match');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByText('Password confirmation does not match')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });

  it('links back to Settings', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Back to settings' })).toHaveAttribute(
      'href',
      '#/settings',
    );
  });
});
