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
let ownerCookie;
let memberCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-branch-protection-test-'));
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

const get = (url, cookie) => request('GET', url, undefined, cookie);
const post = (url, body, cookie) => request('POST', url, body, cookie);
const patch = (url, body, cookie) => request('PATCH', url, body, cookie);

test('REQ-6-1: the seeded pull requests are listed with number, title, author, branches and status', async () => {
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
  const fixSearch = byTitle.get('Fix search');
  assert.ok(fixSearch, 'Fix search must be a seeded pull request');
  assert.equal(fixSearch.number, 2);
  // REQ-6-2-1: the list/filter scenario seeds one Open (`Improve
  // onboarding`) and one Closed (`Fix search`) PR, both by alice-dev.
  assert.equal(fixSearch.status, 'closed');
  assert.equal(fixSearch.baseBranch, 'main');
  assert.equal(fixSearch.compareBranch, 'feature-search');
  assert.equal(onboarding.reviewStatus, 'review_required');
});

test('REQ-6-1: the PR detail page shows the Checks area with test pending and merge eligibility', async () => {
  const res = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  assert.equal(res.status, 200);
  const payload = await res.json();
  const pull = payload.pull;
  assert.equal(pull.title, 'Improve onboarding');
  assert.equal(pull.status, 'open');
  assert.ok(pull.currentCompareCommitId, 'the current compare commit must exist');
  assert.ok(pull.baseCommitId, 'the creation-time base commit must exist');
  // The Open seed targets main from release (the same head commit), so the
  // compare-relative commit list is empty; the Commits view handles it.
  assert.ok(Array.isArray(pull.commits), 'commits is a list');
  assert.equal(pull.checks.test.status, 'pending');
  assert.equal(pull.checks.test.setter, null);
  // Without a protection rule nothing blocks the open PR.
  assert.equal(pull.mergeable, true);
  assert.deepEqual(pull.blockedReasons, []);
  const unknown = await get('/api/repositories/acme-demo/acme-docs/pulls/99');
  assert.equal(unknown.status, 404);
});

test('REQ-6-1: an Admin creates a branch protection rule for main; it persists and blocks direct writes', async () => {
  // Initially no rule exists.
  const before = await get('/api/repositories/acme-demo/acme-docs/branch-protection', ownerCookie);
  assert.equal(before.status, 200);
  assert.deepEqual((await before.json()).rules, []);

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/branch-protection',
    { branchName: 'main', requireApproval: true, requireStatusCheck: true },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.rules.length, 1);
  assert.equal(payload.rules[0].branchName, 'main');
  assert.equal(payload.rules[0].requireApproval, true);
  assert.equal(payload.rules[0].requireStatusCheck, true);

  // Reloading the settings list still shows exactly one rule for main.
  const after = await get('/api/repositories/acme-demo/acme-docs/branch-protection', ownerCookie);
  assert.equal(after.status, 200);
  const rules = (await after.json()).rules;
  assert.equal(rules.length, 1);
  assert.equal(rules[0].branchName, 'main');

  // The protected branch cannot be directly updated to bypass the rule.
  const beforeHead = await (async () => {
    const commits = await get('/api/repositories/acme-demo/acme-docs/commits');
    const body = await commits.json();
    return body.branch ? body.branch.headCommitId : null;
  })();
  const write = await post(
    '/api/repositories/acme-demo/acme-docs/contents',
    { branch: 'main', path: 'bypass.md', content: 'x', message: 'Bypass' },
    ownerCookie
  );
  assert.equal(write.status, 400);
  const writeBody = await write.json();
  assert.equal(writeBody.errors.branch, 'Branch is protected');
  const commitsAfter = await get('/api/repositories/acme-demo/acme-docs/commits');
  const afterHead = (await commitsAfter.json()).branch.headCommitId;
  assert.equal(afterHead, beforeHead, 'the protected branch head must not move');

  // A duplicate rule for the same exact branch name is rejected (existing
  // rules use Save changes instead).
  const dup = await post(
    '/api/repositories/acme-demo/acme-docs/branch-protection',
    { branchName: 'main', requireApproval: true },
    ownerCookie
  );
  assert.equal(dup.status, 400);
  assert.equal((await dup.json()).errors.branchName, 'Rule already exists');

  // An unknown branch name cannot become a rule.
  const unknown = await post(
    '/api/repositories/acme-demo/acme-docs/branch-protection',
    { branchName: 'no-such-branch', requireApproval: true },
    ownerCookie
  );
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).errors.branchName, 'Branch not found');
});

test('REQ-6-1: an existing rule uses Save changes (PATCH) and the toggles persist', async () => {
  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/branch-protection/main',
    { requireApproval: false, requireStatusCheck: true },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.rules.length, 1);
  assert.equal(payload.rules[0].requireApproval, false);
  assert.equal(payload.rules[0].requireStatusCheck, true);
  const after = await get('/api/repositories/acme-demo/acme-docs/branch-protection', ownerCookie);
  assert.equal((await after.json()).rules[0].requireApproval, false);
});

