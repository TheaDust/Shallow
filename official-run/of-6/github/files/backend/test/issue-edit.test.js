'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { validateIssueEdit } = require('../src/validation');

let dataDir;
let server;
let baseUrl;
let ownerCookie;
let memberCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-edit-test-'));
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

const patch = (url, body, cookie) => request('PATCH', url, body, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

async function detail(number, cookie) {
  const res = await get(`/api/repositories/acme-demo/acme-docs/issues/${number}`, cookie);
  assert.equal(res.status, 200);
  return (await res.json()).issue;
}

test('validateIssueEdit implements the REQ-5-2-2 rules: only provided fields are validated', () => {
  assert.deepEqual(validateIssueEdit({ title: 'New title' }), {});
  assert.deepEqual(validateIssueEdit({ title: '  New title  ' }), {});
  assert.deepEqual(validateIssueEdit({ title: 'x'.repeat(256) }), {});
  assert.deepEqual(validateIssueEdit({ body: '' }), {});
  assert.deepEqual(validateIssueEdit({ body: 'y'.repeat(65536) }), {});
  assert.deepEqual(validateIssueEdit({}), {});
  // A title of only spaces is blank -> the exact visible message.
  assert.deepEqual(validateIssueEdit({ title: '   ' }), {
    title: 'Title is required',
  });
  assert.deepEqual(validateIssueEdit({ title: '' }), {
    title: 'Title is required',
  });
  assert.deepEqual(validateIssueEdit({ title: 'x'.repeat(257) }), {
    title: 'Title is too long',
  });
  assert.deepEqual(validateIssueEdit({ body: 'y'.repeat(65537) }), {
    body: 'Description is too long',
  });
  assert.deepEqual(
    validateIssueEdit({ title: '   ', body: 'y'.repeat(65537) }),
    { title: 'Title is required', body: 'Description is too long' }
  );
});

test('REQ-5-2-2: unauthenticated and Read/Triage callers cannot edit; the server rejects their submissions', async () => {
  // Anonymous callers get 401.
  const anonymous = await patch(
    '/api/repositories/acme-demo/acme-docs/issues/1',
    { title: 'anon edit' }
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, 'Authentication required');

  // carol-dev has Read on the public repository -> Access denied.
  const member = await patch(
    '/api/repositories/acme-demo/acme-docs/issues/1',
    { title: 'not allowed' },
    memberCookie
  );
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, 'Access denied');

  // Neither submission changed the issue.
  const issue = await detail(1);
  assert.equal(issue.title, 'Improve onboarding');
  assert.equal(issue.body, 'Describe the onboarding improvement.');
  assert.deepEqual(
    issue.activity.map((e) => e.type),
    ['created', 'commented']
  );
});

test('REQ-5-2-2: an unknown issue number is a 404 and changes nothing', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/issues/999',
    { title: 'nope' },
    ownerCookie
  );
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Issue not found');
});

