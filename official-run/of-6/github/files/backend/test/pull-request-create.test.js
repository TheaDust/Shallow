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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-create-test-'));
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

test('REQ-6-2-3 scenario 1: an authorized user creates an Open PR from main ← feature-search', async () => {
  const cookie = await signIn('alice-dev');

  // The comparison pair main ← feature-search starts without an Open/Draft
  // PR (the seeded Open PR targets main from the `release` branch, and the
  // seeded Closed PR on this pair does not block creation).
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
      title: '  Land the search flow  ',
      description: '  Adds the search flow commit to main.  ',
      base: 'main',
      compare: 'feature-search',
    },
    cookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.role, 'admin');
  const pull = payload.pull;
  // The title is trimmed; a unique repository-scoped number is allocated.
  assert.equal(pull.title, 'Land the search flow');
  assert.equal(pull.description, 'Adds the search flow commit to main.');
  // REQ-6-3-3: acme-docs also carries the seeded pending-comment PR, so the
  // first user-created PR takes number 5.
  assert.equal(pull.number, 5, 'the new PR takes the next repository-scoped number');
  assert.equal(pull.status, 'open');
  assert.equal(pull.baseBranch, 'main');
  assert.equal(pull.compareBranch, 'feature-search');
  assert.equal(pull.author, 'alice-dev');
  assert.ok(pull.baseCommitId, 'the creation-time base commit is stored');
  assert.ok(pull.compareCommitId, 'the creation-time compare commit is stored');
  assert.equal(pull.baseCommitId, pull.baseCommitId);
  assert.ok(pull.createdAt, 'the creation time is stored');
  assert.equal(pull.activity.length, 1);
  assert.equal(pull.activity[0].type, 'created');
  assert.equal(pull.activity[0].actor, 'alice-dev');
  // The current compare commit is the compare branch head (the seed
  // feature-search head), so the diff shows the seeded changed file.
  assert.ok(pull.currentCompareCommitId, 'the current compare commit is derived');
  const paths = pull.filesChanged.map((f) => f.path);
  assert.ok(paths.includes('src/search.ts'), 'the created PR diff shows src/search.ts');
  // The Checks area is available on arrival with test pending on the current
  // compare commit.
  assert.equal(pull.checks.test.status, 'pending');
  assert.equal(pull.checks.test.setter, null);

  // The detail page and the PR list both persist the new record.
  const detail = await get('/api/repositories/acme-demo/acme-docs/pulls/5');
  assert.equal(detail.status, 200);
  const detailPull = (await detail.json()).pull;
  assert.equal(detailPull.title, 'Land the search flow');
  assert.equal(detailPull.status, 'open');
  assert.equal(detailPull.number, 5);

  const listAfter = await get('/api/repositories/acme-demo/acme-docs/pulls');
  const afterPulls = (await listAfter.json()).pulls;
  assert.equal(afterPulls.length, 5);
  const created = afterPulls.find((p) => p.number === 5);
  assert.equal(created.title, 'Land the search flow');
  assert.equal(created.status, 'open');
  assert.equal(created.author, 'alice-dev');
  assert.equal(created.baseBranch, 'main');
  assert.equal(created.compareBranch, 'feature-search');
});

test('REQ-6-2-3: a title containing only spaces is rejected with Title is required and creates no PR', async () => {
  const cookie = await signIn('alice-dev');
  const before = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const beforeCount = (await before.json()).pulls.length;

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: '   ', description: '', base: 'main', compare: 'feature-search' },
    cookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.errors.title, 'Title is required');

  const after = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  assert.equal((await after.json()).pulls.length, beforeCount);
});

test('REQ-6-2-3: an over-long title or description is rejected with no PR created', async () => {
  const cookie = await signIn('alice-dev');
  const before = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const beforeCount = (await before.json()).pulls.length;

  const longTitle = 'x'.repeat(257);
  const titleRes = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: longTitle, description: '', base: 'main', compare: 'feature-search' },
    cookie
  );
  assert.equal(titleRes.status, 400);
  assert.equal((await titleRes.json()).errors.title, 'Title is too long');

  const longBody = 'y'.repeat(65537);
  const bodyRes = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'Valid title', description: longBody, base: 'main', compare: 'feature-search' },
    cookie
  );
  assert.equal(bodyRes.status, 400);
  assert.equal((await bodyRes.json()).errors.description, 'Description is too long');

  const after = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  assert.equal((await after.json()).pulls.length, beforeCount);
});

