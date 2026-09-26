import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const org = {
  name: 'acme-demo',
  displayName: 'Acme Demo',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const publicRepos = [
  {
    name: 'acme-docs',
    description: 'Documentation for the Acme platform',
    visibility: 'public',
    updatedAt: '2026-01-10T00:00:00.000Z',
  },
];

const allRepos = [
  ...publicRepos,
  {
    name: 'acme-internal',
    description: 'Internal engineering notes and plans',
    visibility: 'private',
    updatedAt: '2026-01-08T00:00:00.000Z',
  },
];

const people = [
  { username: 'alice-dev', role: 'owner' },
  { username: 'bob-reviewer', role: 'member' },
];

const teams = [{ name: 'frontend-team', description: 'Frontend engineering team', parentTeamName: null }];

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-2-1-1 Browse Organization Repositories (visitor)', () => {
  beforeEach(() => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
      '/api/organizations/acme-demo': () => ({ status: 200, body: { ok: true, organization: org } }),
      // The server filters by permission: a visitor never receives the private repo.
      '/api/organizations/acme-demo/repositories': () => ({
        status: 200,
        body: { ok: true, repositories: publicRepos },
      }),
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: {
          ok: true,
          repository: {
            owner: 'acme-demo',
            ownerType: 'organization',
            name: 'acme-docs',
            description: 'Documentation for the Acme platform',
            visibility: 'public',
            defaultBranch: 'main',
            updatedAt: '2026-01-10T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            role: 'read',
          },
        },
      }),
      '/api/repositories/acme-demo/acme-internal': () => ({
        status: 403,
        body: { error: 'Access denied' },
      }),
    });
  });

  it('renders the organization overview heading, display name, tab links, and repository filter', async () => {
    navigate('#/organizations/acme-demo');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'acme-demo' })).toBeInTheDocument();
    expect(await screen.findByText('Acme Demo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Repositories' })).toHaveAttribute(
      'href',
      '#/organizations/acme-demo'
    );
    expect(screen.getByRole('link', { name: 'People' })).toHaveAttribute(
      'href',
      '#/organizations/acme-demo/people'
    );
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute(
      'href',
      '#/organizations/acme-demo/teams'
    );
    expect(screen.getByLabelText('Find a repository')).toBeInTheDocument();
    const typeSelect = screen.getByRole('combobox', { name: 'Type' });
    expect(typeSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Public' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Private' })).toBeInTheDocument();
  });

  it('shows only the public repository to a visitor; the private name never appears', async () => {
    navigate('#/organizations/acme-demo');
    render(<App />);

    const docsLink = await screen.findByRole('link', { name: 'acme-docs' });
    expect(docsLink).toHaveAttribute('href', '#/repositories/acme-demo/acme-docs');
    expect(screen.getByText('Documentation for the Acme platform')).toBeInTheDocument();
    expect(screen.getAllByText('Public').length).toBeGreaterThan(0);
    expect(screen.getByText(/^Updated/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'acme-internal' })).not.toBeInTheDocument();
  });

  it('filters as the user types and keeps the private repository hidden', async () => {
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo');
    render(<App />);

    await screen.findByRole('link', { name: 'acme-docs' });
    const filter = screen.getByLabelText('Find a repository');

    // Filtering by the exact private repository name never exposes its link.
    await user.type(filter, 'acme-internal');
    expect(screen.queryByRole('link', { name: 'acme-internal' })).not.toBeInTheDocument();
    expect(screen.getByText('No repositories found.')).toBeInTheDocument();

    // Entering the full public name keeps the public result available.
    await user.clear(filter);
    await user.type(filter, 'acme-docs');
    expect(screen.getByRole('link', { name: 'acme-docs' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'acme-internal' })).not.toBeInTheDocument();
  });

  it('clicking the repository name opens the overview titled organization name/repository name', async () => {
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo');
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'acme-docs' }));

    expect(await screen.findByRole('heading', { name: 'acme-demo/acme-docs' })).toBeInTheDocument();
    expect(screen.getByText('Documentation for the Acme platform')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs');
  });

  it('a visitor directly opening the private repository sees Access denied and a Sign in entry', async () => {
    navigate('#/repositories/acme-demo/acme-internal');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '#/signin');
  });
});

describe('REQ-2-1-1 Browse Organization Repositories (signed-in Owner)', () => {
  beforeEach(() => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/organizations/acme-demo': () => ({ status: 200, body: { ok: true, organization: org } }),
      '/api/organizations/acme-demo/repositories': () => ({
        status: 200,
        body: { ok: true, repositories: allRepos },
      }),
      '/api/organizations/acme-demo/people': () => ({ status: 200, body: { ok: true, members: people } }),
      '/api/organizations/acme-demo/teams': () => ({ status: 200, body: { ok: true, teams } }),
      '/api/organizations': () => ({
        status: 200,
        body: { ok: true, organizations: [{ name: 'acme-demo', displayName: 'Acme Demo' }] },
      }),
      '/api/repositories/acme-demo/acme-docs': () => ({
        status: 200,
        body: {
          ok: true,
          repository: {
            owner: 'acme-demo',
            ownerType: 'organization',
            name: 'acme-docs',
            description: 'Documentation for the Acme platform',
            visibility: 'public',
            defaultBranch: 'main',
            updatedAt: '2026-01-10T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            role: 'read',
          },
        },
      }),
    });
  });

  it('the account menu exposes Your organizations and the page lists the organization', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('link', { name: 'Your organizations' }));

    // The list entry keeps the identifier-named link and adds the display-name
    // link (REQ-2-2-1 acceptance opens the organization through “Acme Demo”).
    const orgLink = await screen.findByRole('link', { name: 'acme-demo' });
    expect(orgLink).toHaveAttribute('href', '#/organizations/acme-demo');
    const displayNameLink = screen.getByRole('link', { name: /^Acme Demo$/ });
    expect(displayNameLink).toHaveAttribute('href', '#/organizations/acme-demo');
    expect(window.location.hash).toBe('#/organizations');
  });

  it('the signed-in Owner sees the private repository and the Public filter narrows the list', async () => {
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo');
    render(<App />);

    await screen.findByRole('link', { name: 'acme-docs' });
    expect(screen.getByRole('link', { name: 'acme-internal' })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'Public');
    expect(screen.getByRole('link', { name: 'acme-docs' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'acme-internal' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'Private');
    expect(screen.queryByRole('link', { name: 'acme-docs' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'acme-internal' })).toBeInTheDocument();
  });

  it('the People tab lists members with their Member/Owner roles and the Teams tab lists teams', async () => {
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo');
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'People' }));
    expect((await screen.findAllByText('alice-dev')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('bob-reviewer')).toBeInTheDocument();
    expect(screen.getAllByText('Owner').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Member').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('link', { name: 'Teams' }));
    expect(await screen.findByText('frontend-team')).toBeInTheDocument();
  });

  it('after navigating back to the organization page the public result remains available', async () => {
    const user = userEvent.setup();
    navigate('#/organizations/acme-demo');
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'acme-docs' }));
    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });

    // Browser back keeps the public result available.
    navigate('#/organizations/acme-demo');
    expect(await screen.findByRole('link', { name: 'acme-docs' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/organizations/acme-demo'));
  });
});
