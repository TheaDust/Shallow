import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IssueDetailPage from './IssueDetailPage';
import type { IssueDetail, RepoLabel, RepoMilestone, RepositoryDetail } from '../api';

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

const LABELS: RepoLabel[] = [
  { name: 'bug', color: 'd73a4a' },
  { name: 'documentation', color: '0075ca' },
];

const MILESTONES: RepoMilestone[] = [{ name: 'Q3 launch' }, { name: 'v1.0' }];

function makeIssue(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
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
    permissions: { manageMetadata: true, canEditContent: true },
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubDetail(issue: IssueDetail) {
  const current = { issue };
  let activitySeq = 100;
  const base = '/api/repositories/alice-dev/acme-docs/issues/1';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === base && (!init?.method || init.method === 'GET')) {
        return json({ repository: REPOSITORY, issue: current.issue, labels: LABELS, milestones: MILESTONES });
      }
      if (url === `${base}/labels` && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        current.issue = { ...current.issue, labels: body.labels };
        return json({ issue: current.issue });
      }
      if (url === base && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        if (body.title !== undefined) {
          const title = body.title.trim();
          if (!title) {
            return json({ error: 'Issue update failed', fieldErrors: { title: 'Title is required' } }, 422);
          }
          if (title.length > 256) {
            return json({ error: 'Issue update failed', fieldErrors: { title: 'Title is too long' } }, 422);
          }
          current.issue = {
            ...current.issue,
            title,
            activity: [
              ...current.issue.activity,
              { id: 'act-title', type: 'title_edited', author: 'alice-dev', createdAt: '2026-02-03T09:00:00.000Z', label: null, commentId: null, value: title },
            ],
          };
        }
        if (body.description !== undefined) {
          current.issue = {
            ...current.issue,
            description: body.description,
            activity: [
              ...current.issue.activity,
              { id: 'act-desc', type: 'description_edited', author: 'alice-dev', createdAt: '2026-02-03T09:01:00.000Z', label: null, commentId: null, value: body.description },
            ],
          };
        }
        return json({ issue: current.issue });
      }
      if (url === `${base}/milestone` && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        current.issue = {
          ...current.issue,
          milestone: body.milestone,
          activity: [
            ...current.issue.activity,
            { id: `act-milestone-${activitySeq++}`, type: 'milestone_changed', author: 'alice-dev', createdAt: '2026-02-03T09:02:00.000Z', label: null, commentId: null, milestone: body.milestone },
          ],
        };
        return json({ issue: current.issue });
      }
      if (url === `${base}/status` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        current.issue = {
          ...current.issue,
          status: body.status,
          activity: [
            ...current.issue.activity,
            { id: `act-${body.status}`, type: body.status === 'closed' ? 'closed' : 'reopened', author: 'alice-dev', createdAt: '2026-02-03T09:03:00.000Z', label: null, commentId: null },
          ],
        };
        return json({ issue: current.issue });
      }
      return json({ error: 'Not found' }, 404);
    })
  );
  return current;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('IssueDetailPage', () => {
  it('displays number, title heading, status, description, metadata, comments and activity', async () => {
    stubDetail(makeIssue());
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />);

    await screen.findByRole('heading', { name: 'Improve onboarding' });
    expect(screen.getByRole('heading', { name: 'Improve onboarding' }).tagName).toBe('H1');
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Describe the onboarding improvement.')).toBeInTheDocument();

    // Right-side metadata in order: Assignees, Labels, Milestone.
    expect(screen.getByRole('heading', { name: 'Assignees' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Labels' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Milestone' })).toBeInTheDocument();
    expect(screen.getByText('alice-dev')).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();

    // Discussion: comment author/body and chronological creation + comment activities.
    expect(screen.getByRole('heading', { name: 'Comments' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('cara-writer')).toBeInTheDocument();
    expect(screen.getByText('I can help draft the new onboarding guide.')).toBeInTheDocument();
    expect(screen.getByText('alice-dev created this issue')).toBeInTheDocument();
    expect(screen.getByText('cara-writer commented')).toBeInTheDocument();
  });

  it('closed issue shows Closed status text', async () => {
    stubDetail(makeIssue({ status: 'closed', labels: ['bug'] }));
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />);
    await screen.findByRole('heading', { name: 'Improve onboarding' });
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('opens the Labels picker, applies bug, closes it and reloads the saved state', async () => {
    const current = stubDetail(makeIssue({ labels: [] }));
    const user = userEvent.setup();
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />);

    await screen.findByRole('heading', { name: 'Improve onboarding' });
    expect(screen.getByText('None yet')).toBeInTheDocument();

    const labelsButton = screen.getByRole('button', { name: 'Labels' });
    expect(labelsButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(labelsButton);
    expect(labelsButton).toHaveAttribute('aria-expanded', 'true');

    // Options are named exactly after the current repository's label names.
    const bugOption = screen.getByRole('option', { name: 'bug' });
    expect(screen.getByRole('option', { name: 'documentation' })).toBeInTheDocument();
    await user.click(bugOption);

    // The association is saved, the picker closes, and the badge is visible.
    expect(current.issue.labels).toEqual(['bug']);
    expect(screen.queryByRole('option', { name: 'bug' })).not.toBeInTheDocument();
    expect(await screen.findByText('bug')).toBeInTheDocument();
  });

  it('read and write users only view: edit and metadata controls are unavailable', async () => {
    stubDetail(makeIssue({ permissions: { manageMetadata: false, canEditContent: false } }));
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />);
    await screen.findByRole('heading', { name: 'Improve onboarding' });
    expect(screen.queryByRole('button', { name: 'Edit issue title' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit issue description' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Labels' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Milestone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close issue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen issue' })).not.toBeInTheDocument();
    // The label badge and milestone value remain visible for viewing.
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
  });

  it('write users see content edit controls but not metadata or status controls', async () => {
    stubDetail(makeIssue({ permissions: { manageMetadata: false, canEditContent: true } }));
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />);
    await screen.findByRole('heading', { name: 'Improve onboarding' });
    expect(screen.getByRole('button', { name: 'Edit issue title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit issue description' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Labels' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Milestone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close issue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen issue' })).not.toBeInTheDocument();
  });

  it('edits the title and description: heading and body update and activities are recorded', async () => {
    const current = stubDetail(makeIssue());
    const user = userEvent.setup();
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />);

    await screen.findByRole('heading', { name: 'Improve onboarding' });

    // Edit the title through the labelled form and Save issue title button.
    await user.click(screen.getByRole('button', { name: 'Edit issue title' }));
    const titleBox = screen.getByRole('textbox', { name: 'Issue title' });
    expect(titleBox).toHaveValue('Improve onboarding');
    await user.clear(titleBox);
    await user.type(titleBox, 'Improved onboarding guide');
    await user.click(screen.getByRole('button', { name: 'Save issue title' }));

    expect(current.issue.title).toBe('Improved onboarding guide');
    expect(await screen.findByRole('heading', { name: 'Improved onboarding guide' })).toBeInTheDocument();
    expect(screen.getByText('alice-dev edited the title')).toBeInTheDocument();

    // Edit the description through the labelled form and Save issue description button.
    await user.click(screen.getByRole('button', { name: 'Edit issue description' }));
    const descriptionBox = screen.getByRole('textbox', { name: 'Issue description' });
    expect(descriptionBox).toHaveValue('Describe the onboarding improvement.');
    await user.clear(descriptionBox);
    await user.type(descriptionBox, 'A brand new description.');
    await user.click(screen.getByRole('button', { name: 'Save issue description' }));

    expect(current.issue.description).toBe('A brand new description.');
    expect(await screen.findByText('A brand new description.')).toBeInTheDocument();
    expect(screen.getByText('alice-dev edited the description')).toBeInTheDocument();

    // Status, labels, assignees and milestone are untouched.
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('alice-dev')).toBeInTheDocument();
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
  });

  it('rejects a blank title with "Title is required" and keeps the original heading', async () => {
    const current = stubDetail(makeIssue());
    const user = userEvent.setup();
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />);

    await screen.findByRole('heading', { name: 'Improve onboarding' });
    await user.click(screen.getByRole('button', { name: 'Edit issue title' }));
    const titleBox = screen.getByRole('textbox', { name: 'Issue title' });
    await user.clear(titleBox);
    await user.click(screen.getByRole('button', { name: 'Save issue title' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Title is required');
    expect(current.issue.title).toBe('Improve onboarding');
    expect(screen.getByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
  });

  it('selects a milestone and then None, closing the picker after each save', async () => {
    const current = stubDetail(makeIssue());
    const user = userEvent.setup();
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />);

    await screen.findByRole('heading', { name: 'Improve onboarding' });
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();

    const milestoneButton = screen.getByRole('button', { name: 'Milestone' });
    await user.click(milestoneButton);
    const v1Option = screen.getByRole('option', { name: 'v1.0' });
    expect(screen.getByRole('option', { name: 'Q3 launch' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument();
    await user.click(v1Option);

    expect(current.issue.milestone).toBe('v1.0');
    expect(await screen.findByText('v1.0')).toBeInTheDocument();
    expect(screen.getByText('alice-dev set the milestone to v1.0')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'v1.0' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Milestone' }));
    await user.click(screen.getByRole('option', { name: 'None' }));
    expect(current.issue.milestone).toBeNull();
    expect(await screen.findByText('No milestone')).toBeInTheDocument();
    expect(screen.getByText('alice-dev removed the milestone')).toBeInTheDocument();
  });

  it('closes and reopens an issue with status and activity updates', async () => {
    const current = stubDetail(makeIssue());
    const user = userEvent.setup();
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="1" />);

    await screen.findByRole('heading', { name: 'Improve onboarding' });
    const closeButton = screen.getByRole('button', { name: 'Close issue' });
    await user.click(closeButton);

    expect(current.issue.status).toBe('closed');
    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('alice-dev closed issue #1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen issue' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reopen issue' }));
    expect(current.issue.status).toBe('open');
    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(screen.getByText('alice-dev reopened issue #1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close issue' })).toBeInTheDocument();
  });

  it('shows Issue not found for a missing or inaccessible issue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'Not found' }, 404))
    );
    render(<IssueDetailPage owner="alice-dev" name="acme-docs" number="99" />);
    await screen.findByRole('heading', { name: 'Issue not found' });
  });
});
