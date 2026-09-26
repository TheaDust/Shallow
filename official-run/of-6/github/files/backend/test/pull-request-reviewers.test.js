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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-reviewers-test-'));
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

const reviewersUrl = (number) =>
  `/api/repositories/acme-demo/acme-docs/pulls/${number}/reviewers`;

test('REQ-6-4: the seed data supplies the Open PR of the signed-in author with no initial reviewer request, and bob-reviewer is an eligible non-author Write collaborator', async () => {
  const aliceCookie = await signIn('alice-dev');

  // The seed PR is Open, belongs to the signed-in author, and initially has
  // no request or submitted review from the eligible target reviewer.
  const pull = await detail(1, aliceCookie);
  assert.equal(pull.title, 'Improve onboarding');
  assert.equal(pull.status, 'open');
  assert.equal(pull.author, 'alice-dev');
  assert.deepEqual(pull.reviewers, [], 'no reviewer request is seeded');
  assert.deepEqual(pull.reviews, [], 'no submitted review is seeded');

  // bob-reviewer (the eligible target) holds Write on acme-docs via the seed
  // and is a distinct non-author collaborator.
  const access = await get('/api/repositories/acme-demo/acme-docs/access', aliceCookie);
  assert.equal(access.status, 200);
  const grants = (await access.json()).grants;
  const bobGrant = grants.find((g) => g.subjectName === 'bob-reviewer');
  assert.ok(bobGrant, 'bob-reviewer must have a seeded grant');
  assert.equal(bobGrant.role, 'write');

  const options = await get(reviewersUrl(1), aliceCookie);
  assert.equal(options.status, 200);
  const eligible = (await options.json()).eligible;
  assert.deepEqual(eligible, ['bob-reviewer']);
});

test('REQ-6-4 scenario 1: the author searches for and selects the collaborator under Reviewers; the request is saved immediately, shown in the area, and persists after reload; removing it makes the request disappear without generating an approval or comment', async () => {
  const aliceCookie = await signIn('alice-dev');
  const before = await detail(1, aliceCookie);
  assert.deepEqual(before.reviewers, []);
  const commentsBefore = before.comments.length;
  const reviewsBefore = before.reviews.length;

  // Select bob-reviewer: the request is saved immediately.
  const res = await request('PUT', `${reviewersUrl(1)}/bob-reviewer`, {}, aliceCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.pull.reviewers, ['bob-reviewer']);
  assert.equal(payload.role, 'admin');

  // Requesting does not automatically generate an approval or a comment and
  // appends no activity record.
  assert.equal(payload.pull.reviews.length, reviewsBefore);
  assert.equal(payload.pull.comments.length, commentsBefore);
  assert.equal(
    payload.pull.activity.filter((e) => e.type === 'created').length,
    1,
    'the only activity is the seed creation event'
  );

  // After refresh the request set remains (server-side persistence).
  const reloaded = await detail(1, aliceCookie);
  assert.deepEqual(reloaded.reviewers, ['bob-reviewer']);
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const persisted = store.findPullRequestByNumber(repo.id, 1);
  assert.deepEqual(store.getPullRequestReviewerUsernames(persisted.id), ['bob-reviewer']);

  // Clicking “Remove bob-reviewer” immediately removes the request.
  const remove = await request('DELETE', `${reviewersUrl(1)}/bob-reviewer`, undefined, aliceCookie);
  assert.equal(remove.status, 200);
  const removed = (await remove.json()).pull;
  assert.deepEqual(removed.reviewers, []);

  // After refreshing the detail page only the final request set remains.
  const finalReload = await detail(1, aliceCookie);
  assert.deepEqual(finalReload.reviewers, []);
});

test('REQ-6-4: only the PR author of an Open or Draft PR, Maintain, Admin, or organization Owner may modify requests — everyone else gets 401/403 and nothing is stored', async () => {
  // Anonymous: 401.
  const anonOptions = await get(reviewersUrl(1));
  assert.equal(anonOptions.status, 401);
  const anonPut = await request('PUT', `${reviewersUrl(1)}/bob-reviewer`, {}, undefined);
  assert.equal(anonPut.status, 401);
  assert.equal((await anonPut.json()).error, 'Authentication required');

  // A Read user (carol-dev, signed in but outside the repository scope): 403
  // on the options list, the request, and the removal.
  const carolCookie = await signIn('carol-dev');
  const carolOptions = await get(reviewersUrl(1), carolCookie);
  assert.equal(carolOptions.status, 403);
  const carolPut = await request('PUT', `${reviewersUrl(1)}/bob-reviewer`, {}, carolCookie);
  assert.equal(carolPut.status, 403);
  const carolRemove = await request('DELETE', `${reviewersUrl(1)}/bob-reviewer`, undefined, carolCookie);
  assert.equal(carolRemove.status, 403);

  // A Triage user (dana-triage) is not the author or a maintainer: 403.
  const danaCookie = await signIn('dana-triage');
  const danaPut = await request('PUT', `${reviewersUrl(1)}/bob-reviewer`, {}, danaCookie);
  assert.equal(danaPut.status, 403);
  assert.equal((await danaPut.json()).error, 'Access denied');

  // bob-reviewer is a non-author Write user — neither the author nor a
  // maintainer, so he cannot modify requests on the Open PR.
  const bobCookie = await signIn('bob-reviewer');
  const bobOptions = await get(reviewersUrl(1), bobCookie);
  assert.equal(bobOptions.status, 403);
  const bobPut = await request('PUT', `${reviewersUrl(1)}/bob-reviewer`, {}, bobCookie);
  assert.equal(bobPut.status, 403);
  const bobRemove = await request('DELETE', `${reviewersUrl(1)}/bob-reviewer`, undefined, bobCookie);
  assert.equal(bobRemove.status, 403);

  // The author of a Closed PR cannot manage requests through the author rule
  // (it only covers Open or Draft PRs); Maintain/Admin may manage on any
  // status. bob-reviewer (Write, not the author, not a maintainer) is
  // therefore rejected on the Closed seed PR too.
  const aliceCookie = await signIn('alice-dev');
  const closedPut = await request('PUT', `${reviewersUrl(2)}/bob-reviewer`, {}, bobCookie);
  assert.equal(closedPut.status, 403);
  const closedOptions = await get(reviewersUrl(2), bobCookie);
  assert.equal(closedOptions.status, 403);

  // The organization Owner (an effective Admin) may manage requests on the
  // Closed PR as well; clean up right away so later tests start empty.
  const ownerClosedPut = await request('PUT', `${reviewersUrl(2)}/bob-reviewer`, {}, aliceCookie);
  assert.equal(ownerClosedPut.status, 200);
  assert.deepEqual((await ownerClosedPut.json()).pull.reviewers, ['bob-reviewer']);
  const ownerClosedRemove = await request('DELETE', `${reviewersUrl(2)}/bob-reviewer`, undefined, aliceCookie);
  assert.equal(ownerClosedRemove.status, 200);
  assert.deepEqual((await ownerClosedRemove.json()).pull.reviewers, []);

  // No request was stored by any rejected call.
  const after = await detail(1, bobCookie);
  assert.deepEqual(after.reviewers, []);
});

