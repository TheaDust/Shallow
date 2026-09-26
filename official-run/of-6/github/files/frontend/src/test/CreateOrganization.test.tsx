import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const signedInSession = () => ({
  status: 200,
  body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-2-1-2 Create an Organization After Authentication', () => {
  it('the Your organizations page exposes the New organization link and the creation form', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      '/api/organizations': () => ({
        status: 200,
        body: { ok: true, organizations: [{ name: 'acme-demo', displayName: 'Acme Demo' }] },
      }),
    });
    navigate('#/organizations');
    render(<App />);

    const newOrgLink = await screen.findByRole('link', { name: 'New organization' });
    expect(newOrgLink).toHaveAttribute('href', '#/new-organization');
    await user.click(newOrgLink);

    expect(await screen.findByRole('button', { name: 'Create organization' })).toBeEnabled();
    expect(screen.getByLabelText('Organization name')).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/new-organization');
  });

  it('creating a unique organization redirects to its overview heading and the list contains it', async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetch({
      '/api/auth/session': signedInSession,
      'POST /api/organizations': () => ({
        status: 201,
        body: {
          ok: true,
          organization: {
            name: 'mobile-guild',
            displayName: 'Mobile Guild',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      '/api/organizations/mobile-guild': () => ({
        status: 200,
        body: {
          ok: true,
          organization: {
            name: 'mobile-guild',
            displayName: 'Mobile Guild',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      '/api/organizations/mobile-guild/repositories': () => ({
        status: 200,
        body: { ok: true, repositories: [] },
      }),
      '/api/organizations': () => ({
        status: 200,
        body: {
          ok: true,
          organizations: [
            { name: 'acme-demo', displayName: 'Acme Demo' },
            { name: 'mobile-guild', displayName: 'Mobile Guild' },
          ],
        },
      }),
    });

    navigate('#/new-organization');
    render(<App />);

    await user.type(await screen.findByLabelText('Organization name'), 'mobile-guild');
    await user.type(screen.getByLabelText('Display name'), 'Mobile Guild');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));

    // The overview heading contains the organization identifier.
    expect(await screen.findByRole('heading', { name: 'mobile-guild' })).toBeInTheDocument();
    expect(screen.getByText('Mobile Guild')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/organizations/mobile-guild');

    const postCalls = fetchSpy.mock.calls.filter(
      (call) => String(call[0]) === '/api/organizations' && call[1]?.method === 'POST'
    );
    expect(postCalls.length).toBe(1);
    expect(JSON.parse(String(postCalls[0][1]?.body))).toEqual({
      name: 'mobile-guild',
      displayName: 'Mobile Guild',
    });
  });

  it('a duplicate identifier shows the conflict even when the display name is missing and stays on the form', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      'POST /api/organizations': () => ({
        status: 400,
        body: {
          ok: false,
          errors: {
            name: 'Organization name already exists',
            displayName: 'Display name is required',
          },
        },
      }),
    });
    navigate('#/new-organization');
    render(<App />);

    await user.type(await screen.findByLabelText('Organization name'), 'acme-demo');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByText('Organization name already exists')).toBeInTheDocument();
    expect(screen.getByText('Display name is required')).toBeInTheDocument();
    // Inputs are retained and the creation page is still open.
    expect(screen.getByLabelText('Organization name')).toHaveValue('acme-demo');
    expect(screen.getByRole('heading', { name: 'Create new organization' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/new-organization');
  });

  it('a malformed identifier is rejected with the format message', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      'POST /api/organizations': () => ({
        status: 400,
        body: { ok: false, errors: { name: 'Organization name format is invalid' } },
      }),
    });
    navigate('#/new-organization');
    render(<App />);

    await user.type(await screen.findByLabelText('Organization name'), '-invalid-organization');
    await user.type(screen.getByLabelText('Display name'), 'Mobile Guild');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByText('Organization name format is invalid')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveValue('-invalid-organization');
    expect(screen.getByRole('heading', { name: 'Create new organization' })).toBeInTheDocument();
  });

  it('a whitespace-only display name is rejected with the required message', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/auth/session': signedInSession,
      'POST /api/organizations': () => ({
        status: 400,
        body: { ok: false, errors: { displayName: 'Display name is required' } },
      }),
    });
    navigate('#/new-organization');
    render(<App />);

    await user.type(await screen.findByLabelText('Organization name'), 'mobile-guild');
    await user.type(screen.getByLabelText('Display name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByText('Display name is required')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create new organization' })).toBeInTheDocument();
  });

  it('an unauthenticated visitor is redirected from the creation page to sign-in', async () => {
    mockFetch({
      '/api/auth/session': () => ({ status: 200, body: { authenticated: false } }),
    });
    navigate('#/new-organization');
    render(<App />);

    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/signin');
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
  });
});
