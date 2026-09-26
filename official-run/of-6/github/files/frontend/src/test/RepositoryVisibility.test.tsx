import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const secretResearch = (visibility: 'public' | 'private') => ({
  owner: 'alice-dev',
  ownerType: 'user',
  name: 'secret-research',
  description: 'Confidential research project data',
  visibility,
  defaultBranch: 'main',
  updatedAt: '2026-01-10T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'admin',
});

const secretResearchContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c1' },
    files: [
      {
        path: 'README.md',
        content: '# secret-research\n\nConfidential research project data.\n',
      },
    ],
  },
});

const secretResearchCommits = () => ({
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

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-3-4 Change Repository Visibility with Permission Checks', () => {
  it('an Admin changes a private repository to Public through Settings → General → Danger Zone', async () => {
    const user = userEvent.setup();
    let visibility: 'public' | 'private' = 'private';
    const patchSpy = vi.fn();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/alice-dev/secret-research': () => ({
        status: 200,
        body: { ok: true, repository: secretResearch(visibility) },
      }),
      '/api/repositories/alice-dev/secret-research/contents': secretResearchContents,
      '/api/repositories/alice-dev/secret-research/commits': secretResearchCommits,
      'PATCH /api/repositories/alice-dev/secret-research/visibility': (init) => {
        patchSpy(init);
        const payload = JSON.parse(String(init?.body));
        visibility = payload.visibility;
        return {
          status: 200,
          body: { ok: true, repository: secretResearch(payload.visibility) },
        };
      },
    });

    // The Admin opens the overview of the currently Private repository.
    navigate('#/repositories/alice-dev/secret-research');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'alice-dev/secret-research' })).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Confidential research project data')).toBeInTheDocument();

    // Overview → Settings link → Settings page (General tab).
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    const generalLink = screen.getByRole('link', { name: 'General' });
    expect(generalLink).toHaveAttribute(
      'href',
      '#/repositories/alice-dev/secret-research/settings'
    );
    expect(screen.getByRole('link', { name: 'Manage access' })).toHaveAttribute(
      'href',
      '#/repositories/alice-dev/secret-research/settings/access'
    );

    // Danger Zone with the Change visibility button.
    expect(await screen.findByRole('heading', { name: 'Danger Zone' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change visibility' }));

    // The confirmation dialog provides the Public radio and the Confirm
    // visibility button (plus a confirmation-text field).
    const dialog = await screen.findByRole('dialog', { name: 'Change repository visibility' });
    const publicRadio = within(dialog).getByRole('radio', { name: 'Public' });
    expect(publicRadio).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Private' })).toBeInTheDocument();
    const confirmButton = within(dialog).getByRole('button', { name: 'Confirm visibility' });
    const confirmationInput = within(dialog).getByLabelText('Type the repository name to confirm');

    // Select Public, enter the full repository name, and confirm.
    await user.click(publicRadio);
    expect(publicRadio).toBeChecked();
    await user.type(confirmationInput, 'secret-research');
    await user.click(confirmButton);

    // The change is applied, the dialog closes and the app navigates to the
    // repository overview, which displays the Public marker (server state
    // changed) and the primary Code entry.
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(patchSpy.mock.calls[0][0]?.body))).toEqual({
      visibility: 'public',
      confirmation: 'secret-research',
    });
    expect(await screen.findByRole('heading', { name: 'alice-dev/secret-research' })).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.queryByText('Private')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Code' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'README.md' })).toBeInTheDocument();
  });

  it('a mismatched confirmation text is rejected and the visibility stays Private', async () => {
    const user = userEvent.setup();
    let visibility: 'public' | 'private' = 'private';
    const patchSpy = vi.fn();
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/alice-dev/secret-research': () => ({
        status: 200,
        body: { ok: true, repository: secretResearch(visibility) },
      }),
      'PATCH /api/repositories/alice-dev/secret-research/visibility': (init) => {
        patchSpy(init);
        const payload = JSON.parse(String(init?.body));
        visibility = payload.visibility;
        return {
          status: 200,
          body: { ok: true, repository: secretResearch(payload.visibility) },
        };
      },
    });

    navigate('#/repositories/alice-dev/secret-research/settings');
    render(<App />);
    await screen.findByRole('heading', { name: 'Settings' });
    await user.click(await screen.findByRole('button', { name: 'Change visibility' }));

    const dialog = await screen.findByRole('dialog', { name: 'Change repository visibility' });
    await user.click(within(dialog).getByRole('radio', { name: 'Public' }));
    await user.type(within(dialog).getByLabelText('Type the repository name to confirm'), 'wrong-name');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm visibility' }));

    // The mismatched confirmation is rejected: no request, visible error, the
    // dialog stays open and the repository remains Private.
    expect(await screen.findByText('Repository name does not match')).toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Change repository visibility' })).toBeInTheDocument();
    expect(screen.getByText(/currently Private/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a non-Admin collaborator never sees the Change visibility button (settings page denied)', async () => {
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
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
      '/api/repositories/acme-demo/acme-docs/contents': () => ({
        status: 200,
        body: { ok: true, branch: { name: 'main', headCommitId: 'c1' }, files: [] },
      }),
      '/api/repositories/acme-demo/acme-docs/commits': () => ({
        status: 200,
        body: { ok: true, commits: [] },
      }),
    });

    // The Read collaborator sees no Settings link on the overview.
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);
    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();

    // Opening the settings address directly shows Access denied and never the
    // Change visibility button.
    navigate('#/repositories/acme-demo/acme-docs/settings');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change visibility' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Danger Zone' })).not.toBeInTheDocument();
  });

  it('the successful result remains persisted after refreshing the settings page', async () => {
    const user = userEvent.setup();
    let visibility: 'public' | 'private' = 'private';
    mockFetch({
      '/api/auth/session': () => ({
        status: 200,
        body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
      }),
      '/api/repositories/alice-dev/secret-research': () => ({
        status: 200,
        body: { ok: true, repository: secretResearch(visibility) },
      }),
      'PATCH /api/repositories/alice-dev/secret-research/visibility': (init) => {
        const payload = JSON.parse(String(init?.body));
        visibility = payload.visibility;
        return {
          status: 200,
          body: { ok: true, repository: secretResearch(payload.visibility) },
        };
      },
    });

    navigate('#/repositories/alice-dev/secret-research/settings');
    render(<App />);
    await screen.findByRole('heading', { name: 'Settings' });
    await user.click(await screen.findByRole('button', { name: 'Change visibility' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change repository visibility' });
    await user.click(within(dialog).getByRole('radio', { name: 'Public' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm visibility' }));

    // The successful change navigates to the overview (server state changed).
    expect(await screen.findByRole('heading', { name: 'alice-dev/secret-research' })).toBeInTheDocument();

    // Reopening / refreshing the settings page still shows the persisted
    // Public state (the server is the source of truth).
    navigate('#/repositories/alice-dev/secret-research/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByText(/currently Public/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change visibility' })).toBeInTheDocument();
  });
});