test('REQ-6-4: a candidate must have Write, Maintain, or Admin and must not be the PR author; unknown and ineligible users are rejected without storing a request', async () => {
  const aliceCookie = await signIn('alice-dev');

  // Unknown user: 404.
  const unknown = await request('PUT', `${reviewersUrl(1)}/no-such-user`, {}, aliceCookie);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'User not found');

  // The PR author is never a candidate: 400.
  const author = await request('PUT', `${reviewersUrl(1)}/alice-dev`, {}, aliceCookie);
  assert.equal(author.status, 400);
  assert.equal((await author.json()).errors.reviewer, 'User is not an eligible reviewer');

  // A Triage collaborator is not eligible (needs Write or higher): 400.
  const triage = await request('PUT', `${reviewersUrl(1)}/dana-triage`, {}, aliceCookie);
  assert.equal(triage.status, 400);
  assert.equal((await triage.json()).errors.reviewer, 'User is not an eligible reviewer');

  // No request was created by any rejected call.
  const after = await detail(1, aliceCookie);
  assert.deepEqual(after.reviewers, []);
});

test('REQ-6-4: re-requesting the same reviewer is idempotent (one relationship, operator and time updated) and the author of a Draft PR may request reviewers', async () => {
  const aliceCookie = await signIn('alice-dev');

  // Request the same reviewer twice: only one relationship is stored.
  await request('PUT', `${reviewersUrl(1)}/bob-reviewer`, {}, aliceCookie);
  const second = await request('PUT', `${reviewersUrl(1)}/bob-reviewer`, {}, aliceCookie);
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).pull.reviewers, ['bob-reviewer']);

  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const onboarding = store.findPullRequestByNumber(repo.id, 1);
  const stored = store.getPullRequestReviewerUsernames(onboarding.id);
  assert.deepEqual(stored, ['bob-reviewer']);

  // The author of a Draft PR may request reviewers (Draft is allowed by the
  // author rule).
  const draftPut = await request('PUT', `${reviewersUrl(3)}/bob-reviewer`, {}, aliceCookie);
  assert.equal(draftPut.status, 200);
  assert.deepEqual((await draftPut.json()).pull.reviewers, ['bob-reviewer']);

  // Clean up for the remaining tests.
  await request('DELETE', `${reviewersUrl(1)}/bob-reviewer`, undefined, aliceCookie);
  await request('DELETE', `${reviewersUrl(3)}/bob-reviewer`, undefined, aliceCookie);
});

test('REQ-6-4: removing a request does not delete reviews, comments, or activity records already submitted by that reviewer and does not change the effective review decision', async () => {
  const aliceCookie = await signIn('alice-dev');
  const bobCookie = await signIn('bob-reviewer');

  // bob submits an Approve review on the Open PR first.
  const review = await post(
    '/api/repositories/acme-demo/acme-docs/pulls/1/reviews',
    { decision: 'approve', explanation: 'Approved before the request.' },
    bobCookie
  );
  assert.equal(review.status, 201);
  const withReview = await detail(1, aliceCookie);
  assert.equal(withReview.reviewStatus, 'approved');
  assert.equal(withReview.reviews.length, 1);

  // The author then requests bob and immediately removes the request.
  await request('PUT', `${reviewersUrl(1)}/bob-reviewer`, {}, aliceCookie);
  const remove = await request('DELETE', `${reviewersUrl(1)}/bob-reviewer`, undefined, aliceCookie);
  assert.equal(remove.status, 200);
  const afterRemove = (await remove.json()).pull;
  assert.deepEqual(afterRemove.reviewers, []);

  // The submitted review, its summary, and the review decision are intact.
  assert.equal(afterRemove.reviews.length, 1);
  assert.equal(afterRemove.reviews[0].reviewer, 'bob-reviewer');
  assert.equal(afterRemove.reviews[0].decision, 'approve');
  assert.equal(afterRemove.reviewStatus, 'approved');

  // Removing a reviewer who has no request is an idempotent no-op.
  const noop = await request('DELETE', `${reviewersUrl(1)}/bob-reviewer`, undefined, aliceCookie);
  assert.equal(noop.status, 200);
  assert.deepEqual((await noop.json()).pull.reviewers, []);
});
