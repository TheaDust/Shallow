import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../src/server.js';
import { loadStore } from '../src/store.js';

let dir;
let server;
let base;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gh-issues-'));
  process.env.SHALLOW_DATA_DIR = dir;
  server = createServer(createHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  delete process.env.SHALLOW_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json, headers: res.headers };
}

async function signInCookie(identifier) {
  const res = await post('/api/signin', { identifier, password: 'Valid-password-123!' });
  return res.headers.get('set-cookie') ? res.headers.get('set-cookie').split(';')[0] : null;
}

async function putLabels(path, labels, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ labels }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function patch(path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function put(path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function postStatus(path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('seed provisions repository issue content and collaborator accounts', () => {
  const store = loadStore(dir);
  const acme = store.repositories.find((r) => r.name === 'acme-docs');
  assert.deepEqual(
    acme.labels.map((l) => l.name).sort(),
    ['bug', 'documentation']
  );
  assert.deepEqual(acme.milestones.map((m) => m.name), ['Q3 launch', 'v1.0']);
  assert.deepEqual(
    acme.collaborators.map((c) => c.username).sort(),
    ['bob-reviewer', 'cara-writer']
  );
  assert.equal(acme.collaborators.find((c) => c.username === 'bob-reviewer').role, 'read');
  assert.equal(acme.collaborators.find((c) => c.username === 'cara-writer').role, 'write');

  const onboarding = acme.issues.find((i) => i.title === 'Improve onboarding');
  assert.ok(onboarding);
  assert.equal(onboarding.status, 'open');
  assert.equal(onboarding.number, 1);
  assert.equal(onboarding.description, 'Describe the onboarding improvement.');
  assert.deepEqual(onboarding.labels, ['bug']);
  assert.deepEqual(onboarding.assignees, ['alice-dev']);
  assert.equal(onboarding.milestone, 'Q3 launch');
  assert.ok(onboarding.comments.length >= 1);
  assert.deepEqual(
    onboarding.activity.map((a) => a.type),
    ['created', 'comment']
  );

  const closed = acme.issues.find((i) => i.title === 'Legacy welcome text');
  assert.ok(closed);
  assert.equal(closed.status, 'closed');
  assert.deepEqual(closed.labels, ['bug']);

  const labelTarget = acme.issues.find((i) => i.title === 'Update contribution guidelines');
  assert.ok(labelTarget);
  assert.equal(labelTarget.status, 'open');
  assert.deepEqual(labelTarget.labels, []);

  const invalidEdit = acme.issues.find((i) => i.title === 'Original issue title');
  assert.ok(invalidEdit);
  assert.equal(invalidEdit.number, 4);
  assert.equal(invalidEdit.status, 'open');

  const secret = store.repositories.find((r) => r.name === 'secret-research');
  assert.deepEqual(secret.labels.map((l) => l.name), ['bug']);
  assert.ok(secret.issues.length >= 1);

  for (const username of ['bob-reviewer', 'cara-writer']) {
    const account = store.accounts.find((a) => a.username === username);
    assert.ok(account);
    assert.equal(account.emailVerified, true);
    assert.equal(account.status, 'active');
  }
});

test('visitor can list public issues with row fields and label definitions', async () => {
  const res = await fetch(`${base}/api/repositories/alice-dev/acme-docs/issues`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.repository.name, 'acme-docs');
  assert.equal(json.issues.length, 4);
  const onboarding = json.issues.find((i) => i.number === 1);
  assert.equal(onboarding.title, 'Improve onboarding');
  assert.equal(onboarding.status, 'open');
  assert.equal(onboarding.author, 'alice-dev');
  assert.deepEqual(onboarding.labels, ['bug']);
  assert.equal(onboarding.description, 'Describe the onboarding improvement.');
  assert.ok(onboarding.updatedAt);
  const closed = json.issues.find((i) => i.title === 'Legacy welcome text');
  assert.equal(closed.status, 'closed');
  assert.deepEqual(closed.labels, ['bug']);
  assert.deepEqual(json.labels.map((l) => l.name).sort(), ['bug', 'documentation']);
  assert.deepEqual(json.milestones.map((m) => m.name), ['Q3 launch', 'v1.0']);
});

test('issue detail shows description, metadata, comments and chronological activity', async () => {
  const res = await fetch(`${base}/api/repositories/alice-dev/acme-docs/issues/1`);
  assert.equal(res.status, 200);
  const json = await res.json();
  const issue = json.issue;
  assert.equal(issue.number, 1);
  assert.equal(issue.title, 'Improve onboarding');
  assert.equal(issue.status, 'open');
  assert.equal(issue.description, 'Describe the onboarding improvement.');
  assert.deepEqual(issue.labels, ['bug']);
  assert.deepEqual(issue.assignees, ['alice-dev']);
  assert.equal(issue.milestone, 'Q3 launch');
  assert.ok(issue.comments.length >= 1);
  assert.equal(issue.comments[0].author, 'cara-writer');
  assert.ok(issue.comments[0].body.length > 0);
  assert.equal(issue.permissions.manageMetadata, false);
  const times = issue.activity.map((a) => a.createdAt);
  assert.deepEqual(times, [...times].sort());
  assert.deepEqual(issue.activity.map((a) => a.type), ['created', 'comment']);
});

test('visitor cannot read private repository issues', async () => {
  const list = await fetch(`${base}/api/repositories/alice-dev/secret-research/issues`);
  assert.equal(list.status, 404);
  const detail = await fetch(`${base}/api/repositories/alice-dev/secret-research/issues/1`);
  assert.equal(detail.status, 404);
});

test('owner can read private repository issues and has metadata permission', async () => {
  const cookie = await signInCookie('alice-dev');
  const res = await fetch(`${base}/api/repositories/alice-dev/secret-research/issues/1`, {
    headers: { Cookie: cookie },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.issue.title, 'Private planning');
  assert.equal(json.issue.permissions.manageMetadata, true);
});

test('unknown issue number and malformed routes return 404', async () => {
  const missing = await fetch(`${base}/api/repositories/alice-dev/acme-docs/issues/99`);
  assert.equal(missing.status, 404);
  const malformed = await fetch(`${base}/api/repositories/alice-dev/acme-docs/issues/not-a-number`);
  assert.equal(malformed.status, 404);
});

test('maintainer applies and removes a label, persisted after reload', async () => {
  const cookie = await signInCookie('alice-dev');
  assert.ok(cookie);
  const path = '/api/repositories/alice-dev/acme-docs/issues/3/labels';

  const apply = await putLabels(path, ['bug'], cookie);
  assert.equal(apply.status, 200);
  assert.deepEqual(apply.json.issue.labels, ['bug']);
  assert.ok(apply.json.issue.activity.some((a) => a.type === 'label_added' && a.label === 'bug'));

  // The association is persisted: a fresh store read shows it.
  const stored = loadStore(dir);
  const issue = stored.repositories
    .find((r) => r.name === 'acme-docs')
    .issues.find((i) => i.number === 3);
  assert.deepEqual(issue.labels, ['bug']);
  assert.ok(issue.activity.some((a) => a.type === 'label_added' && a.label === 'bug'));

  const remove = await putLabels(path, [], cookie);
  assert.equal(remove.status, 200);
  assert.deepEqual(remove.json.issue.labels, []);
  assert.ok(remove.json.issue.activity.some((a) => a.type === 'label_removed' && a.label === 'bug'));
});

test('label update rejects names that do not exist in the current repository', async () => {
  const cookie = await signInCookie('alice-dev');
  const path = '/api/repositories/alice-dev/acme-docs/issues/3/labels';
  const res = await putLabels(path, ['bug', 'invented-label'], cookie);
  assert.equal(res.status, 422);
  assert.equal(res.json.fieldErrors.labels, 'Label does not exist in this repository');
  const stored = loadStore(dir);
  const issue = stored.repositories
    .find((r) => r.name === 'acme-docs')
    .issues.find((i) => i.number === 3);
  assert.deepEqual(issue.labels, []);
});

test('read and write users cannot submit label changes', async () => {
  const path = '/api/repositories/alice-dev/acme-docs/issues/3/labels';
  for (const username of ['bob-reviewer', 'cara-writer']) {
    const cookie = await signInCookie(username);
    const res = await putLabels(path, ['bug'], cookie);
    assert.equal(res.status, 403);
  }
  // Unauthenticated submissions are also rejected.
  const anon = await putLabels(path, ['bug']);
  assert.equal(anon.status, 403);
  const stored = loadStore(dir);
  const issue = stored.repositories
    .find((r) => r.name === 'acme-docs')
    .issues.find((i) => i.number === 3);
  assert.deepEqual(issue.labels, []);
});

test('read and write users can still view the issue detail', async () => {
  const cookie = await signInCookie('bob-reviewer');
  const res = await fetch(`${base}/api/repositories/alice-dev/acme-docs/issues/1`, {
    headers: { Cookie: cookie },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.issue.permissions.manageMetadata, false);
  assert.equal(json.issue.permissions.canEditContent, false);
});

test('write user edits title and description, persisted and recorded in activity', async () => {
  const cookie = await signInCookie('cara-writer');
  const path = '/api/repositories/alice-dev/acme-docs/issues/1';

  const titleRes = await patch(path, { title: '  Improved onboarding guide  ' }, cookie);
  assert.equal(titleRes.status, 200);
  assert.equal(titleRes.json.issue.title, 'Improved onboarding guide');
  assert.ok(
    titleRes.json.issue.activity.some(
      (a) => a.type === 'title_edited' && a.value === 'Improved onboarding guide' && a.author === 'cara-writer'
    )
  );

  const descRes = await patch(path, { description: 'A brand new description.' }, cookie);
  assert.equal(descRes.status, 200);
  assert.equal(descRes.json.issue.description, 'A brand new description.');
  assert.ok(
    descRes.json.issue.activity.some(
      (a) => a.type === 'description_edited' && a.value === 'A brand new description.'
    )
  );

  // Persistence survives a reload; status, labels, assignees and milestone are untouched.
  const stored = loadStore(dir);
  const issue = stored.repositories.find((r) => r.name === 'acme-docs').issues.find((i) => i.number === 1);
  assert.equal(issue.title, 'Improved onboarding guide');
  assert.equal(issue.description, 'A brand new description.');
  assert.equal(issue.status, 'open');
  assert.deepEqual(issue.labels, ['bug']);
  assert.deepEqual(issue.assignees, ['alice-dev']);
  assert.equal(issue.milestone, 'Q3 launch');
});

test('blank or overlong title edits are rejected and retain the original title', async () => {
  const cookie = await signInCookie('cara-writer');
  const path = '/api/repositories/alice-dev/acme-docs/issues/4';

  const blank = await patch(path, { title: '   ' }, cookie);
  assert.equal(blank.status, 422);
  assert.equal(blank.json.fieldErrors.title, 'Title is required');

  const overlong = await patch(path, { title: 'x'.repeat(257) }, cookie);
  assert.equal(overlong.status, 422);
  assert.equal(overlong.json.fieldErrors.title, 'Title is too long');

  const stored = loadStore(dir);
  const issue = stored.repositories.find((r) => r.name === 'acme-docs').issues.find((i) => i.number === 4);
  assert.equal(issue.title, 'Original issue title');
  assert.deepEqual(issue.activity.map((a) => a.type), ['created']);
});

test('overlong description edits are rejected and retain the original description', async () => {
  const cookie = await signInCookie('cara-writer');
  const path = '/api/repositories/alice-dev/acme-docs/issues/4';
  const res = await patch(path, { description: 'x'.repeat(65537) }, cookie);
  assert.equal(res.status, 422);
  assert.equal(res.json.fieldErrors.description, 'Description is too long');
  const stored = loadStore(dir);
  const issue = stored.repositories.find((r) => r.name === 'acme-docs').issues.find((i) => i.number === 4);
  assert.equal(issue.description, 'An issue used to verify that invalid title edits are rejected.');
});

test('read and anonymous users cannot edit issue content', async () => {
  const path = '/api/repositories/alice-dev/acme-docs/issues/4';
  const read = await patch(path, { title: 'Nope' }, await signInCookie('bob-reviewer'));
  assert.equal(read.status, 403);
  const anon = await patch(path, { title: 'Nope' });
  assert.equal(anon.status, 403);
  const stored = loadStore(dir);
  const issue = stored.repositories.find((r) => r.name === 'acme-docs').issues.find((i) => i.number === 4);
  assert.equal(issue.title, 'Original issue title');
});

test('admin sets and removes a milestone; only current repository milestones are accepted', async () => {
  const cookie = await signInCookie('alice-dev');
  const path = '/api/repositories/alice-dev/acme-docs/issues/1/milestone';

  const set = await put(path, { milestone: 'v1.0' }, cookie);
  assert.equal(set.status, 200);
  assert.equal(set.json.issue.milestone, 'v1.0');
  assert.ok(set.json.issue.activity.some((a) => a.type === 'milestone_changed' && a.milestone === 'v1.0'));

  const stored = loadStore(dir);
  assert.equal(
    stored.repositories.find((r) => r.name === 'acme-docs').issues.find((i) => i.number === 1).milestone,
    'v1.0'
  );

  const none = await put(path, { milestone: null }, cookie);
  assert.equal(none.status, 200);
  assert.equal(none.json.issue.milestone, null);
  assert.ok(none.json.issue.activity.some((a) => a.type === 'milestone_changed' && a.milestone === null));

  const crossRepo = await put(path, { milestone: 'Q4 planning' }, cookie);
  assert.equal(crossRepo.status, 422);
  assert.equal(crossRepo.json.fieldErrors.milestone, 'Milestone does not exist in this repository');
});

test('read and write users cannot change the milestone', async () => {
  const path = '/api/repositories/alice-dev/acme-docs/issues/4/milestone';
  for (const username of ['bob-reviewer', 'cara-writer']) {
    const cookie = await signInCookie(username);
    const res = await put(path, { milestone: 'v1.0' }, cookie);
    assert.equal(res.status, 403);
  }
  const anon = await put(path, { milestone: 'v1.0' });
  assert.equal(anon.status, 403);
  const stored = loadStore(dir);
  const issue = stored.repositories.find((r) => r.name === 'acme-docs').issues.find((i) => i.number === 4);
  assert.equal(issue.milestone, null);
});

test('admin closes and reopens an issue with activity records, other fields unchanged', async () => {
  const cookie = await signInCookie('alice-dev');
  const path = '/api/repositories/alice-dev/acme-docs/issues/1/status';

  const closed = await postStatus(path, { status: 'closed' }, cookie);
  assert.equal(closed.status, 200);
  assert.equal(closed.json.issue.status, 'closed');
  assert.ok(closed.json.issue.activity.some((a) => a.type === 'closed'));
  assert.equal(closed.json.issue.title, 'Improved onboarding guide');
  assert.equal(closed.json.issue.description, 'A brand new description.');
  assert.deepEqual(closed.json.issue.labels, ['bug']);
  assert.deepEqual(closed.json.issue.assignees, ['alice-dev']);
  assert.equal(closed.json.issue.milestone, null);

  const reopened = await postStatus(path, { status: 'open' }, cookie);
  assert.equal(reopened.status, 200);
  assert.equal(reopened.json.issue.status, 'open');
  assert.ok(reopened.json.issue.activity.some((a) => a.type === 'reopened'));

  const stored = loadStore(dir);
  const issue = stored.repositories.find((r) => r.name === 'acme-docs').issues.find((i) => i.number === 1);
  assert.equal(issue.status, 'open');
});

test('read and write users cannot close or reopen an issue', async () => {
  const path = '/api/repositories/alice-dev/acme-docs/issues/4/status';
  for (const username of ['bob-reviewer', 'cara-writer']) {
    const cookie = await signInCookie(username);
    const res = await postStatus(path, { status: 'closed' }, cookie);
    assert.equal(res.status, 403);
  }
  const anon = await postStatus(path, { status: 'closed' });
  assert.equal(anon.status, 403);
  const stored = loadStore(dir);
  const issue = stored.repositories.find((r) => r.name === 'acme-docs').issues.find((i) => i.number === 4);
  assert.equal(issue.status, 'open');
});

test('invalid status value is rejected without changing the issue', async () => {
  const cookie = await signInCookie('alice-dev');
  const path = '/api/repositories/alice-dev/acme-docs/issues/1/status';
  const res = await postStatus(path, { status: 'archived' }, cookie);
  assert.equal(res.status, 422);
  const stored = loadStore(dir);
  const issue = stored.repositories.find((r) => r.name === 'acme-docs').issues.find((i) => i.number === 1);
  assert.equal(issue.status, 'open');
});
