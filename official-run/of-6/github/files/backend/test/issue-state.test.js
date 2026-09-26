'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { createStore } = require('../src/store');

let dataDir;
let server;
let baseUrl;
let ownerCookie;
let memberCookie;
let triageCookie;
let carolCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-state-test-'));
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
  memberCookie = await signin('bob-reviewer');
  triageCookie = await signin('dana-triage');
  // REQ-6-3-3: bob-reviewer holds the seeded Write reviewer grant; a Read
  // user (carol-dev) plays the rejected Read fixture of the state rules.
  carolCookie = await signin('carol-dev');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function request(method, url, cookie, body) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: cookie
      ? { Cookie: cookie, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const post = (url, cookie, body) => request('POST', url, cookie, body);
const get = (url, cookie) => request('GET', url, cookie);

const stateUrl = (number) =>
  `/api/repositories/acme-demo/acme-docs/issues/${number}/state`;

async function detail(number, cookie) {
  const res = await get(`/api/repositories/acme-demo/acme-docs/issues/${number}`, cookie);
  assert.equal(res.status, 200);
  return (await res.json()).issue;
}

test('REQ-5-4: an Admin closes the seeded Open issue — status, time, and activity are stored; nothing else changes', async () => {
  // The closable seed issue `Improve onboarding` starts Open with labels,
  // milestone, assignee, description, and one comment.
  const beforeIssue = await detail(1, ownerCookie);
  assert.equal(beforeIssue.state, 'open');
  assert.equal(beforeIssue.closedAt, null);
  assert.equal(beforeIssue.title, 'Improve onboarding');
  assert.equal(beforeIssue.body, 'Describe the onboarding improvement.');
  assert.deepEqual(beforeIssue.labels, ['bug', 'documentation']);
  assert.deepEqual(beforeIssue.milestone, { title: 'Q3 launch' });
  assert.deepEqual(beforeIssue.assignees, ['alice-dev']);
  assert.equal(beforeIssue.comments.length, 1);

  const close = await post(stateUrl(1), ownerCookie, { state: 'closed' });
  assert.equal(close.status, 200);
  const closed = (await close.json()).issue;
  assert.equal(closed.state, 'closed');
  assert.ok(closed.closedAt, 'closing must record the time');
  assert.ok(closed.updatedAt >= beforeIssue.updatedAt);
  // The status transition never modifies the title, description, comments,
  // labels, assignees, or milestone.
  assert.equal(closed.title, beforeIssue.title);
  assert.equal(closed.body, beforeIssue.body);
  assert.deepEqual(closed.labels, beforeIssue.labels);
  assert.deepEqual(closed.milestone, beforeIssue.milestone);
  assert.deepEqual(closed.assignees, beforeIssue.assignees);
  assert.equal(closed.comments.length, 1);
  assert.deepEqual(
    closed.activity.map((e) => e.type),
    ['created', 'commented', 'closed']
  );
  const closeEvent = closed.activity[closed.activity.length - 1];
  assert.equal(closeEvent.actor, 'alice-dev');
  assert.equal(closeEvent.createdAt, closed.closedAt);
  // The detail page reads the same persisted Closed record.
  const reopenedRead = await detail(1, ownerCookie);
  assert.equal(reopenedRead.state, 'closed');
});

test('REQ-5-4: an Admin reopens the Closed issue — Open status and an appended reopen event; reload keeps the final state', async () => {
  const reopen = await post(stateUrl(1), ownerCookie, { state: 'open' });
  assert.equal(reopen.status, 200);
  const opened = (await reopen.json()).issue;
  assert.equal(opened.state, 'open');
  assert.equal(opened.closedAt, null);
  assert.deepEqual(
    opened.activity.map((e) => e.type),
    ['created', 'commented', 'closed', 'reopened']
  );
  assert.equal(
    opened.activity[opened.activity.length - 1].actor,
    'alice-dev'
  );
  // After reopening and reload the issue remains Open (the “Close issue”
  // button is available again on the frontend).
  const reloaded = await detail(1, ownerCookie);
  assert.equal(reloaded.state, 'open');
  assert.equal(reloaded.title, 'Improve onboarding');
  assert.deepEqual(reloaded.labels, ['bug', 'documentation']);
  assert.deepEqual(reloaded.milestone, { title: 'Q3 launch' });
});

test('REQ-5-4: a Triage user may close and reopen an issue; the timeline appends both events in sequence', async () => {
  const close = await post(stateUrl(3), triageCookie, { state: 'closed' });
  assert.equal(close.status, 200);
  const closed = (await close.json()).issue;
  assert.equal(closed.state, 'closed');
  assert.ok(closed.closedAt);
  assert.equal(closed.activity[closed.activity.length - 1].actor, 'dana-triage');

  const reopen = await post(stateUrl(3), triageCookie, { state: 'open' });
  assert.equal(reopen.status, 200);
  const opened = (await reopen.json()).issue;
  assert.equal(opened.state, 'open');
  assert.equal(opened.closedAt, null);
  assert.deepEqual(
    opened.activity.map((e) => e.type),
    ['created', 'closed', 'reopened']
  );
});

test('REQ-5-4: a Read user and an unauthenticated caller are rejected; the status stays unchanged', async () => {
  // carol-dev has Read on the public repository (outside the collaborator
  // scope): she cannot close or reopen, and the issue status does not
  // change.
  const member = await post(stateUrl(1), carolCookie, { state: 'closed' });
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, 'Access denied');
  const afterMember = await detail(1, carolCookie);
  assert.equal(afterMember.state, 'open');

  const anon = await post(stateUrl(1), undefined, { state: 'closed' });
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).error, 'Authentication required');
  const afterAnon = await detail(1, ownerCookie);
  assert.equal(afterAnon.state, 'open');
});

