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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-milestones-test-'));
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
  // user (carol-dev) plays the rejected Read fixture of the milestone rules.
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

const milestoneUrl = (number, title) =>
  `/api/repositories/acme-demo/acme-docs/issues/${number}/milestones${title ? `/${encodeURIComponent(title)}` : ''}`;

async function detail(number, cookie) {
  const res = await get(`/api/repositories/acme-demo/acme-docs/issues/${number}`, cookie);
  assert.equal(res.status, 200);
  return (await res.json()).issue;
}

test('REQ-5-3-3: the seeded repository exposes exactly its own milestones; Read and anonymous callers are rejected', async () => {
  // alice-dev (organization Owner -> Admin) and dana-triage (the seeded
  // Triage grant) may open the picker and receive exactly the current
  // repository's milestones. The private repository acme-internal carries a
  // milestone `v2.0`; it must never appear here (milestones are
  // repository-scoped).
  const res = await get(milestoneUrl(1), ownerCookie);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).milestones, ['Q3 launch', 'v1.0']);

  const triage = await get(milestoneUrl(1), triageCookie);
  assert.equal(triage.status, 200);
  assert.deepEqual((await triage.json()).milestones, ['Q3 launch', 'v1.0']);

  // Read-only signed-in users cannot open the picker.
  const member = await get(milestoneUrl(1), carolCookie);
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, 'Access denied');

  // Anonymous callers get 401 on the options and on both mutation routes.
  const anonOptions = await get(milestoneUrl(1));
  assert.equal(anonOptions.status, 401);
  const anonPut = await put(milestoneUrl(1, 'v1.0'));
  assert.equal(anonPut.status, 401);
  assert.equal((await anonPut.json()).error, 'Authentication required');
  const anonDel = await del(milestoneUrl(1));
  assert.equal(anonDel.status, 401);
  assert.equal((await anonDel.json()).error, 'Authentication required');
});

test('REQ-5-3-3: selecting a milestone stores the association and activity; selecting it again is a no-op; “None” removes it', async () => {
  // The seeded issue `Improve onboarding` is associated with `Q3 launch`, not
  // with the selectable `v1.0` milestone.
  const beforeIssue = await detail(1, ownerCookie);
  assert.deepEqual(beforeIssue.milestone, { title: 'Q3 launch' });
  assert.deepEqual(
    beforeIssue.activity.map((e) => e.type),
    ['created', 'commented']
  );

  // Selecting v1.0 replaces the association and appends `milestoned`.
  const set = await put(milestoneUrl(1, 'v1.0'), ownerCookie);
  assert.equal(set.status, 200);
  const setPayload = await set.json();
  assert.deepEqual(setPayload.issue.milestone, { title: 'v1.0' });
  const milestonedEvents = setPayload.issue.activity.filter(
    (e) => e.type === 'milestoned'
  );
  assert.equal(milestonedEvents.length, 1);
  assert.equal(milestonedEvents[0].actor, 'alice-dev');
  assert.equal(milestonedEvents[0].body, 'v1.0');
  assert.ok(setPayload.issue.updatedAt >= beforeIssue.updatedAt);

  // Selecting the same milestone again is a no-op: no duplicate activity.
  const noop = await put(milestoneUrl(1, 'v1.0'), ownerCookie);
  assert.equal(noop.status, 200);
  const noopPayload = await noop.json();
  assert.deepEqual(noopPayload.issue.milestone, { title: 'v1.0' });
  assert.equal(
    noopPayload.issue.activity.filter((e) => e.type === 'milestoned').length,
    1
  );

  // “None” removes the association and appends `demilestoned`.
  const remove = await del(milestoneUrl(1), ownerCookie);
  assert.equal(remove.status, 200);
  const removePayload = await remove.json();
  assert.equal(removePayload.issue.milestone, null);
  const demilestonedEvents = removePayload.issue.activity.filter(
    (e) => e.type === 'demilestoned'
  );
  assert.equal(demilestonedEvents.length, 1);
  assert.equal(demilestonedEvents[0].actor, 'alice-dev');
  assert.equal(demilestonedEvents[0].body, 'v1.0');

  // Clearing again is a no-op (no new activity).
  const removeAgain = await del(milestoneUrl(1), ownerCookie);
  assert.equal(removeAgain.status, 200);
  const removeAgainPayload = await removeAgain.json();
  assert.equal(removeAgainPayload.issue.milestone, null);
  assert.equal(
    removeAgainPayload.issue.activity.filter(
      (e) => e.type === 'demilestoned'
    ).length,
    1
  );

  // Restore the seeded `Q3 launch` association so the shared seed state is
  // preserved for other features; the activity timeline keeps the history.
  const restore = await put(milestoneUrl(1, 'Q3 launch'), ownerCookie);
  assert.equal(restore.status, 200);
  assert.deepEqual((await restore.json()).issue.milestone, { title: 'Q3 launch' });
  const detailRes = await detail(1, ownerCookie);
  assert.deepEqual(
    detailRes.activity.map((e) => e.type),
    ['created', 'commented', 'milestoned', 'demilestoned', 'milestoned']
  );
});

