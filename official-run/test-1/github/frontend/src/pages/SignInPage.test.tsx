import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SignInPage from './SignInPage';

function stubFetch(response: { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('SignInPage', () => {
  it('renders the sign-in form, links, and controls', () => {
    render(<SignInPage onSignedIn={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Username or email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '#/register'
    );
    expect(screen.getByRole('link', { name: 'Forgot password' })).toHaveAttribute(
      'href',
      '#/forgot'
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in to GitHub');
  });

  it('shows the generic failure message and clears the password', async () => {
    stubFetch({ status: 401, body: { error: 'Invalid credentials' } });
    const user = userEvent.setup();
    render(<SignInPage onSignedIn={() => {}} />);

    await user.type(screen.getByRole('textbox', { name: 'Username or email' }), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Wrong-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    // Non-sensitive input is retained after failure.
    expect(screen.getByRole('textbox', { name: 'Username or email' })).toHaveValue('alice-dev');
    expect(document.body.textContent).not.toContain('Wrong-password-123!');
  });

  it('signs in successfully and reports the user', async () => {
    stubFetch({
      status: 200,
      body: { ok: true, user: { username: 'alice-dev', email: 'alice.dev@example.test' } },
    });
    const onSignedIn = vi.fn();
    const user = userEvent.setup();
    render(<SignInPage onSignedIn={onSignedIn} />);

    await user.type(screen.getByRole('textbox', { name: 'Username or email' }), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(onSignedIn).toHaveBeenCalledWith({
      username: 'alice-dev',
      email: 'alice.dev@example.test',
    });
  });

  it('shows the registration-success message after redirect', () => {
    window.location.hash = '#/signin?registered=1';
    render(<SignInPage onSignedIn={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Registration successful');
  });
});
