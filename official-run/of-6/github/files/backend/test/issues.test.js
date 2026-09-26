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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issues-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function get(url, cookie) {
  return fetch(`${baseUrl}${url}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test('a visitor can read the seeded issue rows of the public repository', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/issues');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.issues.length, 3);
  const open = payload.issues.find((i) => i.number === 1);
  const closed = payload.issues.find((i) => i.number === 2);
  const invalidEdit = payload.issues.find((i) => i.number === 3);
  assert.equal(open.title, 'Improve onboarding');
  assert.equal(open.state, 'open');
  assert.equal(open.author, 'alice-dev');
  assert.deepEqual(open.labels, ['bug', 'documentation']);
  assert.deepEqual(open.milestone, { title: 'Q3 launch' });
  assert.equal(closed.title, 'Legacy welcome text');
  assert.equal(closed.state, 'closed');
  assert.equal(closed.author, 'alice-dev');
  assert.deepEqual(closed.labels, ['bug']);
  assert.equal(closed.milestone, null);
  // REQ-5-2-2: the invalid-edit seed is a separate issue whose original
  // title is `Original issue title`.
  assert.equal(invalidEdit.title, 'Original issue title');
  assert.equal(invalidEdit.state, 'open');
  assert.deepEqual(invalidEdit.labels, []);
  assert.equal(invalidEdit.milestone, null);
  // Every row references the persisted issue number and the update time.
  for (const issue of payload.issues) {
    assert.equal(typeof issue.number, 'number');
    assert.equal(typeof issue.updatedAt, 'string');
    assert.equal(typeof issue.body, 'string');
  }
  // The label filter options are the repository's pre-existing labels.
  assert.deepEqual(payload.labels, ['bug', 'documentation']);
});

test('the issue detail page reads the same persisted record by number', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/issues/1');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.issue.number, 1);
  assert.equal(payload.issue.title, 'Improve onboarding');
  assert.equal(payload.issue.state, 'open');
  assert.equal(payload.issue.author, 'alice-dev');
  assert.equal(payload.issue.body, 'Describe the onboarding improvement.');
  assert.deepEqual(payload.issue.labels, ['bug', 'documentation']);
  assert.deepEqual(payload.issue.milestone, { title: 'Q3 launch' });
  assert.equal(payload.issue.closedAt, null);
  // REQ-5-1-2: the detail read view carries the assignee, the saved
  // comment, and the activity timeline in chronological order.
  assert.deepEqual(payload.issue.assignees, ['alice-dev']);
  assert.equal(payload.issue.comments.length, 1);
  assert.equal(payload.issue.comments[0].author, 'alice-dev');
  assert.equal(typeof payload.issue.comments[0].body, 'string');
  assert.equal(typeof payload.issue.comments[0].createdAt, 'string');
  assert.deepEqual(
    payload.issue.activity.map((e) => e.type),
    ['created', 'commented']
  );
  assert.equal(payload.issue.activity[0].actor, 'alice-dev');
  assert.equal(payload.issue.activity[1].actor, 'alice-dev');
  assert.ok(
    payload.issue.activity[0].createdAt <= payload.issue.activity[1].createdAt,
    'activity must be chronological'
  );
  assert.equal(
    payload.issue.activity[1].body,
    payload.issue.comments[0].body
  );

  const closedRes = await get('/api/repositories/acme-demo/acme-docs/issues/2');
  assert.equal(closedRes.status, 200);
  const closedPayload = await closedRes.json();
  assert.equal(closedPayload.issue.title, 'Legacy welcome text');
  assert.equal(closedPayload.issue.state, 'closed');
  assert.ok(closedPayload.issue.body.includes('onboarding'));
  assert.deepEqual(closedPayload.issue.labels, ['bug']);
  assert.equal(closedPayload.issue.milestone, null);
  assert.ok(closedPayload.issue.closedAt);
});

test('an unknown issue number is a 404 and does not change any data', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/issues/999');
  assert.equal(res.status, 404);
  const payload = await res.json();
  assert.equal(payload.error, 'Issue not found');
});

test('a visitor cannot read issues of a private repository without permission', async () => {
  const res = await get('/api/repositories/alice-dev/secret-research/issues');
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Access denied');
});

test('an older REQ-5-1-1 store is migrated idempotently: verbatim body, assignee, comment and activity are gap-filled', async () => {
  const { createStore } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issues-migrate-'));
  const filePath = path.join(dir, 'data.json');
  const legacy =
    'The onboarding flow is hard to follow for new contributors.\n' +
    'Improve the setup instructions and the first-run experience.';
  try {
    const store = createStore(dir);
    const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
    const issue = store.getRepositoryIssues(repo.id).find((i) => i.number === 1);
    // Rewrite the store file as a REQ-5-1-1-era store: the legacy seed body
    // and no discussion records at all.
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.issues.find((i) => i.id === issue.id).body = legacy;
    data.issueAssignees = [];
    data.issueComments = [];
    data.issueActivity = [];
    fs.writeFileSync(filePath, JSON.stringify(data));

    // The next load runs backfillSeedGaps and migrates the gap idempotently.
    const store2 = createStore(dir);
    const issue2 = store2
      .getRepositoryIssues(
        store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs').id
      )
      .find((i) => i.number === 1);
    assert.equal(issue2.body, 'Describe the onboarding improvement.');
    assert.deepEqual(store2.getIssueAssignees(issue2.id), ['alice-dev']);
    assert.equal(store2.getIssueComments(issue2.id).length, 1);
    assert.deepEqual(
      store2.getIssueActivity(issue2.id).map((e) => e.type),
      ['created', 'commented']
    );
    // Reloading again adds nothing (idempotent) and a user-edited body is kept.
    const store3 = createStore(dir);
    const issue3 = store3
      .getRepositoryIssues(
        store3.findRepositoryByOwnerAndName('acme-demo', 'acme-docs').id
      )
      .find((i) => i.number === 1);
    assert.equal(store3.getIssueComments(issue3.id).length, 1);
    assert.equal(store3.getIssueActivity(issue3.id).length, 2);
    assert.equal(issue3.body, 'Describe the onboarding improvement.');
    // A user edits the description; the next reload preserves the edit.
    const edited = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    edited.issues.find((i) => i.id === issue3.id).body = 'User edited description.';
    fs.writeFileSync(filePath, JSON.stringify(edited));
    const store4 = createStore(dir);
    const issue4 = store4
      .getRepositoryIssues(
        store4.findRepositoryByOwnerAndName('acme-demo', 'acme-docs').id
      )
      .find((i) => i.number === 1);
    assert.equal(issue4.body, 'User edited description.');
    assert.equal(store4.getIssueComments(issue4.id).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the seeded issues survive a store reload and are not duplicated', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const repo = store2.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  assert.ok(repo, 'acme-docs must persist');
  const issues = store2.getRepositoryIssues(repo.id);
  assert.equal(issues.length, 3);
  assert.equal(issues[0].title, 'Improve onboarding');
  assert.equal(issues[0].state, 'open');
  assert.equal(issues[1].title, 'Legacy welcome text');
  assert.equal(issues[1].state, 'closed');
  assert.equal(issues[2].title, 'Original issue title');
  assert.equal(issues[2].state, 'open');
  assert.deepEqual(store2.getIssueLabelNames(issues[0].id), ['bug', 'documentation']);
  assert.deepEqual(store2.getIssueLabelNames(issues[1].id), ['bug']);
  assert.deepEqual(store2.getIssueLabelNames(issues[2].id), []);
  const labels = store2.getRepositoryLabels(repo.id);
  assert.deepEqual(labels.map((l) => l.name), ['bug', 'documentation']);
  // REQ-5-1-2: the discussion records are persisted and not duplicated.
  assert.equal(issues[0].body, 'Describe the onboarding improvement.');
  assert.deepEqual(store2.getIssueAssignees(issues[0].id), ['alice-dev']);
  assert.equal(store2.getIssueComments(issues[0].id).length, 1);
  assert.deepEqual(
    store2.getIssueActivity(issues[0].id).map((e) => e.type),
    ['created', 'commented']
  );
  assert.equal(store2.getIssueAssignees(issues[1].id).length, 0);
  assert.equal(store2.getIssueComments(issues[1].id).length, 0);
  assert.equal(store2.getIssueActivity(issues[1].id).length, 0);
  const store3 = createStore(dataDir);
  const repo3 = store3.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const issues3 = store3.getRepositoryIssues(repo3.id);
  assert.equal(issues3.length, 3, 'reload must not duplicate issues');
  assert.equal(store3.getIssueComments(issues3[0].id).length, 1);
  assert.equal(store3.getIssueActivity(issues3[0].id).length, 2);
  assert.equal(issues3[2].title, 'Original issue title');
  assert.equal(store3.getIssueActivity(issues3[2].id).length, 1);
});