test('REQ-5-2-2: editing the title updates only the title and records the editor, edit time, and new value in the activity timeline', async () => {
  const before = await detail(1, ownerCookie);
  assert.equal(before.title, 'Improve onboarding');
  assert.equal(before.body, 'Describe the onboarding improvement.');
  assert.deepEqual(before.labels, ['bug', 'documentation']);
  assert.deepEqual(before.milestone, { title: 'Q3 launch' });
  assert.deepEqual(before.assignees, ['alice-dev']);
  assert.equal(before.comments.length, 1);

  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/issues/1',
    { title: '  Improve onboarding and first-run setup  ' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  const issue = payload.issue;
  assert.equal(issue.number, 1);
  assert.equal(issue.title, 'Improve onboarding and first-run setup', 'title trimmed before storage');
  assert.equal(issue.body, 'Describe the onboarding improvement.', 'description unchanged');
  assert.equal(issue.state, 'open', 'status unchanged');
  assert.deepEqual(issue.labels, ['bug', 'documentation'], 'labels unchanged');
  assert.deepEqual(issue.milestone, { title: 'Q3 launch' }, 'milestone unchanged');
  assert.deepEqual(issue.assignees, ['alice-dev'], 'assignees unchanged');
  assert.equal(issue.comments.length, 1, 'comments unchanged');
  assert.ok(issue.updatedAt >= before.updatedAt, 'edit time advances updatedAt');
  // The activity timeline records the edit (editor + edit time + new value).
  assert.deepEqual(
    issue.activity.map((e) => e.type),
    ['created', 'commented', 'edited']
  );
  const edited = issue.activity[2];
  assert.equal(edited.actor, 'alice-dev');
  assert.equal(edited.body, 'Improve onboarding and first-run setup');
  assert.equal(edited.createdAt, issue.updatedAt);

  // The issue-list summary displays the new title; other issues unchanged.
  const list = await get('/api/repositories/acme-demo/acme-docs/issues', ownerCookie);
  const listPayload = await list.json();
  const row = listPayload.issues.find((i) => i.number === 1);
  assert.equal(row.title, 'Improve onboarding and first-run setup');
  assert.equal(row.body, 'Describe the onboarding improvement.');
  const other = listPayload.issues.find((i) => i.number === 2);
  assert.equal(other.title, 'Legacy welcome text');
  assert.equal(other.state, 'closed');
  assert.equal(listPayload.issues.find((i) => i.number === 3).title, 'Original issue title');
});

test('REQ-5-2-2: editing the description is a separate action that updates only the description', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/issues/1',
    { body: '  Updated onboarding description for new contributors.  ' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  const issue = payload.issue;
  assert.equal(issue.number, 1);
  assert.equal(issue.title, 'Improve onboarding and first-run setup', 'title unchanged by description edit');
  assert.equal(issue.body, 'Updated onboarding description for new contributors.', 'description trimmed before storage');
  assert.deepEqual(
    issue.activity.map((e) => e.type),
    ['created', 'commented', 'edited', 'edited']
  );
  assert.equal(issue.activity[3].actor, 'alice-dev');
  assert.equal(issue.activity[3].body, 'Updated onboarding description for new contributors.');

  // A separate read of the same persisted record sees the new description.
  const reloaded = await detail(1, ownerCookie);
  assert.equal(reloaded.title, 'Improve onboarding and first-run setup');
  assert.equal(reloaded.body, 'Updated onboarding description for new contributors.');
});

test('REQ-5-2-2: a blank title, over-long input, or over-long description retains the original value and appends no activity', async () => {
  const before = await detail(1, ownerCookie);
  const activityCountBefore = before.activity.length;

  const blank = await patch(
    '/api/repositories/acme-demo/acme-docs/issues/1',
    { title: '   ' },
    ownerCookie
  );
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).errors.title, 'Title is required');

  const longTitle = await patch(
    '/api/repositories/acme-demo/acme-docs/issues/1',
    { title: 'x'.repeat(257) },
    ownerCookie
  );
  assert.equal(longTitle.status, 400);
  assert.equal((await longTitle.json()).errors.title, 'Title is too long');

  const longBody = await patch(
    '/api/repositories/acme-demo/acme-docs/issues/1',
    { body: 'y'.repeat(65537) },
    ownerCookie
  );
  assert.equal(longBody.status, 400);
  assert.equal((await longBody.json()).errors.body, 'Description is too long');

  // The original title and description are retained; no edit was recorded.
  const after = await detail(1, ownerCookie);
  assert.equal(after.title, 'Improve onboarding and first-run setup');
  assert.equal(after.body, 'Updated onboarding description for new contributors.');
  assert.equal(after.activity.length, activityCountBefore);
});

test('REQ-5-2-2: the invalid-edit seed issue keeps `Original issue title`; a three-space replacement is rejected and the original survives reload', async () => {
  const before = await detail(3, ownerCookie);
  assert.equal(before.title, 'Original issue title');
  assert.equal(before.state, 'open');

  // Replacing the title with three spaces shows "Title is required".
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/issues/3',
    { title: '   ' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).errors.title, 'Title is required');

  // The original title heading survives reload (fresh store read).
  const reloaded = await detail(3, ownerCookie);
  assert.equal(reloaded.title, 'Original issue title');
  const store = require('../src/store').createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const seeded = store.findIssueByNumber(repo.id, 3);
  assert.equal(seeded.title, 'Original issue title');
});

test('REQ-5-2-2: a persistence failure rolls back the edit and retains the original value', async () => {
  const { createStore } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-edit-fail-'));
  try {
    const store = createStore(dir);
    const alice = store.findAccountByUsername('alice-dev');
    const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
    store.createSession(alice.id);
    const issue = store.findIssueByNumber(repo.id, 1);
    const originalTitle = issue.title;
    const activityCount = store.getIssueActivity(issue.id).length;

    // Sabotage the store file so the next persist throws.
    const filePath = path.join(dir, 'data.json');
    fs.rmSync(filePath);
    fs.mkdirSync(filePath);

    assert.throws(() =>
      store.updateIssue(repo.id, issue.id, { title: 'Will not persist' }, alice.id)
    );
    // The rollback restores the original value and the activity timeline.
    assert.equal(issue.title, originalTitle);
    assert.equal(store.getIssueActivity(issue.id).length, activityCount);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
