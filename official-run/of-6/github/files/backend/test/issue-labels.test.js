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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-labels-test-'));
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
  // user (carol-dev) plays the rejected Read fixture of the label rules.
  carolCookie = await signin('carol-dev');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function request(method, url, cookie) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });
}

const put = (url, cookie) => request('PUT', url, cookie);
const del = (url, cookie) => request('DELETE', url, cookie);
const get = (url, cookie) => request('GET', url, cookie);

const labelUrl = (number, labelName) =>
  `/api/repositories/acme-demo/acme-docs/issues/${number}/labels${labelName ? `/${labelName}` : ''}`;

async function detail(number, cookie) {
  const res = await get(`/api/repositories/acme-demo/acme-docs/issues/${number}`, cookie);
  assert.equal(res.status, 200);
  return (await res.json()).issue;
}

test('REQ-5-3-2: the seeded repository exposes exactly its own label names; Read and anonymous callers are rejected', async () => {
  // alice-dev (organization Owner -> Admin) and dana-triage (the seeded
  // Triage grant) may open the selector and receive exactly the current
  // repository's labels. The private repository acme-internal carries labels
  // with the same names (`bug`, `documentation`) plus `urgent`; none of them
  // may appear here (labels are repository-scoped).
  const res = await get(labelUrl(1), ownerCookie);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).labels, ['bug', 'documentation']);

  const triage = await get(labelUrl(1), triageCookie);
  assert.equal(triage.status, 200);
  assert.deepEqual((await triage.json()).labels, ['bug', 'documentation']);

  // Read-only signed-in users cannot open the options.
  const member = await get(labelUrl(1), carolCookie);
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, 'Access denied');

  // Anonymous callers get 401 on the options and on both mutation routes.
  const anonOptions = await get(labelUrl(1));
  assert.equal(anonOptions.status, 401);
  for (const method of ['PUT', 'DELETE']) {
    const fn = method === 'PUT' ? put : del;
    const res2 = await fn(labelUrl(1, 'bug'));
    assert.equal(res2.status, 401);
    assert.equal((await res2.json()).error, 'Authentication required');
  }
});

test('REQ-5-3-2: applying and removing a label stores the relationship and activity; repeated apply is a no-op', async () => {
  const beforeIssue = await detail(1, ownerCookie);
  assert.deepEqual(beforeIssue.labels, ['bug', 'documentation']);
  assert.deepEqual(
    beforeIssue.activity.map((e) => e.type),
    ['created', 'commented']
  );

  // Applying an already-applied label is a no-op: no duplicate relationship
  // and no duplicate activity record.
  const noop = await put(labelUrl(1, 'bug'), ownerCookie);
  assert.equal(noop.status, 200);
  const noopPayload = await noop.json();
  assert.deepEqual(noopPayload.issue.labels, ['bug', 'documentation']);
  assert.equal(
    noopPayload.issue.activity.filter((e) => e.type === 'labeled').length,
    0
  );

  // Removing the documentation label deletes only the issue relationship
  // (the label record stays in the repository) and appends `unlabeled`.
  const remove = await del(labelUrl(1, 'documentation'), ownerCookie);
  assert.equal(remove.status, 200);
  const removePayload = await remove.json();
  assert.deepEqual(removePayload.issue.labels, ['bug']);
  const unlabeledEvents = removePayload.issue.activity.filter(
    (e) => e.type === 'unlabeled'
  );
  assert.equal(unlabeledEvents.length, 1);
  assert.equal(unlabeledEvents[0].actor, 'alice-dev');
  assert.equal(unlabeledEvents[0].body, 'documentation');
  assert.ok(removePayload.issue.updatedAt >= beforeIssue.updatedAt);

  // Re-applying the same label appends `labeled` and restores the metadata.
  const add = await put(labelUrl(1, 'documentation'), ownerCookie);
  assert.equal(add.status, 200);
  const addPayload = await add.json();
  assert.deepEqual(addPayload.issue.labels, ['bug', 'documentation']);
  const labeledEvents = addPayload.issue.activity.filter(
    (e) => e.type === 'labeled'
  );
  assert.equal(labeledEvents.length, 1);
  assert.equal(labeledEvents[0].actor, 'alice-dev');
  assert.equal(labeledEvents[0].body, 'documentation');

  // The detail page reads the same persisted record.
  const detailRes = await detail(1, ownerCookie);
  assert.deepEqual(detailRes.labels, ['bug', 'documentation']);
  assert.deepEqual(
    detailRes.activity.map((e) => e.type),
    ['created', 'commented', 'unlabeled', 'labeled']
  );
});

