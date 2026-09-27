import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from './HomePage';

describe('HomePage (unauthenticated)', () => {
  it('shows the account entry links', () => {
    render(<HomePage session={null} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('GitHub');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '#/register');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '#/signin');
    expect(screen.getByRole('link', { name: 'Forgot password' })).toHaveAttribute(
      'href',
      '#/forgot'
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});

describe('HomePage (signed in)', () => {
  it('shows the workspace with the signed-in username', () => {
    render(
      <HomePage session={{ username: 'alice-dev', email: 'alice.dev@example.test' }} />
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your workspace');
    expect(screen.getByText('Signed in as alice-dev')).toBeInTheDocument();
  });
});
