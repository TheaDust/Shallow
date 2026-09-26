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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-draft-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const get = (url, cookie) => request('GET', url, undefined, cookie);
const post = (url, body, cookie) => request('POST', url, body, cookie);

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

async function signIn(username) {
  const res = await request('POST', '/api/auth/signin', {
    identifier: username,
    password: 'Valid-password-123!',
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

test('REQ-6-2-4 scenario 1: an authorized user creates a Draft PR and the Draft marker, branches, and the disabled merge entry persist', async () => {
  const cookie = await signIn('alice-dev');

  // The pair main ← feature-search starts without an Open/Draft PR (the
  // Open seed targets main from `release`, the Closed seed does not block,
  // and the dedicated draft seed uses main ← draft-feature).
  const listBefore = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const beforePulls = (await listBefore.json()).pulls;
  const openOnPair = beforePulls.filter(
    (p) =>
      p.baseBranch === 'main' &&
      p.compareBranch === 'feature-search' &&
      (p.status === 'open' || p.status === 'draft')
  );
  assert.equal(openOnPair.length, 0, 'no Open/Draft PR on the pair before creation');

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    {
      title: '  Draft the search flow  ',
      description: '  Draft of the search flow changes.  ',
      base: 'main',
      compare: 'feature-search',
      draft: true,
    },
    cookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.role, 'admin');
  const pull = payload.pull;
  // The draft stores the same persisted fields as a normal PR, trimmed, with
  // the next repository-scoped number and status Draft.
  assert.equal(pull.title, 'Draft the search flow');
  assert.equal(pull.description, 'Draft of the search flow changes.');
  assert.equal(pull.status, 'draft');
  assert.equal(pull.baseBranch, 'main');
  assert.equal(pull.compareBranch, 'feature-search');
  assert.equal(pull.author, 'alice-dev');
  assert.ok(pull.baseCommitId, 'the creation-time base commit is stored');
  assert.ok(pull.compareCommitId, 'the creation-time compare commit is stored');
  assert.equal(pull.activity.length, 1);
  assert.equal(pull.activity[0].type, 'created');
  assert.equal(pull.activity[0].actor, 'alice-dev');
  const number = pull.number;

  // The detail page and the PR list both show the Draft status.
  const detail = await get(
    `/api/repositories/acme-demo/acme-docs/pulls/${number}`,
    cookie
  );
  assert.equal(detail.status, 200);
  const detailPull = (await detail.json()).pull;
  assert.equal(detailPull.status, 'draft');
  assert.equal(detailPull.title, 'Draft the search flow');
  assert.equal(detailPull.compareBranch, 'feature-search');
  assert.equal(detailPull.baseBranch, 'main');
  // A draft cannot be merged: the merge eligibility is false.
  assert.equal(detailPull.mergeable, false);

  const listAfter = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const afterPulls = (await listAfter.json()).pulls;
  const created = afterPulls.find((p) => p.number === number);
  assert.equal(created.title, 'Draft the search flow');
  assert.equal(created.status, 'draft');

  // Reloading from disk keeps the draft status and content.
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const persisted = store.findPullRequestByNumber(repo.id, number);
  assert.ok(persisted, 'the created draft PR must be persisted');
  assert.equal(persisted.status, 'draft');
  assert.equal(persisted.title, 'Draft the search flow');
  assert.equal(persisted.compareBranch, 'feature-search');
  assert.equal(persisted.baseBranch, 'main');
});

test('REQ-6-2-4: a draft creation with no valid difference or a duplicate pair is rejected without a partial record', async () => {
  const cookie = await signIn('alice-dev');
  const before = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const beforeCount = (await before.json()).pulls.length;

  // The same branch in both fields has no comparable commits: no draft is
  // created.
  const sameRes = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'Same branch draft', description: '', base: 'main', compare: 'main', draft: true },
    cookie
  );
  assert.equal(sameRes.status, 400);
  assert.equal((await sameRes.json()).errors.general, 'No changes');

  // Distinct branches with no differences (draft-feature points at the
  // feature-search head; REQ-6-3-1 moved the release seed one commit ahead
  // of main so the seeded Open PR has comparable commits).
  const noDiffRes = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'No diff draft', description: '', base: 'feature-search', compare: 'draft-feature', draft: true },
    cookie
  );
  assert.equal(noDiffRes.status, 400);
  assert.equal((await noDiffRes.json()).errors.general, 'No changes');

  // The pair main ← feature-search already holds the Draft created by the
  // scenario-1 test: a second draft is rejected.
  const dupRes = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'Duplicate draft', description: '', base: 'main', compare: 'feature-search', draft: true },
    cookie
  );
  assert.equal(dupRes.status, 400);
  assert.equal(
    (await dupRes.json()).errors.general,
    'A pull request already exists for these branches'
  );

  // A blank title is rejected for drafts exactly like normal PRs.
  const blankRes = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: '   ', description: '', base: 'main', compare: 'feature-search', draft: true },
    cookie
  );
  assert.equal(blankRes.status, 400);
  assert.equal((await blankRes.json()).errors.title, 'Title is required');

  const after = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  assert.equal((await after.json()).pulls.length, beforeCount, 'no draft record was created');
});

test('REQ-6-2-4: an unauthenticated visitor and Read/Triage users cannot create drafts', async () => {
  const visitor = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'T', description: '', base: 'main', compare: 'feature-search', draft: true }
  );
  assert.equal(visitor.status, 401);

  // REQ-6-3-3: bob-reviewer holds the seeded Write reviewer grant, so a
  // Read user (carol-dev) plays the rejected Read fixture.
  const readCookie = await signIn('carol-dev');
  const read = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'T', description: '', base: 'main', compare: 'feature-search', draft: true },
    readCookie
  );
  assert.equal(read.status, 403);
});

