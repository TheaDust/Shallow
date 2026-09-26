'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { validateIssueCreation } = require('../src/validation');

let dataDir;
let server;
let baseUrl;
let ownerCookie;
let memberCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-create-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const signin = async (identifier) => {
    const res = await fetch(`${baseUrl}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: 'Valid-password-123!' }),
    });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  };

  ownerCookie = await signin('alice-dev');
  // REQ-6-3-3: bob-reviewer holds the seeded Write reviewer grant; a Read
  // user (carol-dev) plays the rejected Read fixture of the issue rules.
  memberCookie = await signin('carol-dev');
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

const post = (url, body, cookie) => request('POST', url, body, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

async function issueNumbers() {
  const res = await get('/api/repositories/acme-demo/acme-docs/issues');
  assert.equal(res.status, 200);
  const payload = await res.json();
  return payload.issues.map((i) => i.number);
}

test('validateIssueCreation implements the REQ-5-2 title/description rules', () => {
  // 1-256 non-empty characters after trimming; a title of only spaces is
  // blank; the description may be empty and is at most 65536 characters.
  assert.deepEqual(validateIssueCreation({ title: 'Fix typo', body: '' }), {});
  assert.deepEqual(validateIssueCreation({ title: '   Fix typo   ', body: '  ' }), {});
  assert.deepEqual(validateIssueCreation({ title: 'x'.repeat(256), body: 'y'.repeat(65536) }), {});
  assert.deepEqual(validateIssueCreation({ title: '   ' }), {
    title: 'Title is required',
  });
  assert.deepEqual(validateIssueCreation({ title: '', body: 'hello' }), {
    title: 'Title is required',
  });
  assert.deepEqual(validateIssueCreation({ title: 'x'.repeat(257) }), {
    title: 'Title is too long',
  });
  assert.deepEqual(validateIssueCreation({ title: 'ok', body: 'y'.repeat(65537) }), {
    body: 'Description is too long',
  });
  assert.deepEqual(
    validateIssueCreation({ title: '', body: 'y'.repeat(65537) }),
    { title: 'Title is required', body: 'Description is too long' }
  );
});

test('REQ-5-2-1: blank, over-long, unauthorized, or unauthenticated submissions create nothing and allocate no number', async () => {
  // The seed max issue number is 3 before any successful creation (REQ-5-2-2
  // adds the separate `Original issue title` invalid-edit seed issue).
  assert.deepEqual(await issueNumbers(), [1, 2, 3]);

  // A title of only three spaces is blank -> the exact visible message.
  const blank = await post(
    '/api/repositories/acme-demo/acme-docs/issues',
    { title: '   ', body: '' },
    ownerCookie
  );
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).errors.title, 'Title is required');

  // An over-long title and an over-long description are rejected per field.
  const longTitle = await post(
    '/api/repositories/acme-demo/acme-docs/issues',
    { title: 'x'.repeat(257), body: '' },
    ownerCookie
  );
  assert.equal(longTitle.status, 400);
  assert.equal((await longTitle.json()).errors.title, 'Title is too long');

  const longBody = await post(
    '/api/repositories/acme-demo/acme-docs/issues',
    { title: 'ok title', body: 'y'.repeat(65537) },
    ownerCookie
  );
  assert.equal(longBody.status, 400);
  assert.equal((await longBody.json()).errors.body, 'Description is too long');

  // carol-dev has Read on the public repository -> Access denied.
  const memberRes = await post(
    '/api/repositories/acme-demo/acme-docs/issues',
    { title: 'not allowed', body: '' },
    memberCookie
  );
  assert.equal(memberRes.status, 403);
  assert.equal((await memberRes.json()).error, 'Access denied');

  // Anonymous callers get 401.
  const anonymousRes = await post(
    '/api/repositories/acme-demo/acme-docs/issues',
    { title: 'anon', body: '' }
  );
  assert.equal(anonymousRes.status, 401);
  assert.equal((await anonymousRes.json()).error, 'Authentication required');

  // None of the rejected attempts allocated a number or stored an issue.
  assert.deepEqual(await issueNumbers(), [1, 2, 3]);
  const detail = await get('/api/repositories/acme-demo/acme-docs/issues/999');
  assert.equal(detail.status, 404);
});

test('REQ-5-2-1: alice-dev creates an issue with the next number, Open status, and a creation activity', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/issues',
    { title: '  Add API rate limit docs  ', body: '  The rate limits need documentation.  ' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  const issue = payload.issue;
  assert.equal(issue.number, 4, 'next incrementing repository-scoped number');
  assert.equal(issue.title, 'Add API rate limit docs', 'title trimmed before storage');
  assert.equal(issue.body, 'The rate limits need documentation.', 'description trimmed before storage');
  assert.equal(issue.state, 'open');
  assert.equal(issue.author, 'alice-dev');
  assert.equal(issue.closedAt, null);
  assert.deepEqual(issue.labels, []);
  assert.equal(issue.milestone, null);
  assert.equal(typeof issue.createdAt, 'string');
  assert.equal(issue.updatedAt, issue.createdAt);
  // The activity timeline contains a creation record by the author.
  assert.deepEqual(issue.activity.map((e) => e.type), ['created']);
  assert.equal(issue.activity[0].actor, 'alice-dev');
  assert.equal(issue.activity[0].createdAt, issue.createdAt);
  assert.deepEqual(issue.assignees, []);
  assert.deepEqual(issue.comments, []);

  // The detail page reads the same persisted record by the new number.
  const detail = await get('/api/repositories/acme-demo/acme-docs/issues/4');
  assert.equal(detail.status, 200);
  const detailPayload = await detail.json();
  assert.equal(detailPayload.issue.title, 'Add API rate limit docs');
  assert.equal(detailPayload.issue.body, 'The rate limits need documentation.');
  assert.deepEqual(
    detailPayload.issue.activity.map((e) => e.type),
    ['created']
  );

  // The Issues list can locate the issue by its new number and status.
  const list = await get('/api/repositories/acme-demo/acme-docs/issues');
  const listPayload = await list.json();
  assert.deepEqual(listPayload.issues.map((i) => i.number), [1, 2, 3, 4]);
  const row = listPayload.issues.find((i) => i.number === 4);
  assert.equal(row.title, 'Add API rate limit docs');
  assert.equal(row.state, 'open');
  assert.equal(row.author, 'alice-dev');
});

test('REQ-5-2-1: a second creation gets the next incrementing number', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/issues',
    { title: 'Another issue', body: '' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  assert.equal((await res.json()).issue.number, 5);
  assert.deepEqual(await issueNumbers(), [1, 2, 3, 4, 5]);
});

test('REQ-5-2-1: the issues list reports the caller role for the New issue link', async () => {
  const anonymous = await get('/api/repositories/acme-demo/acme-docs/issues');
  assert.equal((await anonymous.json()).role, 'read');

  const owner = await get('/api/repositories/acme-demo/acme-docs/issues', ownerCookie);
  assert.equal((await owner.json()).role, 'admin');

  const member = await get('/api/repositories/acme-demo/acme-docs/issues', memberCookie);
  assert.equal((await member.json()).role, 'read');
});

test('REQ-5-2-1: created issues survive a store reload and are not duplicated', async () => {
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const issues = store.getRepositoryIssues(repo.id);
  assert.deepEqual(issues.map((i) => i.number), [1, 2, 3, 4, 5]);
  const created = issues.find((i) => i.number === 4);
  assert.equal(created.title, 'Add API rate limit docs');
  assert.equal(created.state, 'open');
  assert.deepEqual(store.getIssueActivity(created.id).map((e) => e.type), ['created']);

  const store2 = createStore(dataDir);
  const issues2 = store2.getRepositoryIssues(
    store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs').id
  );
  assert.equal(issues2.length, 5, 'reload must not duplicate issues');
  assert.equal(store2.getIssueActivity(issues2.find((i) => i.number === 4).id).length, 1);
});

test('REQ-5-2-1: a persistence failure rolls back and allocates no number', async () => {
  const { createStore } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-create-fail-'));
  try {
    const store = createStore(dir);
    const alice = store.findAccountByUsername('alice-dev');
    const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
    // Force the store file to exist with the seeded data.
    store.createSession(alice.id);
    assert.equal(store.getRepositoryIssues(repo.id).length, 3);

    // Sabotage the store file so the next persist throws.
    const filePath = path.join(dir, 'data.json');
    fs.rmSync(filePath);
    fs.mkdirSync(filePath);

    assert.throws(() =>
      store.createIssue(repo.id, { title: 'Will not persist', body: '' }, alice.id)
    );
    // The rollback removes the issue and its activity; no number was taken.
    assert.equal(store.getRepositoryIssues(repo.id).length, 3);
    assert.deepEqual(
      store.getRepositoryIssues(repo.id).map((i) => i.number),
      [1, 2, 3]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