test('REQ-5-3-3: setting a milestone on an issue without one stores the association', async () => {
  // The invalid-edit seed issue `Original issue title` starts with no
  // milestone, so it demonstrates the set path against the seeded
  // milestones.
  const beforeIssue = await detail(3, ownerCookie);
  assert.equal(beforeIssue.milestone, null);

  const res = await put(milestoneUrl(3, 'v1.0'), ownerCookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.issue.milestone, { title: 'v1.0' });
  const milestonedEvents = payload.issue.activity.filter(
    (e) => e.type === 'milestoned'
  );
  assert.equal(milestonedEvents.length, 1);
  assert.equal(milestonedEvents[0].body, 'v1.0');

  // The stored association references acme-docs' own milestone record (the
  // same-title milestone stored in acme-internal is never associated).
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const issue = store.findIssueByNumber(repo.id, 3);
  const acmeDocsV1 = store.findMilestoneByRepositoryAndTitle(repo.id, 'v1.0');
  assert.equal(issue.milestoneId, acmeDocsV1.id);
});

test('REQ-5-3-3: unknown or other-repository milestones are rejected with 404 and never created or associated', async () => {
  // A milestone that does not exist anywhere must not be created.
  const unknown = await put(milestoneUrl(1, 'no-such-milestone'), ownerCookie);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'Milestone not found');

  // `v2.0` exists only in the private repository acme-internal: setting it
  // on acme-docs must be rejected (no cross-repository association).
  const external = await put(milestoneUrl(1, 'v2.0'), ownerCookie);
  assert.equal(external.status, 404);
  assert.equal((await external.json()).error, 'Milestone not found');

  const externalDel = await del(milestoneUrl(1, 'v2.0'), ownerCookie);
  assert.equal(externalDel.status, 404);

  // Neither call changed the milestone or the activity timeline of the
  // issue, and no milestone record was created for acme-docs.
  const issue = await detail(1, ownerCookie);
  assert.deepEqual(issue.milestone, { title: 'Q3 launch' });
  assert.equal(issue.activity.filter((e) => e.type === 'milestoned').length, 2);
  assert.equal(issue.activity.filter((e) => e.type === 'demilestoned').length, 1);
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  assert.deepEqual(
    store.getRepositoryMilestones(repo.id).map((m) => m.title),
    ['Q3 launch', 'v1.0']
  );
  assert.ok(
    !store.findMilestoneByRepositoryAndTitle(repo.id, 'no-such-milestone') &&
      !store.findMilestoneByRepositoryAndTitle(repo.id, 'v2.0'),
    'rejected titles must not create milestones'
  );
});

test('REQ-5-3-3: a Triage user may set and remove the milestone', async () => {
  // The closed seed issue `Legacy welcome text` starts with no milestone.
  const beforeIssue = await detail(2, triageCookie);
  assert.equal(beforeIssue.milestone, null);

  const add = await put(milestoneUrl(2, 'Q3 launch'), triageCookie);
  assert.equal(add.status, 200);
  assert.deepEqual((await add.json()).issue.milestone, { title: 'Q3 launch' });

  const remove = await del(milestoneUrl(2), triageCookie);
  assert.equal(remove.status, 200);
  const removePayload = await remove.json();
  assert.equal(removePayload.issue.milestone, null);
  const demilestonedEvents = removePayload.issue.activity.filter(
    (e) => e.type === 'demilestoned'
  );
  assert.equal(demilestonedEvents.length, 1);
  assert.equal(demilestonedEvents[0].actor, 'dana-triage');
});

test('REQ-5-3-3: Write users may only view the milestone — the server rejects their submissions', async () => {
  // REQ-6-3-3: bob-reviewer already holds the seeded Write grant, so the
  // explicit module rule can be verified: Write is NOT in the milestone
  // roles (milestones are managed by Triage/Maintain/Admin only).
  const memberPut = await put(milestoneUrl(1, 'v1.0'), memberCookie);
  assert.equal(memberPut.status, 403);
  assert.equal((await memberPut.json()).error, 'Access denied');
  const memberDel = await del(milestoneUrl(1), memberCookie);
  assert.equal(memberDel.status, 403);
});

test('REQ-5-3-3: an unknown issue number is a 404 and changes nothing', async () => {
  const options = await get(milestoneUrl(999), ownerCookie);
  assert.equal(options.status, 404);
  assert.equal((await options.json()).error, 'Issue not found');
  const putRes = await put(milestoneUrl(999, 'v1.0'), ownerCookie);
  assert.equal(putRes.status, 404);
  assert.equal((await putRes.json()).error, 'Issue not found');
  const delRes = await del(milestoneUrl(999), ownerCookie);
  assert.equal(delRes.status, 404);
  assert.equal((await delRes.json()).error, 'Issue not found');
});

test('REQ-5-3-3: after reload only the final milestone state remains, with the historical activity records', async () => {
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const issue1 = store.findIssueByNumber(repo.id, 1);
  assert.equal(
    store.findMilestoneById(issue1.milestoneId).title,
    'Q3 launch'
  );
  assert.deepEqual(
    store.getIssueActivity(issue1.id).map((e) => e.type),
    ['created', 'commented', 'milestoned', 'demilestoned', 'milestoned']
  );
  const issue3 = store.findIssueByNumber(repo.id, 3);
  assert.equal(store.findMilestoneById(issue3.milestoneId).title, 'v1.0');
  const issue2 = store.findIssueByNumber(repo.id, 2);
  assert.equal(issue2.milestoneId, null);
  // The external milestone of acme-internal stays repository-scoped and is
  // not duplicated by reloads.
  const internal = store.findRepositoryByOwnerAndName('acme-demo', 'acme-internal');
  assert.deepEqual(
    store.getRepositoryMilestones(internal.id).map((m) => m.title),
    ['v2.0']
  );
});
