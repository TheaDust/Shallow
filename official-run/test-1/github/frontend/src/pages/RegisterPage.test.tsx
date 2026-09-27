import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RegisterPage from './RegisterPage';

function stubFetch(response: { status: number; body: unknown }) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify(response.body), {
      status: response.status,
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

describe('RegisterPage', () => {
  it('renders the required controls with visible labels', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('textbox', { name: 'Username' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('checkbox', { name: 'Agree to the terms' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign up to GitHub');
  });

  it('shows all field errors together and retains non-sensitive input', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByRole('textbox', { name: 'Username' }), '-bad');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Username format is invalid')).toBeInTheDocument();
    expect(screen.getByText('Email format is invalid')).toBeInTheDocument();
    expect(screen.getByText('Password requirements are not satisfied')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByText('Agree to terms is required')).toBeInTheDocument();

    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('-bad');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('not-an-email');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');

    // Password values must never be echoed on the page.
    expect(document.body.textContent).not.toContain('short');
    expect(document.body.textContent).not.toContain('different');
  });

  it('shows required messages when fields are missing', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Username is required')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(screen.getByText('Confirm password is required')).toBeInTheDocument();
    expect(screen.getByText('Agree to terms is required')).toBeInTheDocument();
  });

  it('shows server-side duplicate username error and retains attempted values', async () => {
    const fetchMock = stubFetch({
      status: 422,
      body: { error: 'Registration failed', fieldErrors: { username: 'Username already exists' } },
    });
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'alice-dev');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'other.person@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('Confirm password'), 'Valid-password-123!');
    await user.click(screen.getByRole('checkbox', { name: 'Agree to the terms' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Username already exists')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('alice-dev');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue(
      'other.person@example.test'
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('registers successfully and redirects to the sign-in page', async () => {
    const fetchMock = stubFetch({
      status: 201,
      body: { ok: true, account: { username: 'pw-user-1', email: 'pw-user-1@example.test', emailVerified: true } },
    });
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'pw-user-1');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'pw-user-1@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('Confirm password'), 'Valid-password-123!');
    await user.click(screen.getByRole('checkbox', { name: 'Agree to the terms' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(window.location.hash).toBe('#/signin?registered=1');
    const payload = fetchMock.mock.calls[0][1]!.body as string;
    expect(JSON.parse(payload)).toEqual({
      username: 'pw-user-1',
      email: 'pw-user-1@example.test',
      password: 'Valid-password-123!',
      confirmPassword: 'Valid-password-123!',
      terms: true,
    });
  });
});
