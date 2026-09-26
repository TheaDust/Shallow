import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import CloneMenu, { cloneUrls } from '../components/CloneMenu';

const acmeDocsOverview = {
  owner: 'acme-demo',
  ownerType: 'organization',
  name: 'acme-docs',
  description: 'Documentation for the Acme platform',
  visibility: 'public',
  defaultBranch: 'main',
  updatedAt: '2026-01-10T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'read',
};

const acmeDocsContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c1' },
    files: [{ path: 'README.md', content: '# acme-docs\n\nDocumentation for the Acme platform.\n' }],
  },
});

const acmeDocsCommits = () => ({
  status: 200,
  body: {
    ok: true,
    commits: [
      {
        id: 'c1',
        message: 'Initial commit',
        author: 'alice-dev',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
});

const secretResearchOverview = {
  owner: 'alice-dev',
  ownerType: 'user',
  name: 'secret-research',
  description: 'Confidential research project data',
  visibility: 'private',
  defaultBranch: 'main',
  updatedAt: '2026-01-05T00:00:00.000Z',
  createdAt: '2026-01-02T00:00:00.000Z',
  role: 'admin',
};

const secretResearchContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 's1' },
    files: [],
  },
});

const secretResearchCommits = () => ({
  status: 200,
  body: { ok: true, commits: [] },
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

/**
 * Reads the clipboard through the Clipboard API installed by the environment
 * (userEvent attaches its own stub on setup, so the value the component
 * actually wrote can be asserted end to end).
 */
async function clipboardText(): Promise<string> {
  const clipboard = (navigator as unknown as { clipboard?: { readText?: () => Promise<string> } }).clipboard;
  if (!clipboard || typeof clipboard.readText !== 'function') {
    return '';
  }
  return clipboard.readText();
}

function mockOverviewRoutes(authenticated = false) {
  mockFetch({
    '/api/auth/session': () => ({
      status: 200,
      body: authenticated
        ? { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' }
        : { authenticated: false },
    }),
    '/api/repositories/acme-demo/acme-docs': () => ({
      status: 200,
      body: { ok: true, repository: acmeDocsOverview },
    }),
    '/api/repositories/acme-demo/acme-docs/contents': acmeDocsContents,
    '/api/repositories/acme-demo/acme-docs/commits': acmeDocsCommits,
    '/api/repositories/acme-demo/acme-docs/contents/main/README.md': () => ({
      status: 200,
      body: {
        ok: true,
        branch: 'main',
        file: { path: 'README.md', content: '# acme-docs\n\nDocumentation for the Acme platform.\n' },
      },
    }),
    '/api/repositories/alice-dev/secret-research': () => ({
      status: authenticated ? 200 : 403,
      body: authenticated
        ? { ok: true, repository: secretResearchOverview }
        : { error: 'Access denied' },
    }),
    '/api/repositories/alice-dev/secret-research/contents': secretResearchContents,
    '/api/repositories/alice-dev/secret-research/commits': secretResearchCommits,
  });
}

describe('REQ-3-2-3 Copy a Repository Clone Value - value format', () => {
  it('builds HTTPS and SSH clone values that identify the repository', () => {
    const values = cloneUrls('acme-demo', 'acme-docs');
    // HTTPS uses the HTTPS protocol and identifies the repository.
    expect(values.https).toBe('https://github.com/acme-demo/acme-docs.git');
    expect(values.https.startsWith('https://')).toBe(true);
    expect(values.https.endsWith('.git')).toBe(true);
    // SSH uses the SSH format including the colon and the .git suffix.
    expect(values.ssh).toBe('git@github.com:acme-demo/acme-docs.git');
    expect(values.ssh).toContain(':');
    expect(values.ssh.endsWith('.git')).toBe(true);
    expect(values.ssh).toContain('acme-demo/acme-docs');
  });

  it('uses the current repository identity for other repositories', () => {
    const values = cloneUrls('alice-dev', 'secret-research');
    expect(values.https).toBe('https://github.com/alice-dev/secret-research.git');
    expect(values.ssh).toBe('git@github.com:alice-dev/secret-research.git');
  });
});

describe('REQ-3-2-3 Copy a Repository Clone Value - Scenario 1 (visitor)', () => {
  beforeEach(() => {
    mockOverviewRoutes(false);
  });

  it('opens the clone popover from the Code button, switches protocol and copies the value', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    // The clone-menu Code button is distinct from the navigation Code link.
    const codeLink = await screen.findByRole('link', { name: 'Code' });
    expect(codeLink).toHaveAttribute('href', '#/repositories/acme-demo/acme-docs');
    const codeButton = screen.getByRole('button', { name: 'Code' });
    expect(codeButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(codeButton);
    expect(codeButton).toHaveAttribute('aria-expanded', 'true');

    // Protocol controls are tabs "HTTPS" and "SSH"; HTTPS is selected first.
    const httpsTab = screen.getByRole('tab', { name: 'HTTPS' });
    const sshTab = screen.getByRole('tab', { name: 'SSH' });
    expect(httpsTab).toHaveAttribute('aria-selected', 'true');
    expect(sshTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('https://github.com/acme-demo/acme-docs.git')).toBeInTheDocument();

    // Selecting SSH switches the clone value to the SSH format.
    await user.click(sshTab);
    expect(sshTab).toHaveAttribute('aria-selected', 'true');
    expect(httpsTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('git@github.com:acme-demo/acme-docs.git')).toBeInTheDocument();
    expect(screen.queryByText('https://github.com/acme-demo/acme-docs.git')).not.toBeInTheDocument();

    // The copy control to the right of the value writes the complete selected
    // value to the clipboard and displays "Copied".
    const copyButton = screen.getByRole('button', { name: 'Copy clone value' });
    await user.click(copyButton);
    expect(await clipboardText()).toBe('git@github.com:acme-demo/acme-docs.git');
    expect(await screen.findByText('Copied')).toBeInTheDocument();

    // The repository heading stays visible and files/commits/visibility are
    // unchanged by the read-only copy operation.
    expect(screen.getByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText('1 commit')).toBeInTheDocument();
  });

  it('keeps the selected protocol and repository heading after closing and reopening the menu', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    const codeButton = await screen.findByRole('button', { name: 'Code' });
    await user.click(codeButton);
    await user.click(screen.getByRole('tab', { name: 'SSH' }));
    expect(screen.getByRole('tab', { name: 'SSH' })).toHaveAttribute('aria-selected', 'true');

    // Close and reopen the popover: the SSH protocol stays selected.
    await user.click(codeButton);
    expect(codeButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tab', { name: 'SSH' })).not.toBeInTheDocument();
    await user.click(codeButton);
    expect(codeButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tab', { name: 'SSH' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'HTTPS' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('git@github.com:acme-demo/acme-docs.git')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
  });

  it('a visitor without access to a private repository cannot enter the page or obtain its clone value', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/alice-dev/secret-research');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '#/signin');
    expect(screen.queryByRole('button', { name: 'Code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Code' })).not.toBeInTheDocument();
    expect(screen.queryByText(/secret-research\.git/)).not.toBeInTheDocument();
    void user;
  });
});

describe('REQ-3-2-3 Copy a Repository Clone Value - Scenario 2 (signed in)', () => {
  beforeEach(() => {
    mockOverviewRoutes(true);
  });

  it('a signed-in owner copies the clone value of their permitted private repository', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/alice-dev/secret-research');
    render(<App />);

    // The overview of the private repository the user may view is accessible
    // and shows the clone controls.
    expect(await screen.findByRole('heading', { name: 'alice-dev/secret-research' })).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();

    const codeButton = screen.getByRole('button', { name: 'Code' });
    await user.click(codeButton);
    expect(screen.getByText('https://github.com/alice-dev/secret-research.git')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'SSH' }));
    await user.click(screen.getByRole('button', { name: 'Copy clone value' }));
    expect(await clipboardText()).toBe('git@github.com:alice-dev/secret-research.git');
    expect(await screen.findByText('Copied')).toBeInTheDocument();

    // After refreshing (reopening) the destination, the same clone values
    // remain available for the workflow.
    navigate('#/repositories/alice-dev/secret-research');
    expect(await screen.findByRole('heading', { name: 'alice-dev/secret-research' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Code' })).toBeInTheDocument();
  });

  it('a rejected clipboard write shows the failure state and leaves the original state unchanged', async () => {
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Code' }));

    // Override the clipboard after userEvent.setup() (which installs its own
    // always-succeeding stub) with a rejecting writer.
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    await user.click(screen.getByRole('button', { name: 'Copy clone value' }));

    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    // The repository page state is unchanged.
    expect(screen.getByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument();
  });
});

describe('CloneMenu unit behavior', () => {
  it('renders without the popover until the Code button is activated', () => {
    render(<CloneMenu owner="acme-demo" name="acme-docs" />);
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tab', { name: 'HTTPS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy clone value' })).not.toBeInTheDocument();
  });
});
