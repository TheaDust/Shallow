import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

interface RouteHandler {
  (url: string, init?: RequestInit): { status: number; body: unknown };
}

function stubFetch(handler: RouteHandler) {
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

let signedInUser: { username: string; email: string } | null = null;

beforeEach(() => {
  signedInUser = null;
  window.location.hash = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  signedInUser = null;
  window.location.hash = '';
});

describe('App integration', () => {
  it('registers, signs in, enters the workspace, and restores the session on reload', async () => {
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return signedInUser
          ? { status: 200, body: { user: signedInUser } }
          : { status: 401, body: { error: 'Unauthorized' } };
      }
      if (url === '/api/register') {
        return {
          status: 201,
          body: { ok: true, account: { username: 'pw-user-1', email: 'pw-user-1@example.test', emailVerified: true } },
        };
      }
      if (url === '/api/signin') {
        signedInUser = { username: 'pw-user-1', email: 'pw-user-1@example.test' };
        return { status: 200, body: { ok: true, user: signedInUser } };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();

    // Fresh unauthenticated session starts at the home page.
    window.location.hash = '#/';
    const first = render(<App />);
    await screen.findByRole('link', { name: 'Sign in' });

    // Navigate to the sign-in page and then to registration.
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Sign in to GitHub' });
    await user.click(screen.getByRole('link', { name: 'Create an account' }));
    await screen.findByRole('heading', { name: 'Sign up to GitHub' });

    // Fill the registration form and submit.
    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'pw-user-1');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'pw-user-1@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.type(screen.getByLabelText('Confirm password'), 'Valid-password-123!');
    await user.click(screen.getByRole('checkbox', { name: 'Agree to the terms' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    // Registration success redirects to the sign-in page.
    await screen.findByRole('heading', { name: 'Sign in to GitHub' });
    expect(screen.getByRole('status')).toHaveTextContent('Registration successful');

    // The new account can immediately sign in.
    await user.type(screen.getByRole('textbox', { name: 'Username or email' }), 'pw-user-1@example.test');
    await user.type(screen.getByLabelText('Password'), 'Valid-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // The workspace shows the signed-in username and the account menu.
    await screen.findByRole('heading', { name: 'Your workspace' });
    expect(screen.getByText('Signed in as pw-user-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();

    // Reload: a fresh App restores the session and keeps the username visible.
    first.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Your workspace' });
    expect(screen.getByText('Signed in as pw-user-1')).toBeInTheDocument();
  });

  it('shows the account menu with the current account and Sign out entry', async () => {
    signedInUser = { username: 'alice-dev', email: 'alice.dev@example.test' };
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return { status: 200, body: { user: signedInUser } };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Your workspace' });

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getByText('Signed in as alice-dev')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    expect(screen.getByRole('dialog', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('failed sign-in stays on the sign-in page and never shows the account menu', async () => {
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return { status: 401, body: { error: 'Unauthorized' } };
      }
      if (url === '/api/signin') {
        return { status: 401, body: { error: 'Invalid credentials' } };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();
    window.location.hash = '#/signin';
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in to GitHub' });

    await user.type(screen.getByRole('textbox', { name: 'Username or email' }), 'alice-dev');
    await user.type(screen.getByLabelText('Password'), 'Wrong-password-123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in to GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Username or email' })).toHaveValue('alice-dev');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your workspace' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Wrong-password-123!');
  });

  it('canceling the sign-out dialog retains the session and the page', async () => {
    signedInUser = { username: 'alice-dev', email: 'alice.dev@example.test' };
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return { status: 200, body: { user: signedInUser } };
      }
      if (url === '/api/signout') {
        signedInUser = null;
        return { status: 200, body: { ok: true } };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Your workspace' });

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign out' });
    expect(dialog).toHaveTextContent('Signing out affects only the current browser session.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    expect(signedInUser).not.toBeNull();
  });

  it('confirming sign-out ends the session and refresh stays unauthenticated', async () => {
    signedInUser = { username: 'alice-dev', email: 'alice.dev@example.test' };
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return signedInUser
          ? { status: 200, body: { user: signedInUser } }
          : { status: 401, body: { error: 'Unauthorized' } };
      }
      if (url === '/api/signout') {
        signedInUser = null;
        return { status: 200, body: { ok: true } };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();
    const first = render(<App />);
    await screen.findByRole('heading', { name: 'Your workspace' });
    expect(screen.getAllByRole('button', { name: 'Account menu' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Confirm sign out' }));

    // Unauthenticated home page with the Sign in entry; no account menu.
    await screen.findByRole('link', { name: 'Sign in' });
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your workspace' })).not.toBeInTheDocument();

    // Reload: the signed-out session cannot be restored.
    first.unmount();
    render(<App />);
    await screen.findByRole('link', { name: 'Sign in' });
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
  });

  it('a signed-in user enters Settings from the account menu and opens Password and authentication', async () => {
    signedInUser = { username: 'alice-dev', email: 'alice.dev@example.test' };
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return { status: 200, body: { user: signedInUser } };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Your workspace' });

    // Enter Settings from the account menu.
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.getByRole('link', { name: 'Password and authentication' })).toHaveAttribute(
      'href',
      '#/settings/password'
    );

    // Open the security page with the change-password form.
    await user.click(screen.getByRole('link', { name: 'Password and authentication' }));
    await screen.findByRole('heading', { name: 'Password and authentication' });
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeInTheDocument();
    // The top bar account menu stays available on the security page.
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
  });

  it('a signed-in user can open the password-recovery workflow and keep the account menu', async () => {
    signedInUser = { username: 'alice-dev', email: 'alice.dev@example.test' };
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return { status: 200, body: { user: signedInUser } };
      }
      if (url === '/api/forgot-password') {
        return { status: 200, body: { ok: true } };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();
    window.location.hash = '#/forgot';
    render(<App />);

    // The recovery workflow is reachable while signed in and keeps the top bar.
    await screen.findByRole('heading', { name: 'Reset your password' });
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'alice.dev@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('123456', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument();
  });

  it('visitor searches a repository from the global search box and opens its overview and file', async () => {
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return { status: 401, body: { error: 'Unauthorized' } };
      }
      if (url.startsWith('/api/search')) {
        return {
          status: 200,
          body: {
            results: [
              {
                owner: 'alice-dev',
                name: 'acme-docs',
                description: 'Acme documentation and guides',
                visibility: 'public',
                updatedAt: '2026-01-15T10:30:00.000Z',
              },
            ],
          },
        };
      }
      if (url.startsWith('/api/repositories/alice-dev/acme-docs/file?')) {
        return {
          status: 200,
          body: {
            file: {
              owner: 'alice-dev',
              name: 'acme-docs',
              branch: 'main',
              path: 'README.md',
              fileName: 'README.md',
              content: '# Acme Docs\n\nWelcome to the Acme documentation repository.',
            },
          },
        };
      }
      if (url.startsWith('/api/repositories/alice-dev/acme-docs')) {
        return {
          status: 200,
          body: {
            repository: {
              owner: 'alice-dev',
              name: 'acme-docs',
              description: 'Acme documentation and guides',
              visibility: 'public',
              defaultBranch: 'main',
              createdAt: '2026-01-10T09:00:00.000Z',
              updatedAt: '2026-01-15T10:30:00.000Z',
              files: [{ name: 'README.md', path: 'README.md', type: 'file' }],
            },
          },
        };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();
    window.location.hash = '#/';
    render(<App />);
    await screen.findByRole('link', { name: 'Sign in' });

    // The top global search control is a searchbox named Search.
    const searchbox = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(searchbox, 'acme{Enter}');

    // Results appear directly after Enter and show the repository name link and metadata.
    await screen.findByRole('heading', { name: 'Search results' });
    expect(screen.getByText('alice-dev/acme-docs')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();

    // Clicking the result opens the repository overview heading.
    await user.click(screen.getByRole('link', { name: 'acme-docs' }));
    await screen.findByRole('heading', { name: 'alice-dev/acme-docs' });
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText('Acme documentation and guides')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Issues' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pull requests' })).toBeInTheDocument();

    // The visitor can enter the file-content page from the file list.
    await user.click(screen.getByRole('link', { name: 'README.md' }));
    await screen.findByRole('heading', { name: 'README.md' });
    const pre = screen.getByText(
      (_content, element) =>
        element?.tagName === 'PRE' &&
        element.textContent === '# Acme Docs\n\nWelcome to the Acme documentation repository.'
    );
    expect(pre).toBeInTheDocument();
  });

  it('a signed-in user sees the global search box and can open a private repository they own', async () => {
    signedInUser = { username: 'alice-dev', email: 'alice.dev@example.test' };
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return { status: 200, body: { user: signedInUser } };
      }
      if (url.startsWith('/api/repositories/alice-dev/secret-research')) {
        return {
          status: 200,
          body: {
            repository: {
              owner: 'alice-dev',
              name: 'secret-research',
              description: 'Private research notes',
              visibility: 'private',
              defaultBranch: 'main',
              createdAt: '2026-01-12T08:00:00.000Z',
              updatedAt: '2026-01-14T12:00:00.000Z',
              files: [{ name: 'notes.md', path: 'notes.md', type: 'file' }],
            },
          },
        };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();
    window.location.hash = '#/alice-dev/secret-research';
    render(<App />);

    // Direct address to the owned private repository shows its overview.
    await screen.findByRole('heading', { name: 'alice-dev/secret-research' });
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Private research notes')).toBeInTheDocument();

    // The global search box is available on the repository page as well.
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'secret{Enter}');
    await screen.findByRole('heading', { name: 'Search results' });
  });

  it('a visitor is denied the private repository overview', async () => {
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return { status: 401, body: { error: 'Unauthorized' } };
      }
      if (url.startsWith('/api/repositories/alice-dev/secret-research')) {
        return { status: 404, body: { error: 'Not found' } };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    window.location.hash = '#/alice-dev/secret-research';
    render(<App />);
    await screen.findByRole('heading', { name: 'Repository not found' });
    expect(screen.queryByRole('heading', { name: 'alice-dev/secret-research' })).not.toBeInTheDocument();
  });

  it('a visitor opens the Issues page from a repository and views an issue detail', async () => {
    stubFetch((url: string) => {
      if (url === '/api/me') {
        return { status: 401, body: { error: 'Unauthorized' } };
      }
      if (url.startsWith('/api/repositories/alice-dev/acme-docs/issues/')) {
        return {
          status: 200,
          body: {
            repository: {
              owner: 'alice-dev',
              name: 'acme-docs',
              description: 'Acme documentation and guides',
              visibility: 'public',
              defaultBranch: 'main',
              createdAt: '2026-01-10T09:00:00.000Z',
              updatedAt: '2026-01-15T10:30:00.000Z',
              files: [],
            },
            issue: {
              number: 1,
              title: 'Improve onboarding',
              status: 'open',
              author: 'alice-dev',
              description: 'Describe the onboarding improvement.',
              labels: ['bug'],
              assignees: ['alice-dev'],
              milestone: 'Q3 launch',
              createdAt: '2026-02-01T09:00:00.000Z',
              updatedAt: '2026-02-02T10:00:00.000Z',
              comments: [
                {
                  id: 'comment-1',
                  author: 'cara-writer',
                  body: 'I can help draft the new onboarding guide.',
                  createdAt: '2026-02-02T10:00:00.000Z',
                },
              ],
              activity: [
                { id: 'act-1', type: 'created', author: 'alice-dev', createdAt: '2026-02-01T09:00:00.000Z', label: null, commentId: null },
                { id: 'act-2', type: 'comment', author: 'cara-writer', createdAt: '2026-02-02T10:00:00.000Z', label: null, commentId: 'comment-1' },
              ],
              permissions: { manageMetadata: false },
            },
            labels: [
              { name: 'bug', color: 'd73a4a' },
              { name: 'documentation', color: '0075ca' },
            ],
            milestones: [{ name: 'Q3 launch' }],
          },
        };
      }
      if (url.startsWith('/api/repositories/alice-dev/acme-docs/issues')) {
        return {
          status: 200,
          body: {
            repository: {
              owner: 'alice-dev',
              name: 'acme-docs',
              description: 'Acme documentation and guides',
              visibility: 'public',
              defaultBranch: 'main',
              createdAt: '2026-01-10T09:00:00.000Z',
              updatedAt: '2026-01-15T10:30:00.000Z',
              files: [],
            },
            issues: [
              {
                number: 1,
                title: 'Improve onboarding',
                status: 'open',
                author: 'alice-dev',
                description: 'Describe the onboarding improvement.',
                labels: ['bug'],
                assignees: ['alice-dev'],
                milestone: 'Q3 launch',
                updatedAt: '2026-02-02T10:00:00.000Z',
              },
              {
                number: 2,
                title: 'Legacy welcome text',
                status: 'closed',
                author: 'alice-dev',
                description: 'The legacy welcome text is outdated and should be replaced with an onboarding-focused welcome.',
                labels: ['bug'],
                assignees: [],
                milestone: null,
                updatedAt: '2026-02-04T09:30:00.000Z',
              },
            ],
            labels: [
              { name: 'bug', color: 'd73a4a' },
              { name: 'documentation', color: '0075ca' },
            ],
            milestones: [{ name: 'Q3 launch' }],
          },
        };
      }
      return { status: 404, body: { error: 'Not found' } };
    });

    const user = userEvent.setup();
    window.location.hash = '#/alice-dev/acme-docs/issues';
    render(<App />);

    // The Issues list page shows rows with title links and the Search issues box.
    await screen.findByRole('heading', { name: 'alice-dev/acme-docs' });
    await screen.findByRole('link', { name: 'Improve onboarding' });
    expect(screen.getByRole('link', { name: 'Legacy welcome text' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search issues' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Closed' })).toBeInTheDocument();

    // Clicking the title opens the issue detail page with the saved content.
    await user.click(screen.getByRole('link', { name: 'Improve onboarding' }));
    await screen.findByRole('heading', { name: 'Improve onboarding' });
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Assignees' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Labels' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Milestone' })).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
    expect(screen.getByText('I can help draft the new onboarding guide.')).toBeInTheDocument();
  });
});