test('REQ-6-2-3: a 256-character title is accepted', async () => {
  const cookie = await signIn('alice-dev');
  // The main ← feature-search pair now holds an Open PR (scenario 1), so
  // this boundary test creates a fresh branch at the same feature head and
  // uses that pair (the branch-creation path is a legitimate user action;
  // the pair main ← feature-copy has no existing PR).
  const branchRes = await post(
    '/api/repositories/acme-demo/acme-docs/branches',
    { name: 'feature-copy', base: 'feature-search' },
    cookie
  );
  assert.equal(branchRes.status, 201);
  const title = 't'.repeat(256);
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title, description: '', base: 'main', compare: 'feature-copy' },
    cookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.pull.title, title);
  assert.equal(payload.pull.number, 6);
});

test('REQ-6-2-3: the same branch in both fields is rejected and creates no record', async () => {
  const cookie = await signIn('alice-dev');
  const before = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const beforeCount = (await before.json()).pulls.length;

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'Same branch', description: '', base: 'main', compare: 'main' },
    cookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.errors.general, 'No changes');

  const after = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  assert.equal((await after.json()).pulls.length, beforeCount);
});

test('REQ-6-2-3: distinct branches with no differences are rejected and create no record', async () => {
  const cookie = await signIn('alice-dev');
  const before = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const beforeCount = (await before.json()).pulls.length;

  // The seeded draft-feature branch points at the feature-search head, so
  // comparing the distinct names feature-search and draft-feature yields no
  // comparable commits and no changed files. (REQ-6-3-1 moved the release
  // seed one commit ahead of main so the seeded Open PR has comparable
  // commits, so the no-difference pair is this same-commit pair.)
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'No diff', description: '', base: 'feature-search', compare: 'draft-feature' },
    cookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.errors.general, 'No changes');

  const after = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  assert.equal((await after.json()).pulls.length, beforeCount);
});

test('REQ-6-2-3: an unknown base or compare branch is rejected without any side effect', async () => {
  const cookie = await signIn('alice-dev');
  const before = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const beforeCount = (await before.json()).pulls.length;

  const baseRes = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'T', description: '', base: 'nope', compare: 'feature-search' },
    cookie
  );
  assert.equal(baseRes.status, 400);
  assert.equal((await baseRes.json()).errors.base, 'Branch not found');

  const compareRes = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'T', description: '', base: 'main', compare: 'nope' },
    cookie
  );
  assert.equal(compareRes.status, 400);
  assert.equal((await compareRes.json()).errors.compare, 'Branch not found');

  const after = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  assert.equal((await after.json()).pulls.length, beforeCount);
});

test('REQ-6-2-3: a second Open/Draft PR for the same source/target pair is rejected', async () => {
  const cookie = await signIn('alice-dev');
  // PR #4 was created on main ← feature-search by the first test.
  const before = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  const beforeCount = (await before.json()).pulls.length;

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    {
      title: 'Duplicate pair',
      description: '',
      base: 'main',
      compare: 'feature-search',
    },
    cookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.ok, false);
  assert.equal(
    payload.errors.general,
    'A pull request already exists for these branches'
  );

  const after = await get('/api/repositories/acme-demo/acme-docs/pulls', cookie);
  assert.equal((await after.json()).pulls.length, beforeCount);
});

test('REQ-6-2-3: an unauthenticated visitor and Read/Triage users cannot create', async () => {
  const visitor = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'T', description: '', base: 'main', compare: 'feature-search' }
  );
  assert.equal(visitor.status, 401);

  // REQ-6-3-3: bob-reviewer holds the seeded Write reviewer grant, so a
  // Read user (carol-dev, outside the repository scope) plays the rejected
  // Read fixture.
  const readCookie = await signIn('carol-dev');
  const read = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'T', description: '', base: 'main', compare: 'feature-search' },
    readCookie
  );
  assert.equal(read.status, 403);

  const triageCookie = await signIn('dana-triage');
  const triage = await post(
    '/api/repositories/acme-demo/acme-docs/pulls',
    { title: 'T', description: '', base: 'main', compare: 'feature-search' },
    triageCookie
  );
  assert.equal(triage.status, 403);
});

