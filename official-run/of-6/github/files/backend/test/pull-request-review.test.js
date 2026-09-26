'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');

let dataDir;
let server;
let baseUrl;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-review-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function request(method, url, body, cookie) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const get = (url, cookie) => request('GET', url, undefined, cookie);
const post = (url, body, cookie) => request('POST', url, body, cookie);

async function signIn(username) {
  const res = await post('/api/auth/signin', {
    identifier: username,
    password: 'Valid-password-123!',
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function detail(number, cookie) {
  const res = await get(`/api/repositories/acme-demo/acme-docs/pulls/${number}`, cookie);
  assert.equal(res.status, 200);
  return (await res.json()).pull;
}

const reviewUrl = (number) =>
  `/api/repositories/acme-demo/acme-docs/pulls/${number}/reviews`;

test('REQ-6-3-4: seed data supplies a non-author Write reviewer and separate Open PRs for approval and request-changes, with no initial effective decision', async () => {
  // bob-reviewer (the reviewer) holds Write on acme-docs via the seed.
  const ownerCookie = await signIn('alice-dev');
  const access = await get('/api/repositories/acme-demo/acme-docs/access', ownerCookie);
  assert.equal(access.status, 200);
  const grants = (await access.json()).grants;
  const bobGrant = grants.find((g) => g.subjectName === 'bob-reviewer');
  assert.ok(bobGrant, 'bob-reviewer must have a seeded grant');
  assert.equal(bobGrant.role, 'write');

  // Separate Open PRs for the approval and request-changes submissions —
  // `Improve onboarding` (#1, main ← release) and `Pending review scenario`
  // (#4, main ← pending-review) — both authored by alice-dev, so bob is a
  // non-author reviewer on both, and neither carries an initial review.
  const pulls = await get('/api/repositories/acme-demo/acme-docs/pulls');
  const list = (await pulls.json()).pulls;
  const onboarding = list.find((p) => p.title === 'Improve onboarding');
  assert.ok(onboarding, 'the approval seed PR must exist');
  assert.equal(onboarding.number, 1);
  assert.equal(onboarding.status, 'open');
  assert.equal(onboarding.author, 'alice-dev');
  assert.equal(onboarding.reviewStatus, 'review_required');

  const pending = list.find((p) => p.title === 'Pending review scenario');
  assert.ok(pending, 'the request-changes seed PR must exist');
  assert.equal(pending.number, 4);
  assert.equal(pending.status, 'open');
  assert.equal(pending.author, 'alice-dev');
  assert.equal(pending.reviewStatus, 'review_required');

  const onboardingDetail = await detail(1, ownerCookie);
  assert.deepEqual(onboardingDetail.reviews, [], 'no review decision is seeded');
  const pendingDetail = await detail(4, ownerCookie);
  assert.deepEqual(pendingDetail.reviews, [], 'no review decision is seeded');
});

test('REQ-6-3-4: the PR author, Read users, anonymous callers, and Draft PRs cannot submit reviews — nothing is persisted', async () => {
  const bobCookie = await signIn('bob-reviewer');

  // Anonymous: 401.
  const anon = await post(reviewUrl(1), { decision: 'approve', explanation: '' });
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).error, 'Authentication required');

  // The PR author (alice-dev, Admin) cannot review her own PR: 403.
  const aliceCookie = await signIn('alice-dev');
  const author = await post(
    reviewUrl(1),
    { decision: 'approve', explanation: 'my own pr' },
    aliceCookie
  );
  assert.equal(author.status, 403);
  assert.equal((await author.json()).error, 'Access denied');

  // A Read user (carol-dev, signed in but outside the repository scope): 403.
  const carolCookie = await signIn('carol-dev');
  const reader = await post(
    reviewUrl(1),
    { decision: 'approve', explanation: 'reader' },
    carolCookie
  );
  assert.equal(reader.status, 403);
  assert.equal((await reader.json()).error, 'Access denied');

  // A Draft PR does not allow review submission: 400 (bob-reviewer is a
  // non-author Write user, so the draft-status rule is what rejects him).
  const draft = await post(
    reviewUrl(3),
    { decision: 'approve', explanation: 'on a draft' },
    bobCookie
  );
  assert.equal(draft.status, 400);
  assert.equal((await draft.json()).errors.general, 'Pull request is not open');

  // Unknown PR: 404.
  const unknown = await post(
    reviewUrl(99),
    { decision: 'approve', explanation: 'nope' },
    aliceCookie
  );
  assert.equal(unknown.status, 404);

  // Invalid decisions and over-long summaries are rejected too.
  const missing = await post(reviewUrl(1), { explanation: 'no decision' }, bobCookie);
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).errors.decision, 'Decision is required');

  const invalid = await post(reviewUrl(1), { decision: 'ship_it' }, bobCookie);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).errors.decision, 'Decision is invalid');

  const long = await post(
    reviewUrl(1),
    { decision: 'approve', explanation: 'y'.repeat(65537) },
    bobCookie
  );
  assert.equal(long.status, 400);
  assert.equal((await long.json()).errors.explanation, 'Summary is too long');

  // No review record was created by any rejected call.
  const after = await detail(1);
  assert.deepEqual(after.reviews, []);
  const draftDetail = await detail(3, bobCookie);
  assert.deepEqual(draftDetail.reviews, []);
});

