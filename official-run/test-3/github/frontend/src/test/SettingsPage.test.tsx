import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../pages/SettingsPage';
import { SessionContext } from '../App';

function renderSettings(user: { id: string; username: string; email: string } | null) {
  return render(
    <SessionContext.Provider
      value={{ user, loading: false, refresh: vi.fn(), signOut: vi.fn() }}
    >
      <SettingsPage />
    </SessionContext.Provider>,
  );
}

beforeEach(() => {
  window.location.hash = '#/settings';
});

describe('SettingsPage (REQ-1-3)', () => {
  it('shows the Settings page with the Password and authentication entry', () => {
    renderSettings({ id: 'a1', username: 'alice-dev', email: 'alice.dev@example.test' });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Password and authentication' })).toHaveAttribute(
      'href',
      '#/settings/password-and-authentication',
    );
  });

  it('redirects signed-out visitors back to the home page', () => {
    renderSettings(null);
    expect(window.location.hash).toBe('#/');
  });
});