test('REQ-5-3-2: applying a label to an issue that does not carry it stores an association with the current repository label', async () => {
  // The invalid-edit seed issue `Original issue title` starts with no labels,
  // so it demonstrates the apply path against the seeded repository labels.
  const beforeIssue = await detail(3, ownerCookie);
  assert.deepEqual(beforeIssue.labels, []);

  const res = await put(labelUrl(3, 'bug'), ownerCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.issue.labels, ['bug']);
  const labeledEvents = payload.issue.activity.filter((e) => e.type === 'labeled');
  assert.equal(labeledEvents.length, 1);
  assert.equal(labeledEvents[0].body, 'bug');

  // The stored relationship references acme-docs' own label record (the
  // same-name label stored in acme-internal is never associated).
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const issue = store.findIssueByNumber(repo.id, 3);
  const acmeDocsBug = store.findLabelByRepositoryAndName(repo.id, 'bug');
  assert.deepEqual(store.getIssueLabelIds(issue.id), [acmeDocsBug.id]);
  assert.deepEqual(store.getIssueLabelNames(issue.id), ['bug']);
});

test('REQ-5-3-2: unknown or other-repository labels are rejected with 404 and never created or associated', async () => {
  // A label that does not exist anywhere must not be created.
  const unknown = await put(labelUrl(1, 'no-such-label'), ownerCookie);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'Label not found');

  // `urgent` exists only in the private repository acme-internal: applying
  // it on acme-docs must be rejected (no cross-repository association).
  const external = await put(labelUrl(1, 'urgent'), ownerCookie);
  assert.equal(external.status, 404);
  assert.equal((await external.json()).error, 'Label not found');

  const externalDel = await del(labelUrl(1, 'urgent'), ownerCookie);
  assert.equal(externalDel.status, 404);

  // Neither call changed the labels or the activity timeline of the issue,
  // and no label record was created for acme-docs.
  const issue = await detail(1, ownerCookie);
  assert.deepEqual(issue.labels, ['bug', 'documentation']);
  assert.equal(issue.activity.filter((e) => e.type === 'labeled').length, 1);
  assert.equal(issue.activity.filter((e) => e.type === 'unlabeled').length, 1);
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  assert.equal(store.getRepositoryLabels(repo.id).length, 2);
  assert.ok(
    !store.findLabelByRepositoryAndName(repo.id, 'no-such-label') &&
      !store.findLabelByRepositoryAndName(repo.id, 'urgent'),
    'rejected names must not create labels'
  );
});

test('REQ-5-3-2: a Triage user may apply and remove labels', async () => {
  const beforeIssue = await detail(3, triageCookie);
  assert.deepEqual(beforeIssue.labels, ['bug']);

  const add = await put(labelUrl(3, 'documentation'), triageCookie);
  assert.equal(add.status, 200);
  assert.deepEqual((await add.json()).issue.labels, ['bug', 'documentation']);

  const remove = await del(labelUrl(3, 'documentation'), triageCookie);
  assert.equal(remove.status, 200);
  assert.deepEqual((await remove.json()).issue.labels, ['bug']);
});

test('REQ-5-3-2: Write users may only view labels — the server rejects their submissions', async () => {
  // REQ-6-3-3: bob-reviewer already holds the seeded Write grant, so the
  // explicit module rule can be verified: Write is NOT in the label roles
  // (labels are managed by Triage/Maintain/Admin only).
  const memberPut = await put(labelUrl(1, 'bug'), memberCookie);
  assert.equal(memberPut.status, 403);
  assert.equal((await memberPut.json()).error, 'Access denied');
  const memberDel = await del(labelUrl(1, 'documentation'), memberCookie);
  assert.equal(memberDel.status, 403);
});

test('REQ-5-3-2: an unknown issue number is a 404 and changes nothing', async () => {
  const options = await get(labelUrl(999), ownerCookie);
  assert.equal(options.status, 404);
  assert.equal((await options.json()).error, 'Issue not found');
  for (const method of ['PUT', 'DELETE']) {
    const fn = method === 'PUT' ? put : del;
    const res = await fn(labelUrl(999, 'bug'), ownerCookie);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'Issue not found');
  }
});

test('REQ-5-3-2: after reload only the final label set remains, with both historical activity records', async () => {
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const issue = store.findIssueByNumber(repo.id, 1);
  assert.deepEqual(store.getIssueLabelNames(issue.id), ['bug', 'documentation']);
  assert.deepEqual(
    store.getIssueActivity(issue.id).map((e) => e.type),
    ['created', 'commented', 'unlabeled', 'labeled']
  );
  const issue3 = store.findIssueByNumber(repo.id, 3);
  assert.deepEqual(store.getIssueLabelNames(issue3.id), ['bug']);
  // The external labels of acme-internal stay repository-scoped and are not
  // duplicated by reloads.
  const internal = store.findRepositoryByOwnerAndName('acme-demo', 'acme-internal');
  assert.deepEqual(
    store.getRepositoryLabels(internal.id).map((l) => l.name),
    ['bug', 'documentation', 'urgent']
  );
});
