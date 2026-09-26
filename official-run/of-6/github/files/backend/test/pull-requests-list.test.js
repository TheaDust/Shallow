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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-requests-list-test-'));
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

function request(method, url, body, cookie) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('REQ-6-2-1: the public Pull requests list is directly accessible to a visitor', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/pulls');
  assert.equal(res.status, 200);
  const payload = await res.json();
  // REQ-6-3-3: acme-docs also carries the separate Open seed PR `Pending
  // review scenario` (main ← pending-review) for the pending-comment flow.
  assert.equal(payload.pulls.length, 4);
  const byTitle = new Map(payload.pulls.map((p) => [p.title, p]));
  const onboarding = byTitle.get('Improve onboarding');
  assert.ok(onboarding, 'Improve onboarding must be a seeded pull request');
  assert.equal(onboarding.number, 1);
  assert.equal(onboarding.author, 'alice-dev');
  assert.equal(onboarding.status, 'open');
  assert.equal(onboarding.baseBranch, 'main');
  // REQ-6-2-3: the Open seed targets main from the `release` branch so the
  // main ← feature-search pair stays free of Open/Draft PRs for creation.
  assert.equal(onboarding.compareBranch, 'release');
  assert.equal(onboarding.reviewStatus, 'review_required');
  const fixSearch = byTitle.get('Fix search');
  assert.ok(fixSearch, 'Fix search must be a seeded pull request');
  assert.equal(fixSearch.number, 2);
  assert.equal(fixSearch.author, 'alice-dev');
  // REQ-6-2-1 scenario: one Open and one Closed PR created by alice.
  assert.equal(fixSearch.status, 'closed');
  assert.equal(fixSearch.baseBranch, 'main');
  assert.equal(fixSearch.compareBranch, 'feature-search');
  assert.equal(fixSearch.reviewStatus, 'review_required');
  // REQ-6-2-4: the dedicated ready-for-review seed PR is a Draft by the
  // same author on main ← draft-feature, displayed verbatim in the list.
  const draft = byTitle.get('Draft onboarding update');
  assert.ok(draft, 'Draft onboarding update must be a seeded pull request');
  assert.equal(draft.number, 3);
  assert.equal(draft.author, 'alice-dev');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.baseBranch, 'main');
  assert.equal(draft.compareBranch, 'draft-feature');
  assert.equal(draft.reviewStatus, 'review_required');
  // Both rows carry the review-status field the list filter reads.
  for (const pull of payload.pulls) {
    assert.ok(
      ['approved', 'changes_requested', 'review_required'].includes(pull.reviewStatus),
      'each row must carry a valid review status'
    );
  }
});

test('REQ-6-2-1: the Open PR title is the detail heading and the Closed PR detail shows Closed', async () => {
  const openDetail = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  assert.equal(openDetail.status, 200);
  const open = (await openDetail.json()).pull;
  assert.equal(open.title, 'Improve onboarding');
  assert.equal(open.status, 'open');

  const closedDetail = await get('/api/repositories/acme-demo/acme-docs/pulls/2');
  assert.equal(closedDetail.status, 200);
  const closed = (await closedDetail.json()).pull;
  assert.equal(closed.title, 'Fix search');
  assert.equal(closed.status, 'closed');

  const unknown = await get('/api/repositories/acme-demo/acme-docs/pulls/99');
  assert.equal(unknown.status, 404);
});

test('REQ-6-2-1: an unauthenticated visitor cannot list pull requests of a private repository', async () => {
  const res = await get('/api/repositories/acme-demo/acme-internal/pulls');
  assert.equal(res.status, 403);
});
