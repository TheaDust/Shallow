import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';
import type { IssueDetail } from '../types';

const seedComment = {
  id: 'comment-1',
  author: 'alice-dev',
  body: 'Good idea — I will prepare the improved onboarding checklist.',
  createdAt: '2026-01-18T00:00:00.000Z',
  reactions: [],
};

const seededIssue: IssueDetail = {
  number: 1,
  title: 'Improve onboarding',
  state: 'open',
  author: 'alice-dev',
  body: 'Describe the onboarding improvement.',
  labels: ['bug', 'documentation'],
  milestone: { title: 'Q3 launch' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-18T00:00:00.000Z',
  closedAt: null,
  assignees: ['alice-dev'],
  comments: [structuredClone(seedComment)],
  activity: [
    { type: 'created', actor: 'alice-dev', createdAt: '2026-01-01T00:00:00.000Z' },
    {
      type: 'commented',
      actor: 'alice-dev',
      createdAt: '2026-01-18T00:00:00.000Z',
      body: seedComment.body,
      commentId: seedComment.id,
    },
  ],
  reactions: [],
};

type Route = (init?: RequestInit) => { status: number; body: unknown };

/**
 * A mutable in-memory “server” for the REQ-5-2-3 tests, shared across renders
 * within one test: the GET returns the current record; a successful comment
 * POST appends the comment and its `commented` activity; a reaction POST
 * toggles the association for the current user (add → remove). Rejected
 * submissions change nothing, exactly like the real backend.
 */
function commentRoutes(): Record<string, Route> {
  const current: Record<number, IssueDetail> = {
    1: structuredClone(seededIssue),
  };
  let nextCommentId = 2;
  const username = 'alice-dev';
  const now = '2026-01-22T00:00:00.000Z';

  const toggleReaction = (
    issue: IssueDetail,
    targetType: 'issue' | 'comment',
    targetId: string,
    reaction: string
  ) => {
    const list =
      targetType === 'issue'
        ? (issue as { reactions: { reaction: string; count: number; reactedByMe: boolean }[] })
        : issue.comments.find((c) => c.id === targetId);
    if (!list) {
      return { status: 404, body: { error: 'Comment not found' } };
    }
    const groups = list.reactions as { reaction: string; count: number; reactedByMe: boolean }[];
    const existing = groups.find((g) => g.reaction === reaction);
    if (existing && existing.reactedByMe) {
      if (existing.count === 1) {
        list.reactions = groups.filter((g) => g.reaction !== reaction);
      } else {
        existing.count -= 1;
        existing.reactedByMe = false;
      }
    } else if (existing) {
      existing.count += 1;
      existing.reactedByMe = true;
    } else {
      groups.push({ reaction, count: 1, reactedByMe: true });
    }
    return { status: 200, body: { ok: true, issue, role: 'admin' } };
  };

  const detailRoute = (role: string) => (init?: RequestInit) => {
    if (init?.method === 'POST') {
      const payload = JSON.parse(String(init.body ?? '{}'));
      if (Object.prototype.hasOwnProperty.call(payload, 'body')) {
        const body = String(payload.body ?? '');
        if (body.trim() === '') {
          return { status: 400, body: { ok: false, errors: { body: 'Comment is required' } } };
        }
        if (body.length > 65536) {
          return { status: 400, body: { ok: false, errors: { body: 'Comment is too long' } } };
        }
        const issue = current[1];
        issue.comments.push({
          id: `comment-${nextCommentId}`,
          author: username,
          body: body.trim(),
          createdAt: now,
          reactions: [],
        });
        issue.activity.push({
          type: 'commented',
          actor: username,
          createdAt: now,
          body: body.trim(),
          commentId: `comment-${nextCommentId}`,
        });
        issue.updatedAt = now;
        nextCommentId += 1;
        return { status: 201, body: { ok: true, issue, role } };
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'reaction')) {
        // reaction on the issue itself
        return toggleReaction(current[1], 'issue', String(current[1].number), String(payload.reaction));
      }
      return { status: 400, body: { ok: false, errors: { body: 'Comment is required' } } };
    }
    return { status: 200, body: { ok: true, issue: current[1], role } };
  };

  return {
    '/api/auth/session': () => ({ status: 200, body: { authenticated: true, username, email: 'alice-dev@example.test' } }),
    '/api/repositories/acme-demo/acme-docs/issues/1': detailRoute('admin'),
    'POST /api/repositories/acme-demo/acme-docs/issues/1/comments': detailRoute('admin'),
    'POST /api/repositories/acme-demo/acme-docs/issues/1/reactions': detailRoute('admin'),
    'POST /api/repositories/acme-demo/acme-docs/issues/1/comments/comment-1/reactions': (init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}'));
      return toggleReaction(current[1], 'comment', 'comment-1', String(payload.reaction));
    },
    'POST /api/repositories/acme-demo/acme-docs/issues/1/comments/comment-2/reactions': (init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}'));
      return toggleReaction(current[1], 'comment', 'comment-2', String(payload.reaction));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-5-2-3 Comment on an Issue Discussion', () => {
  it('Scenario 1: a signed-in Write/Maintain/Admin user appends a comment and toggles a reaction on the existing comment; both survive reload', async () => {
    const user = userEvent.setup();
    const routes = commentRoutes();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const first = render(<App />);

    // The comment editor is labeled “Comment” and its submit button is named
    // exactly “Comment”.
    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    const commentBox = screen.getByLabelText('Comment');
    expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument();

    // Enter a non-empty trimmed comment and click “Comment”.
    await user.type(commentBox, '  This is my new comment.  ');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    // The timeline appends the comment displaying the current user, body,
    // and creation time.
    expect(await screen.findByText('This is my new comment.')).toBeInTheDocument();
    const newCommentArticle = screen.getAllByRole('article').find((article) =>
      within(article).queryByText('This is my new comment.')
    );
    expect(newCommentArticle).toBeTruthy();
    expect(within(newCommentArticle!).getByText(/alice-dev commented/)).toBeInTheDocument();
    // The discussion count reflects the appended comment.
    expect(screen.getByText('2 comments')).toBeInTheDocument();

    // The existing (seed) comment carries a reaction menu; select a reaction
    // and the target comment displays the reaction and its count.
    const seedArticle = screen.getAllByRole('article').find((article) =>
      within(article).queryByText(seedComment.body)
    );
    expect(seedArticle).toBeTruthy();
    await user.click(within(seedArticle!).getByRole('button', { name: 'Add reaction' }));
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: '👍 Thumbs up' })
    );
    expect(await within(seedArticle!).findByRole('button', { name: '👍 1' })).toBeInTheDocument();
    expect(within(seedArticle!).getByRole('button', { name: '👍 1' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // The same user selecting the same reaction again removes the association
    // (no duplicate reaction is created).
    await user.click(within(seedArticle!).getByRole('button', { name: 'Add reaction' }));
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: '👍 Thumbs up' })
    );
    expect(within(seedArticle!).queryByRole('button', { name: '👍 1' })).not.toBeInTheDocument();

    // After refreshing the detail page, the comment and a re-added reaction
    // still exist.
    await user.click(within(seedArticle!).getByRole('button', { name: 'Add reaction' }));
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: '👍 Thumbs up' })
    );
    expect(await within(seedArticle!).findByRole('button', { name: '👍 1' })).toBeInTheDocument();

    first.unmount();
    vi.unstubAllGlobals();
    mockFetch(routes);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByText('This is my new comment.')).toBeInTheDocument();
    const reloadedSeedArticle = screen.getAllByRole('article').find((article) =>
      within(article).queryByText(seedComment.body)
    );
    expect(within(reloadedSeedArticle!).getByRole('button', { name: '👍 1' })).toBeInTheDocument();
  });

  it('Scenario 2: whitespace-only text shows “Comment is required” and creates no comment or timeline record; the count is unchanged after reload', async () => {
    const user = userEvent.setup();
    const routes = commentRoutes();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    const first = render(<App />);

    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByText('1 comment')).toBeInTheDocument();
    const commentBox = screen.getByLabelText('Comment');

    // Enter only whitespace characters and attempt to submit.
    await user.type(commentBox, '   ');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    // The system creates no new comment or timeline record.
    expect(await screen.findByText('Comment is required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2); // created + seed comment only

    // The discussion count remains unchanged after reload.
    first.unmount();
    vi.unstubAllGlobals();
    mockFetch(routes);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByText('1 comment')).toBeInTheDocument();
    expect(screen.queryByText('Comment is required')).not.toBeInTheDocument();
  });

  it('an over-long comment is rejected with “Comment is too long” and appends nothing', async () => {
    const user = userEvent.setup();
    const routes = commentRoutes();
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    const commentBox = screen.getByLabelText('Comment');
    // Typing 65537 characters is too slow for userEvent; set the value
    // directly so the controlled textarea holds the over-long text.
    fireEvent.change(commentBox, { target: { value: 'x'.repeat(65537) } });
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByText('Comment is too long')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('1 comment')).toBeInTheDocument();
  });

  it('a Read/Triage signed-in user cannot comment but may react to the existing comment', async () => {
    const user = userEvent.setup();
    const routes = commentRoutes();
    // bob-reviewer holds only Read on the public repository.
    routes['/api/auth/session'] = () => ({
      status: 200,
      body: { authenticated: true, username: 'bob-reviewer', email: 'bob.reviewer@example.test' },
    });
    routes['/api/repositories/acme-demo/acme-docs/issues/1'] = () => ({
      status: 200,
      body: { ok: true, issue: currentDetail(), role: 'read' },
    });
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    // No comment editor for Read.
    expect(screen.queryByRole('button', { name: 'Comment' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Comment')).not.toBeInTheDocument();
    // But the signed-in viewer can open the reaction menu of the comment.
    const seedArticle = screen.getAllByRole('article').find((article) =>
      within(article).queryByText(seedComment.body)
    );
    expect(seedArticle).toBeTruthy();
    await user.click(within(seedArticle!).getByRole('button', { name: 'Add reaction' }));
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: '❤️ Heart' })
    );
    expect(await within(seedArticle!).findByRole('button', { name: '❤️ 1' })).toBeInTheDocument();
  });

  it('a visitor sees the discussion but no comment editor and no reaction controls', async () => {
    const routes = commentRoutes();
    routes['/api/auth/session'] = () => ({ status: 200, body: { authenticated: false } });
    routes['/api/repositories/acme-demo/acme-docs/issues/1'] = () => ({
      status: 200,
      body: { ok: true, issue: currentDetail(), role: 'read' },
    });
    mockFetch(routes);
    navigate('#/repositories/acme-demo/acme-docs/issues/1');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Improve onboarding' })).toBeInTheDocument();
    expect(screen.getByText(seedComment.body)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Comment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add reaction' })).not.toBeInTheDocument();
  });
});

function currentDetail(): IssueDetail {
  return structuredClone(seededIssue);
}