test('REQ-6-2-4 scenario 2: the dedicated ready-for-review seed PR transitions from Draft to Open and persists', async () => {
  const authorCookie = await signIn('alice-dev');

  // The seed PR displays its title, source branch, and target branch
  // verbatim, is a Draft, and initially has no submitted reviews (only the
  // creation activity).
  const detailRes = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/3',
    authorCookie
  );
  assert.equal(detailRes.status, 200);
  const detailBody = await detailRes.json();
  const pull = detailBody.pull;
  assert.equal(pull.title, 'Draft onboarding update');
  assert.equal(pull.status, 'draft');
  assert.equal(pull.compareBranch, 'draft-feature');
  assert.equal(pull.baseBranch, 'main');
  assert.equal(pull.author, 'alice-dev');
  assert.equal(pull.number, 3);
  assert.ok(
    pull.activity.every((e) => e.type !== 'review'),
    'no review activity exists on the seed draft'
  );
  assert.deepEqual(
    pull.activity.map((e) => e.type),
    ['created']
  );

  // The author clicks Ready for review and confirms: the same PR number
  // becomes Open, the branches, title, and number are unchanged, and a
  // ready_for_review activity is appended.
  const ready = await post(
    '/api/repositories/acme-demo/acme-docs/pulls/3/ready-for-review',
    {},
    authorCookie
  );
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody.ok, true);
  assert.equal(readyBody.pull.status, 'open');
  assert.equal(readyBody.pull.title, 'Draft onboarding update');
  assert.equal(readyBody.pull.compareBranch, 'draft-feature');
  assert.equal(readyBody.pull.baseBranch, 'main');
  assert.equal(readyBody.pull.number, 3);
  assert.deepEqual(
    readyBody.pull.activity.map((e) => e.type),
    ['created', 'ready_for_review']
  );
  assert.equal(readyBody.pull.activity[1].actor, 'alice-dev');

  // After refresh (reload from disk) and after reopening by a reviewer, the
  // PR is shown as Open.
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const persisted = store.findPullRequestByNumber(repo.id, 3);
  assert.equal(persisted.status, 'open');
  assert.equal(persisted.title, 'Draft onboarding update');
  assert.ok(
    store.getPullRequestActivity(persisted.id).some(
      (e) => e.type === 'ready_for_review'
    )
  );

  const reviewerCookie = await signIn('bob-reviewer');
  const reopened = await get(
    '/api/repositories/acme-demo/acme-docs/pulls/3',
    reviewerCookie
  );
  assert.equal(reopened.status, 200);
  assert.equal((await reopened.json()).pull.status, 'open');

  // The transition cannot be applied twice: an Open PR is not a draft.
  const again = await post(
    '/api/repositories/acme-demo/acme-docs/pulls/3/ready-for-review',
    {},
    authorCookie
  );
  assert.equal(again.status, 400);
  assert.equal((await again.json()).errors.general, 'Pull request is not a draft');
});

test('REQ-6-2-4: only the author, Maintain, Admin, or organization Owner may use Ready for review', async () => {
  // bob-reviewer (Write, not the author) cannot transition the draft
  // created by the scenario-1 test (still Draft at this point).
  const bobCookie = await signIn('bob-reviewer');
  // REQ-6-3-3: the seeded pending-comment PR moved the first user-created
  // draft number to 5.
  const draftNumber = 5;
  const denied = await post(
    `/api/repositories/acme-demo/acme-docs/pulls/${draftNumber}/ready-for-review`,
    {},
    bobCookie
  );
  assert.equal(denied.status, 403);

  // Grant bob-reviewer Maintain on acme-docs (a legitimate admin action by
  // the organization Owner): the same user may now transition the draft.
  const ownerCookie = await signIn('alice-dev');
  const grant = await post(
    '/api/repositories/acme-demo/acme-docs/access',
    { subjectType: 'user', subjectName: 'bob-reviewer', role: 'maintain' },
    ownerCookie
  );
  assert.equal(grant.status, 201);

  const allowed = await post(
    `/api/repositories/acme-demo/acme-docs/pulls/${draftNumber}/ready-for-review`,
    {},
    bobCookie
  );
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).pull.status, 'open');

  // An unknown PR is a 404 and does not change anything.
  const unknown = await post(
    '/api/repositories/acme-demo/acme-docs/pulls/99/ready-for-review',
    {},
    bobCookie
  );
  assert.equal(unknown.status, 404);

  // The unauthenticated visitor is rejected.
  const visitor = await post(
    '/api/repositories/acme-demo/acme-docs/pulls/3/ready-for-review',
    {}
  );
  assert.equal(visitor.status, 401);
});

test('REQ-6-2-4: a failed Ready-for-review write rolls back status and activity', async () => {
  const { createStore } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-draft-fail-'));
  try {
    const store = createStore(dir);
    const alice = store.findAccountByUsername('alice-dev');
    const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
    const draft = store.findPullRequestByNumber(repo.id, 3);
    assert.equal(draft.status, 'draft');

    // Sabotage the store file so the next persist throws.
    const filePath = path.join(dir, 'data.json');
    fs.rmSync(filePath);
    fs.mkdirSync(filePath);

    assert.throws(() => store.markPullRequestReadyForReview(draft, alice.id));
    // The rollback keeps the PR in Draft and adds no activity.
    assert.equal(draft.status, 'draft');
    assert.deepEqual(
      store.getPullRequestActivity(draft.id).map((e) => e.type),
      ['created']
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