test('REQ-6-2-3: an unknown repository is a 404 and a private repository without permission is a 403', async () => {
  const cookie = await signIn('alice-dev');

  const unknown = await post(
    '/api/repositories/acme-demo/no-such-repo/pulls',
    { title: 'T', description: '', base: 'main', compare: 'feature-search' },
    cookie
  );
  assert.equal(unknown.status, 404);

  // bob-reviewer has no access to the private acme-internal repository.
  const bobCookie = await signIn('bob-reviewer');
  const privateRes = await post(
    '/api/repositories/acme-demo/acme-internal/pulls',
    { title: 'T', description: '', base: 'main', compare: 'main' },
    bobCookie
  );
  assert.equal(privateRes.status, 403);
});

test('REQ-6-2-3: a successful creation persists across a restart (reload from disk)', async () => {
  // Isolated store so the creation succeeds on the main ← feature-search
  // pair (the shared suite already created a PR on that pair).
  const ownDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-create-persist-'));
  const ownApp = createApp({ dataDir: ownDataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  const ownServer = http.createServer(ownApp);
  await new Promise((resolve) => ownServer.listen(0, resolve));
  const ownBaseUrl = `http://127.0.0.1:${ownServer.address().port}`;
  const ownRequest = (method, url, body, cookie) =>
    fetch(`${ownBaseUrl}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const signInOwn = async (username) => {
    const res = await ownRequest('POST', '/api/auth/signin', {
      identifier: username,
      password: 'Valid-password-123!',
    });
    assert.equal(res.status, 200);
    return (res.headers.get('set-cookie') || '').split(';')[0];
  };
  const cookie = await signInOwn('alice-dev');
  const res = await ownRequest(
    'POST',
    '/api/repositories/acme-demo/acme-docs/pulls',
    {
      title: 'Persisted PR',
      description: 'Stored on disk.',
      base: 'main',
      compare: 'feature-search',
    },
    cookie
  );
  assert.equal(res.status, 201);
  const number = (await res.json()).pull.number;
  await new Promise((resolve) => ownServer.close(resolve));

  // Reopen the store from the same data directory (a fresh process would
  // read the same file) and confirm the record still exists.
  const { createStore } = require('../src/store');
  const store = createStore(ownDataDir);
  const pullRequest = store.findPullRequestByNumber(
    store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs').id,
    number
  );
  assert.ok(pullRequest, 'the created PR must be persisted');
  assert.equal(pullRequest.title, 'Persisted PR');
  assert.equal(pullRequest.status, 'open');
  assert.equal(pullRequest.baseBranch, 'main');
  assert.equal(pullRequest.compareBranch, 'feature-search');
  assert.ok(
    store.getPullRequestActivity(pullRequest.id).some((e) => e.type === 'created')
  );
  fs.rmSync(ownDataDir, { recursive: true, force: true });
});

test('REQ-6-2-3: a persistence failure rolls back and allocates no number', async () => {
  const { createStore } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-create-fail-'));
  try {
    const store = createStore(dir);
    const alice = store.findAccountByUsername('alice-dev');
    const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
    // Force the store file to exist with the seeded data.
    store.createSession(alice.id);
    // REQ-6-3-3: the seeded pending-comment PR makes the seed PR count 4.
    assert.equal(store.getRepositoryPullRequests(repo.id).length, 4);

    // Sabotage the store file so the next persist throws.
    const filePath = path.join(dir, 'data.json');
    fs.rmSync(filePath);
    fs.mkdirSync(filePath);

    assert.throws(() =>
      store.createPullRequest(
        repo.id,
        {
          title: 'Will not persist',
          description: '',
          baseBranch: 'main',
          compareBranch: 'feature-search',
          baseCommitId: 'b',
          compareCommitId: 'c',
        },
        alice.id
      )
    );
    // The rollback removes the PR and its activity; no number was taken.
    assert.equal(store.getRepositoryPullRequests(repo.id).length, 4);
    assert.deepEqual(
      store.getRepositoryPullRequests(repo.id).map((p) => p.number),
      [1, 2, 3, 4]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