test('REQ-6-3-4 scenario 1: selecting Approve and submitting without a summary is valid and stores the decision; the review summary persists after reload', async () => {
  const bobCookie = await signIn('bob-reviewer');
  const before = await detail(1, bobCookie);
  assert.deepEqual(before.reviews, []);

  // Approve without a Summary is valid.
  const res = await post(
    reviewUrl(1),
    { decision: 'approve', explanation: '' },
    bobCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.role, 'write');
  const pull = payload.pull;
  assert.equal(pull.reviews.length, 1);
  const review = pull.reviews[0];
  assert.equal(review.reviewer, 'bob-reviewer');
  assert.equal(review.decision, 'approve');
  assert.equal(review.explanation, '');
  assert.equal(review.commitId, pull.currentCompareCommitId);
  assert.equal(typeof review.createdAt, 'string');

  // The review status of the current compare commit reads the decision.
  assert.equal(pull.reviewStatus, 'approved');

  // After refresh the decision still exists (server-side persistence).
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const persisted = store.findPullRequestByNumber(repo.id, 1);
  const storedReviews = store.getPullRequestReviewSummaries(persisted);
  assert.equal(storedReviews.length, 1);
  assert.equal(storedReviews[0].reviewer, 'bob-reviewer');
  assert.equal(storedReviews[0].decision, 'approve');
  assert.equal(storedReviews[0].explanation, '');
});

test('REQ-6-3-4 scenario 2: Request changes with a summary stores the decision and the exact summary; it remains visible after reload', async () => {
  const bobCookie = await signIn('bob-reviewer');
  const before = await detail(4, bobCookie);
  assert.deepEqual(before.reviews, []);

  // The reviewer enters review feedback, selects Request changes, and
  // submits the review.
  const res = await post(
    reviewUrl(4),
    { decision: 'request_changes', explanation: 'The pending notes need a rewrite before merging.' },
    bobCookie
  );
  assert.equal(res.status, 201);
  const pull = (await res.json()).pull;
  assert.equal(pull.reviews.length, 1);
  const review = pull.reviews[0];
  assert.equal(review.reviewer, 'bob-reviewer');
  assert.equal(review.decision, 'request_changes');
  assert.equal(
    review.explanation,
    'The pending notes need a rewrite before merging.'
  );
  assert.equal(review.commitId, pull.currentCompareCommitId);
  assert.equal(pull.reviewStatus, 'changes_requested');

  // The decision remains after reload (server-side persistence) and the
  // exact summary is retained.
  const reload = await detail(4, bobCookie);
  assert.equal(reload.reviews.length, 1);
  assert.equal(reload.reviews[0].decision, 'request_changes');
  assert.equal(
    reload.reviews[0].explanation,
    'The pending notes need a rewrite before merging.'
  );
  assert.equal(reload.reviews[0].reviewer, 'bob-reviewer');
});

