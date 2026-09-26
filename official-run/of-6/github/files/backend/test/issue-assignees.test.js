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
let danaCookie;
let carolCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-assignees-test-'));
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
  danaCookie = await signin('dana-triage');
  // REQ-6-3-3: bob-reviewer holds the seeded Write reviewer grant; a Read
  // user (carol-dev) plays the rejected Read fixture of the assignee rules.
  carolCookie = await signin('carol-dev');
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

const put = (url, cookie) => request('PUT', url, undefined, cookie);
const del = (url, cookie) => request('DELETE', url, undefined, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

const issueUrl = (number, username) =>
  `/api/repositories/acme-demo/acme-docs/issues/${number}/assignees${username ? `/${username}` : ''}`;

async function detail(number, cookie) {
  const res = await get(`/api/repositories/acme-demo/acme-docs/issues/${number}`, cookie);
  assert.equal(res.status, 200);
  return (await res.json()).issue;
}

test('REQ-5-3-1: the seeded repository exposes exactly the assignable members; non-assignable and anonymous callers are rejected', async () => {
  // alice-dev (organization Owner -> Admin), bob-reviewer (the seeded
  // Write reviewer grant), and dana-triage (the seeded Triage grant) are
  // assignable; carol-dev (registered but outside the repository
  // collaborator scope) is not assignable and never appears.
  const res = await get(issueUrl(1), ownerCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.assignable, ['alice-dev', 'bob-reviewer', 'dana-triage']);

  // Read-only signed-in users cannot open the options.
  const member = await get(issueUrl(1), carolCookie);
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, 'Access denied');

  // Anonymous callers get 401 on the options and on both mutation routes.
  const anonOptions = await get(issueUrl(1));
  assert.equal(anonOptions.status, 401);
  for (const method of ['PUT', 'DELETE']) {
    const fn = method === 'PUT' ? put : del;
    const res2 = await fn(issueUrl(1, 'dana-triage'));
    assert.equal(res2.status, 401);
    assert.equal((await res2.json()).error, 'Authentication required');
  }
});

test('REQ-5-3-1: assigning a member stores the relationship, operator, and time and appends an activity record; repeated assignment is a no-op', async () => {
  const beforeIssue = await detail(1, ownerCookie);
  assert.deepEqual(beforeIssue.assignees, ['alice-dev']);
  assert.deepEqual(
    beforeIssue.activity.map((e) => e.type),
    ['created', 'commented']
  );

  const res = await put(issueUrl(1, 'dana-triage'), ownerCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.issue.assignees, ['alice-dev', 'dana-triage']);
  const assignedEvents = payload.issue.activity.filter((e) => e.type === 'assigned');
  assert.equal(assignedEvents.length, 1);
  assert.equal(assignedEvents[0].actor, 'alice-dev');
  assert.equal(assignedEvents[0].body, 'dana-triage');
  assert.ok(payload.issue.updatedAt >= beforeIssue.updatedAt);

  // The exact username is visible in the metadata returned by the detail page.
  const detailRes = await detail(1, ownerCookie);
  assert.deepEqual(detailRes.assignees, ['alice-dev', 'dana-triage']);

  // Assigning the same member again is a no-op: no duplicate relationship and
  // no duplicate activity record.
  const again = await put(issueUrl(1, 'dana-triage'), ownerCookie);
  assert.equal(again.status, 200);
  const againPayload = await again.json();
  assert.deepEqual(againPayload.issue.assignees, ['alice-dev', 'dana-triage']);
  assert.equal(
    againPayload.issue.activity.filter((e) => e.type === 'assigned').length,
    1
  );
});

test('REQ-5-3-1: non-assignable and unknown accounts cannot be assigned; the server rejects them and changes nothing', async () => {
  const carol = await put(issueUrl(1, 'carol-dev'), ownerCookie);
  assert.equal(carol.status, 400);
  assert.equal((await carol.json()).error, 'User is not assignable');

  const unknown = await put(issueUrl(1, 'unknown-reviewer'), ownerCookie);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'User not found');

  // Neither call changed the assignment set or the activity timeline.
  const issue = await detail(1, ownerCookie);
  assert.deepEqual(issue.assignees, ['alice-dev', 'dana-triage']);
  assert.equal(issue.activity.filter((e) => e.type === 'assigned').length, 1);

  // A Read-only member cannot assign (server-side check, not only UI hiding).
  const member = await put(issueUrl(1, 'dana-triage'), memberCookie);
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, 'Access denied');
});

test('REQ-5-3-1: unassigning removes only the issue relationship; the account and its grant survive, and the activity record is appended', async () => {
  const res = await del(issueUrl(1, 'dana-triage'), ownerCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.issue.assignees, ['alice-dev']);
  const unassignedEvents = payload.issue.activity.filter((e) => e.type === 'unassigned');
  assert.equal(unassignedEvents.length, 1);
  assert.equal(unassignedEvents[0].actor, 'alice-dev');
  assert.equal(unassignedEvents[0].body, 'dana-triage');

  // Unassigning the same member again is a no-op (no duplicate activity).
  const again = await del(issueUrl(1, 'dana-triage'), ownerCookie);
  assert.equal(again.status, 200);
  const againPayload = await again.json();
  assert.equal(
    againPayload.issue.activity.filter((e) => e.type === 'unassigned').length,
    1
  );

  // The account still exists, still signs in, and still holds the grant:
  // unassignment never deletes the member account or the repository grant.
  const signin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'dana-triage', password: 'Valid-password-123!' }),
  });
  assert.equal(signin.status, 200);
  const options = await get(issueUrl(1), ownerCookie);
  assert.deepEqual((await options.json()).assignable, ['alice-dev', 'bob-reviewer', 'dana-triage']);
});

test('REQ-5-3-1: after reload only the final selected-assignee set remains, with both historical activity records', async () => {
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const issue = store.findIssueByNumber(repo.id, 1);
  assert.deepEqual(store.getIssueAssignees(issue.id), ['alice-dev']);
  assert.deepEqual(
    store.getIssueActivity(issue.id).map((e) => e.type),
    ['created', 'commented', 'assigned', 'unassigned']
  );
});

test('REQ-5-3-1: an unknown issue number is a 404 and changes nothing', async () => {
  const options = await get(issueUrl(999), ownerCookie);
  assert.equal(options.status, 404);
  assert.equal((await options.json()).error, 'Issue not found');
  for (const method of ['PUT', 'DELETE']) {
    const fn = method === 'PUT' ? put : del;
    const res = await fn(issueUrl(999, 'dana-triage'), ownerCookie);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'Issue not found');
  }
});

test('REQ-5-3-1: Write users may create/edit/comment but cannot assign — the server rejects their submissions', async () => {
  // REQ-6-3-3: bob-reviewer already holds the seeded Write grant, so the
  // explicit module rule can be verified: Write is NOT in the assign roles
  // (assigning is reserved for Triage/Maintain/Admin).
  const member = await put(issueUrl(1, 'dana-triage'), memberCookie);
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, 'Access denied');
  const memberDel = await del(issueUrl(1, 'dana-triage'), memberCookie);
  assert.equal(memberDel.status, 403);
});