test('REQ-6-1: a non-Admin cannot create or modify rules and the rule stays unchanged', async () => {
  // The readable non-Admin account cannot even read the rule list.
  const list = await get('/api/repositories/acme-demo/acme-docs/branch-protection', memberCookie);
  assert.equal(list.status, 403);

  const create = await post(
    '/api/repositories/acme-demo/acme-docs/branch-protection',
    { branchName: 'feature-search', requireApproval: true },
    memberCookie
  );
  assert.equal(create.status, 403);

  const update = await patch(
    '/api/repositories/acme-demo/acme-docs/branch-protection/main',
    { requireApproval: true, requireStatusCheck: false },
    memberCookie
  );
  assert.equal(update.status, 403);

  // No protection rule was saved; the admin-created rule is unchanged.
  const after = await get('/api/repositories/acme-demo/acme-docs/branch-protection', ownerCookie);
  const rules = (await after.json()).rules;
  assert.equal(rules.length, 1);
  assert.equal(rules[0].branchName, 'main');
  assert.equal(rules[0].requireApproval, false);
  assert.equal(rules[0].requireStatusCheck, true);
});

test('REQ-6-1: an Admin updates the test check to success; the result persists for that compare commit', async () => {
  // Re-enable the approval requirement so the merge-eligibility rule applies.
  await patch(
    '/api/repositories/acme-demo/acme-docs/branch-protection/main',
    { requireApproval: true, requireStatusCheck: true },
    ownerCookie
  );

  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/pulls/1/checks',
    { status: 'success' },
    ownerCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  const check = payload.pull.checks.test;
  assert.equal(check.status, 'success');
  assert.equal(check.setter, 'alice-dev');
  assert.ok(check.updatedAt, 'the setter and time are stored with the status');

  // Reloading the PR detail page preserves the result for that compare commit.
  const reload = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  const reloaded = (await reload.json()).pull;
  assert.equal(reloaded.checks.test.status, 'success');
  assert.equal(reloaded.checks.test.setter, 'alice-dev');
  assert.ok(reloaded.checks.test.updatedAt);
  assert.equal(reloaded.currentCompareCommitId, payload.pull.currentCompareCommitId);

  // A PR without 1 valid non-author approval is still unmergeable.
  assert.equal(reloaded.mergeable, false);
  assert.ok(
    reloaded.blockedReasons.includes('Review required by branch protection')
  );
  assert.ok(
    !reloaded.blockedReasons.includes(
      'Required status check "test" is not successful.'
    ),
    'success on the current compare commit satisfies the status check'
  );
});

test('REQ-6-1: a non-Admin cannot update the check status from the Checks area', async () => {
  const before = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  const beforeStatus = (await before.json()).pull.checks.test.status;

  const res = await patch(
    '/api/repositories/acme-demo/acme-docs/pulls/1/checks',
    { status: 'failure' },
    memberCookie
  );
  assert.equal(res.status, 403);

  const unauthenticated = await patch(
    '/api/repositories/acme-demo/acme-docs/pulls/1/checks',
    { status: 'failure' }
  );
  assert.equal(unauthenticated.status, 401);

  // The stored status is unchanged.
  const after = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  assert.equal((await after.json()).pull.checks.test.status, beforeStatus);

  // Invalid statuses are rejected without changing anything.
  const invalid = await patch(
    '/api/repositories/acme-demo/acme-docs/pulls/1/checks',
    { status: 'shipped' },
    ownerCookie
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).errors.status, 'Status is invalid');
});

test('REQ-6-1: when the compare branch gains a new commit the new compare commit starts pending', async () => {
  const before = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  const beforePull = (await before.json()).pull;

  // The Admin commits a new file to the compare branch of the Open seed PR
  // (release — the pair main ← feature-search stays free for REQ-6-2-3
  // creation, so the Open PR targets main from release).
  const write = await post(
    '/api/repositories/acme-demo/acme-docs/contents',
    {
      branch: 'release',
      path: 'pr-flow.md',
      content: 'pr flow',
      message: 'PR flow commit',
    },
    ownerCookie
  );
  assert.equal(write.status, 201);

  const after = await get('/api/repositories/acme-demo/acme-docs/pulls/1');
  const afterPull = (await after.json()).pull;
  assert.notEqual(afterPull.currentCompareCommitId, beforePull.currentCompareCommitId);
  assert.equal(afterPull.checks.test.status, 'pending');
  assert.equal(afterPull.checks.test.setter, null);
  assert.equal(afterPull.mergeable, false);
  assert.ok(
    afterPull.blockedReasons.includes(
      'Required status check "test" is not successful.'
    ),
    'success from the old commit cannot be used for merging'
  );
});
