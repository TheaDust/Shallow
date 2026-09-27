import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IssuesListPage from './IssuesListPage';
import type { IssueSummary, RepoLabel, RepoMilestone, RepositoryDetail } from '../api';
import { parseHash } from '../router';

const REPOSITORY: RepositoryDetail = {
  owner: 'alice-dev',
  name: 'acme-docs',
  description: 'Acme documentation and guides',
  visibility: 'public',
  defaultBranch: 'main',
  createdAt: '2026-01-10T09:00:00.000Z',
  updatedAt: '2026-01-15T10:30:00.000Z',
  files: [],
};

const ISSUES: IssueSummary[] = [
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
  {
    number: 3,
    title: 'Update contribution guidelines',
    status: 'open',
    author: 'alice-dev',
    description: 'The contribution guidelines need a refresh.',
    labels: [],
    assignees: [],
    milestone: null,
    updatedAt: '2026-02-05T11:00:00.000Z',
  },
];

const LABELS: RepoLabel[] = [
  { name: 'bug', color: 'd73a4a' },
  { name: 'documentation', color: '0075ca' },
];

const MILESTONES: RepoMilestone[] = [{ name: 'Q3 launch' }];

function stubIssuesFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/repositories/alice-dev/acme-docs/issues') {
        return new Response(
          JSON.stringify({ repository: REPOSITORY, issues: ISSUES, labels: LABELS, milestones: MILESTONES }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

// Mirrors App's hash routing so URL-driven filters update the page in jsdom.
function Harness({ owner, name }: { owner: string; name: string }) {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return <IssuesListPage owner={owner} name={name} query={route.query} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('IssuesListPage', () => {
  it('renders rows with number, title, status, author, labels and update time', async () => {
    stubIssuesFetch();
    render(<Harness owner="alice-dev" name="acme-docs" />);

    await screen.findByRole('heading', { name: 'alice-dev/acme-docs' });
    // The title link's accessible name is exactly the issue title.
    expect(screen.getByRole('link', { name: 'Improve onboarding' })).toHaveAttribute(
      'href',
      '#/alice-dev/acme-docs/issues/1'
    );
    expect(screen.getByRole('link', { name: '#1' })).toHaveAttribute(
      'href',
      '#/alice-dev/acme-docs/issues/1'
    );
    expect(screen.getByRole('link', { name: 'Legacy welcome text' })).toHaveAttribute(
      'href',
      '#/alice-dev/acme-docs/issues/2'
    );
    // Status, author, labels and update time are visible in each row.
    expect(screen.getAllByText('by alice-dev').length).toBe(3);
    expect(screen.getAllByText('Open').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('bug')).toHaveLength(2);
    expect(screen.getAllByText(/updated Feb/).length).toBe(3);
  });

  it('filters by state links, keyword and label and retains the context in the URL', async () => {
    stubIssuesFetch();
    const user = userEvent.setup();
    window.location.hash = '#/alice-dev/acme-docs/issues';
    render(<Harness owner="alice-dev" name="acme-docs" />);
    await screen.findByRole('link', { name: 'Improve onboarding' });

    // Default (no state filter) shows open and closed rows.
    expect(screen.getByRole('link', { name: 'Legacy welcome text' })).toBeInTheDocument();

    // Open + keyword + bug label: only the matching open issue remains.
    await user.click(screen.getByRole('link', { name: 'Open' }));
    expect(window.location.hash).toContain('state=open');
    expect(screen.queryByRole('link', { name: 'Legacy welcome text' })).not.toBeInTheDocument();

    const searchbox = screen.getByRole('searchbox', { name: 'Search issues' });
    await user.type(searchbox, 'onboarding');
    expect(screen.getByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Update contribution guidelines' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Labels' }));
    await user.click(screen.getByRole('option', { name: 'bug' }));
    expect(screen.getByRole('link', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Update contribution guidelines' })).not.toBeInTheDocument();
    expect(window.location.hash).toContain('labels=bug');

    // After switching to Closed, the open issue is gone and the closed one shows.
    await user.click(screen.getByRole('link', { name: 'Closed' }));
    expect(screen.queryByRole('link', { name: 'Improve onboarding' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Legacy welcome text' })).toBeInTheDocument();
  });

  it('keeps the chosen filter context and matching results after reload', async () => {
    stubIssuesFetch();
    window.location.hash = '#/alice-dev/acme-docs/issues?state=closed&q=Legacy';
    render(<Harness owner="alice-dev" name="acme-docs" />);

    await screen.findByRole('link', { name: 'Legacy welcome text' });
    expect(screen.getByRole('searchbox', { name: 'Search issues' })).toHaveValue('Legacy');
    expect(screen.queryByRole('link', { name: 'Improve onboarding' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Closed' })).toHaveAttribute('aria-current', 'page');
  });
});