test('REQ-5-4: a Write user is rejected even though Write may create/edit/comment', async () => {
  // REQ-6-3-3: bob-reviewer already holds the seeded Write grant; Write can
  // create/edit/comment but cannot change the Open/Closed status (only
  // Triage, Maintain, or Admin).
  const member = await post(stateUrl(1), memberCookie, { state: 'closed' });
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, 'Access denied');
  const afterMember = await detail(1, ownerCookie);
  assert.equal(afterMember.state, 'open');
});

test('REQ-5-4: invalid states and unknown issues are rejected without changing anything', async () => {
  const invalid = await post(stateUrl(1), ownerCookie, { state: 'banana' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'State is invalid');
  const missing = await post(stateUrl(1), ownerCookie, {});
  assert.equal(missing.status, 400);

  const unknown = await post(stateUrl(999), ownerCookie, { state: 'closed' });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'Issue not found');

  const after = await detail(1, ownerCookie);
  assert.equal(after.state, 'open');
});

test('REQ-5-4: closing an already-Closed issue is a no-op (no duplicate activity)', async () => {
  // The seeded issue #2 `Legacy welcome text` is Closed.
  const before = await detail(2, ownerCookie);
  assert.equal(before.state, 'closed');
  const close = await post(stateUrl(2), ownerCookie, { state: 'closed' });
  assert.equal(close.status, 200);
  const after = (await close.json()).issue;
  assert.equal(after.state, 'closed');
  assert.equal(after.activity.length, before.activity.length, 'no new activity on a no-op');
});

test('REQ-5-4: the status transition persists across a store reload', async () => {
  // Close issue #3 (currently Open) and reload the store from disk: the
  // Closed status, closedAt, and the closed activity record all persist.
  const close = await post(stateUrl(3), ownerCookie, { state: 'closed' });
  assert.equal(close.status, 200);

  const store2 = createStore(dataDir);
  const repo = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const issue = store2.getRepositoryIssues(repo.id).find((i) => i.number === 3);
  assert.equal(issue.state, 'closed');
  assert.ok(issue.closedAt);
  assert.deepEqual(
    store2.getIssueActivity(issue.id).map((e) => e.type),
    ['created', 'closed', 'reopened', 'closed']
  );
  // The transition did not touch the title/description of the issue.
  assert.equal(issue.title, 'Original issue title');
});

test('REQ-5-4: private repositories without permission reject the transition', async () => {
  // bob-reviewer has no grant on acme-internal (private): he cannot even
  // read the issue, so the state route rejects him before any mutation.
  const member = await post(
    '/api/repositories/acme-demo/acme-internal/issues/1/state',
    memberCookie,
    { state: 'closed' }
  );
  assert.equal(member.status, 403);
  const anon = await post(
    '/api/repositories/acme-demo/acme-internal/issues/1/state',
    undefined,
    { state: 'closed' }
  );
  assert.equal(anon.status, 401);
});