test('REQ-6-3-4: branch-protection merge-eligibility reads the review decision — Approve satisfies the approval rule, Request changes blocks, a new decision replaces it, a new compare commit makes it stale', async () => {
  const ownerCookie = await signIn('alice-dev');
  const bobCookie = await signIn('bob-reviewer');

  // A branch protection rule on main requires 1 approval and the `test`
  // check; alice (Admin) sets the check to success on the current compare
  // commit so the approval can satisfy the merge eligibility.
  const rule = await post(
    '/api/repositories/acme-demo/acme-docs/branch-protection',
    { branchName: 'main', requireApproval: true, requireStatusCheck: true },
    ownerCookie
  );
  assert.equal(rule.status, 201);
  const check = await request(
    'PATCH',
    '/api/repositories/acme-demo/acme-docs/pulls/1/checks',
    { status: 'success' },
    ownerCookie
  );
  assert.equal(check.status, 200);

  // PR #1 carries the Approve submitted by bob in scenario 1 (same current
  // compare commit, test success): the branch-protection merge-eligibility
  // check reads that decision and the PR is mergeable.
  let state = await detail(1, ownerCookie);
  assert.equal(state.mergeable, true);
  assert.deepEqual(state.blockedReasons, []);

  // Request changes blocks merging for the same current compare commit.
  const requested = await post(
    reviewUrl(1),
    { decision: 'request_changes', explanation: 'Please update the guide first.' },
    bobCookie
  );
  assert.equal(requested.status, 201);
  state = await detail(1, ownerCookie);
  assert.equal(state.mergeable, false);
  assert.ok(state.blockedReasons.includes('Requested changes must be resolved.'));
  assert.equal(state.reviewStatus, 'changes_requested');

  // The old Approve record is preserved in the timeline while the latest
  // decision by the same reviewer (Request changes) is the effective one.
  assert.equal(state.reviews.length, 2);
  assert.equal(state.reviews[0].decision, 'approve');
  assert.equal(state.reviews[1].decision, 'request_changes');

  // A new Comment decision by the same reviewer on the current compare
  // commit replaces the Request changes as the effective decision.
  const commented = await post(
    reviewUrl(1),
    { decision: 'comment', explanation: 'Discussed in the call.' },
    bobCookie
  );
  assert.equal(commented.status, 201);
  state = await detail(1, ownerCookie);
  assert.equal(state.reviewStatus, 'review_required');
  assert.ok(
    !state.blockedReasons.includes('Requested changes must be resolved.')
  );
  // A fresh approve is required again for the approval rule.
  assert.ok(state.blockedReasons.includes('Review required by branch protection'));
  assert.equal(state.reviews.length, 3);

  // A new Approve for the current compare commit unblocks merging again.
  const reapprove = await post(
    reviewUrl(1),
    { decision: 'approve', explanation: 'All set now.' },
    bobCookie
  );
  assert.equal(reapprove.status, 201);
  state = await detail(1, ownerCookie);
  assert.equal(state.mergeable, true);
  assert.deepEqual(state.blockedReasons, []);
  assert.equal(state.reviews.length, 4);

  // When the compare branch receives a new commit, the old decisions become
  // stale and no longer count (the new commit starts without an effective
  // decision; the timeline keeps the old records).
  const write = await post(
    '/api/repositories/acme-demo/acme-docs/contents',
    { branch: 'release', path: 'advance-review.md', content: 'new', message: 'Advance release' },
    ownerCookie
  );
  assert.equal(write.status, 201);
  state = await detail(1, ownerCookie);
  assert.equal(state.reviewStatus, 'review_required');
  assert.ok(state.blockedReasons.includes('Review required by branch protection'));
  assert.equal(state.mergeable, false);
  assert.equal(state.reviews.length, 4);
});

test('REQ-6-3-4: submitting a review publishes the reviewer\'s pending Start-a-review inline comments', async () => {
  const bobCookie = await signIn('bob-reviewer');
  const aliceCookie = await signIn('alice-dev');

  // bob starts a pending inline review comment on PR #1 (main ← release).
  const before = await detail(1, bobCookie);
  const searchTs = before.filesChanged.find((f) => f.path === 'src/search.ts');
  const addLine = searchTs.lines.findIndex((l) => l.type === 'add');
  assert.ok(addLine >= 0);
  const pendingRes = await post(
    `/api/repositories/acme-demo/acme-docs/pulls/1/inline-comments`,
    {
      filePath: 'src/search.ts',
      line: addLine,
      body: 'A pending draft that ships with the submitted review.',
      pending: true,
    },
    bobCookie
  );
  assert.equal(pendingRes.status, 201);

  // The draft is not public before the review is submitted.
  let aliceView = await detail(1, aliceCookie);
  assert.ok(
    !aliceView.inlineComments.some(
      (c) => c.body === 'A pending draft that ships with the submitted review.'
    ),
    'the pending draft is not public before the review is submitted'
  );

  const reviewsBefore = aliceView.reviews.length;

  // bob submits an Approve review: the pending draft is published with it.
  const review = await post(
    reviewUrl(1),
    { decision: 'approve', explanation: 'Publishing the pending draft now.' },
    bobCookie
  );
  assert.equal(review.status, 201);
  const afterReview = await detail(1, aliceCookie);
  const published = afterReview.inlineComments.find(
    (c) => c.body === 'A pending draft that ships with the submitted review.'
  );
  assert.ok(published, 'the pending draft is published when the review is submitted');
  assert.equal(published.pending, false);
  assert.equal(published.author, 'bob-reviewer');
  assert.equal(afterReview.reviews.length, reviewsBefore + 1);
});
