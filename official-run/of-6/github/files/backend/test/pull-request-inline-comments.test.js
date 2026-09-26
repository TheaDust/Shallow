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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pull-inline-comments-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
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

async function signIn(username) {
  const res = await post('/api/auth/signin', {
    identifier: username,
    password: 'Valid-password-123!',
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function detail(number, cookie) {
  const res = await get(`/api/repositories/acme-demo/acme-docs/pulls/${number}`, cookie);
  assert.equal(res.status, 200);
  return (await res.json()).pull;
}

const commentUrl = (number) =>
  `/api/repositories/acme-demo/acme-docs/pulls/${number}/inline-comments`;

test('REQ-6-3-3: seed data supplies a non-author Write reviewer and a separate Open PR with changed lines', async () => {
  // bob-reviewer (the reviewer) holds Write on acme-docs via the seed.
  const ownerCookie = await signIn('alice-dev');
  const access = await get('/api/repositories/acme-demo/acme-docs/access', ownerCookie);
  assert.equal(access.status, 200);
  const grants = (await access.json()).grants;
  const bobGrant = grants.find((g) => g.subjectName === 'bob-reviewer');
  assert.ok(bobGrant, 'bob-reviewer must have a seeded grant');
  assert.equal(bobGrant.role, 'write');
  assert.equal(bobGrant.grantedBy, 'alice-dev');

  // The separate Open PR `Pending review scenario` exists with changed lines.
  const pulls = await get('/api/repositories/acme-demo/acme-docs/pulls');
  const list = (await pulls.json()).pulls;
  const pending = list.find((p) => p.title === 'Pending review scenario');
  assert.ok(pending, 'the pending-comment seed PR must exist');
  assert.equal(pending.number, 4);
  assert.equal(pending.status, 'open');
  assert.equal(pending.author, 'alice-dev');
  assert.equal(pending.baseBranch, 'main');
  assert.equal(pending.compareBranch, 'pending-review');

  const pendingDetail = await detail(4, ownerCookie);
  assert.ok(pendingDetail.filesChanged.length >= 1, 'the pending PR has changed lines');
  assert.deepEqual(pendingDetail.inlineComments, [], 'no comments are seeded');
  assert.equal(
    pendingDetail.filesChanged.some((f) => f.path === 'pending-review.md'),
    true,
    'the pending PR diff contains the commentable seed file'
  );

  // The Open reviewable PR `Improve onboarding` carries at least one added
  // line (src/search.ts) for the single-comment scenario.
  const onboardingDetail = await detail(1, ownerCookie);
  const searchTs = onboardingDetail.filesChanged.find((f) => f.path === 'src/search.ts');
  assert.ok(searchTs, 'Improve onboarding diff contains src/search.ts');
  assert.ok(
    searchTs.lines.some((l) => l.type === 'add'),
    'the modified file has an added line'
  );
});

test('REQ-6-3-3 scenario 1: a non-author Write reviewer publishes an inline comment with Add single comment; it persists and is visible to every viewer', async () => {
  const bobCookie = await signIn('bob-reviewer');
  const before = await detail(1, bobCookie);
  const searchTs = before.filesChanged.find((f) => f.path === 'src/search.ts');
  const addLine = searchTs.lines.findIndex((l) => l.type === 'add');
  assert.ok(addLine >= 0);

  // The reviewer locates an added code line, enters a non-empty inline
  // comment, and selects Add single comment (published immediately).
  const res = await post(
    commentUrl(1),
    {
      filePath: 'src/search.ts',
      line: addLine,
      body: 'This line should stay aligned with the onboarding docs.',
      pending: false,
    },
    bobCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.role, 'write');
  const pull = payload.pull;
  const comments = pull.inlineComments;
  assert.equal(comments.length, 1);
  const comment = comments[0];
  assert.equal(comment.filePath, 'src/search.ts');
  assert.equal(comment.line, addLine);
  assert.equal(comment.body, 'This line should stay aligned with the onboarding docs.');
  assert.equal(comment.author, 'bob-reviewer');
  assert.equal(comment.pending, false);
  assert.equal(comment.outdated, false);
  assert.equal(comment.commitId, pull.currentCompareCommitId);
  assert.equal(typeof comment.createdAt, 'string');

  // The comment record is anchored to the PR, file path, diff commit, and
  // target line position; it is not an ordinary discussion comment.
  assert.equal(pull.comments.length, 1, 'the ordinary discussion comment is untouched');

  // After refresh the comment remains anchored to that file and line.
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const persisted = store.findPullRequestByNumber(repo.id, 1);
  const storedComments = store.getPullRequestInlineComments(persisted.id, null, persisted.compareCommitId);
  assert.equal(storedComments.length, 1);
  assert.equal(storedComments[0].body, 'This line should stay aligned with the onboarding docs.');

  // A different viewer (the PR author) sees the same published comment.
  const aliceCookie = await signIn('alice-dev');
  const aliceView = await detail(1, aliceCookie);
  assert.equal(aliceView.inlineComments.length, 1);
  assert.equal(aliceView.inlineComments[0].author, 'bob-reviewer');
});

test('REQ-6-3-3 scenario 2: Start a review keeps the comment pending — visible to its author, not public until the review is submitted', async () => {
  const bobCookie = await signIn('bob-reviewer');
  const before = await detail(4, bobCookie);
  const pendingFile = before.filesChanged.find((f) => f.path === 'pending-review.md');
  const addLine = pendingFile.lines.findIndex((l) => l.type === 'add');
  assert.ok(addLine >= 0);

  // The reviewer enters an inline comment and selects Start a review.
  const res = await post(
    commentUrl(4),
    {
      filePath: 'pending-review.md',
      line: addLine,
      body: 'Pending comment for the onboarding notes.',
      pending: true,
    },
    bobCookie
  );
  assert.equal(res.status, 201);
  const pull = (await res.json()).pull;
  const pendingComment = pull.inlineComments.find((c) => c.body === 'Pending comment for the onboarding notes.');
  assert.ok(pendingComment, 'the pending comment is returned to its author');
  assert.equal(pendingComment.pending, true);
  assert.equal(pendingComment.author, 'bob-reviewer');

  // The pending comment persists after reload (still pending).
  const reload = await detail(4, bobCookie);
  assert.ok(
    reload.inlineComments.some((c) => c.body === 'Pending comment for the onboarding notes.' && c.pending === true),
    'the pending draft survives a reload'
  );

  // It is not public: another viewer (the PR author) does not see it, and
  // the anonymous viewer does not see it either.
  const aliceCookie = await signIn('alice-dev');
  const aliceView = await detail(4, aliceCookie);
  assert.ok(
    !aliceView.inlineComments.some((c) => c.body === 'Pending comment for the onboarding notes.'),
    'the pending draft is not visible to other users'
  );
  const anonView = await detail(4);
  assert.equal(anonView.inlineComments.length, 0);
});

test('REQ-6-3-3: when the compare commit changes, published comments are retained but marked Outdated; pending drafts are not published automatically', async () => {
  const bobCookie = await signIn('bob-reviewer');
  const aliceCookie = await signIn('alice-dev');

  // bob publishes one comment and starts one pending draft on PR #1
  // (main ← release).
  const before = await detail(1, bobCookie);
  const searchTs = before.filesChanged.find((f) => f.path === 'src/search.ts');
  const addLine = searchTs.lines.findIndex((l) => l.type === 'add');
  await post(
    commentUrl(1),
    { filePath: 'src/search.ts', line: addLine, body: 'Published before the branch moves.', pending: false },
    bobCookie
  );
  await post(
    commentUrl(1),
    { filePath: 'src/search.ts', line: addLine, body: 'Draft before the branch moves.', pending: true },
    bobCookie
  );

  // alice advances the compare branch with a new commit.
  const write = await post(
    '/api/repositories/acme-demo/acme-docs/contents',
    { branch: 'release', path: 'advance.md', content: 'new content', message: 'Advance release' },
    aliceCookie
  );
  assert.equal(write.status, 201);

  // The published comment is retained but marked Outdated; the pending draft
  // is not published automatically (it stays a pending draft, invisible to
  // other users).
  const aliceView = await detail(1, aliceCookie);
  const published = aliceView.inlineComments.find((c) => c.body === 'Published before the branch moves.');
  assert.ok(published, 'the published comment is retained after the compare commit changes');
  assert.equal(published.outdated, true);
  assert.ok(
    !aliceView.inlineComments.some((c) => c.body === 'Draft before the branch moves.'),
    'the pending draft is not published automatically'
  );

  // The author of the pending draft still sees it as pending.
  const bobView = await detail(1, bobCookie);
  const draft = bobView.inlineComments.find((c) => c.body === 'Draft before the branch moves.');
  assert.ok(draft, 'the draft remains visible to its author');
  assert.equal(draft.pending, true);
});

test('REQ-6-3-3: empty, over-long, or invalid comments and failed submissions are rejected and never displayed as published', async () => {
  const bobCookie = await signIn('bob-reviewer');
  const before = await detail(1, bobCookie);
  const searchTs = before.filesChanged.find((f) => f.path === 'src/search.ts');
  const addLine = searchTs.lines.findIndex((l) => l.type === 'add');

  // Empty comment: rejected with the exact message, no record created.
  const empty = await post(
    commentUrl(1),
    { filePath: 'src/search.ts', line: addLine, body: '   ', pending: false },
    bobCookie
  );
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).errors.body, 'Comment is required');

  // Over-long comment: rejected.
  const long = await post(
    commentUrl(1),
    { filePath: 'src/search.ts', line: addLine, body: 'y'.repeat(65537), pending: false },
    bobCookie
  );
  assert.equal(long.status, 400);
  assert.equal((await long.json()).errors.body, 'Comment is too long');

  // A file that is not part of the current diff is rejected.
  const wrongFile = await post(
    commentUrl(1),
    { filePath: 'README.md', line: 0, body: 'not part of the diff', pending: false },
    bobCookie
  );
  assert.equal(wrongFile.status, 400);
  assert.equal((await wrongFile.json()).errors.filePath, 'File is not part of the diff');

  // A line that is not a changed (added/deleted) line position is rejected.
  const wrongLine = await post(
    commentUrl(1),
    { filePath: 'src/search.ts', line: 99, body: 'out of range', pending: false },
    bobCookie
  );
  assert.equal(wrongLine.status, 400);
  assert.equal((await wrongLine.json()).errors.line, 'Line is not a commentable line');

  const notAnInteger = await post(
    commentUrl(1),
    { filePath: 'src/search.ts', line: 'one', body: 'not numeric', pending: false },
    bobCookie
  );
  assert.equal(notAnInteger.status, 400);
  assert.equal((await notAnInteger.json()).errors.line, 'Line is not a commentable line');

  // None of the rejected submissions left a partial comment behind (the
  // only comments on PR #1 are the ones created by the earlier scenarios).
  const after = await detail(1, bobCookie);
  assert.equal(after.inlineComments.length, 3, 'only the earlier scenario comments remain');
  assert.ok(
    !after.inlineComments.some((c) => c.body === 'not part of the diff' || c.body === 'out of range' || c.body === 'not numeric' || c.body.startsWith('yyy')),
    'rejected comments are not stored'
  );
});

test('REQ-6-3-3: permission rules — the PR author, Read users, anonymous callers, and Draft PRs cannot comment', async () => {
  const bobCookie = await signIn('bob-reviewer');
  const before = await detail(1);
  const searchTs = before.filesChanged.find((f) => f.path === 'src/search.ts');
  const addLine = searchTs.lines.findIndex((l) => l.type === 'add');

  // Anonymous: 401.
  const anon = await post(
    commentUrl(1),
    { filePath: 'src/search.ts', line: addLine, body: 'anon', pending: false }
  );
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).error, 'Authentication required');

  // The PR author (alice-dev, Admin) cannot comment on her own PR: 403.
  const aliceCookie = await signIn('alice-dev');
  const author = await post(
    commentUrl(1),
    { filePath: 'src/search.ts', line: addLine, body: 'own pr', pending: false },
    aliceCookie
  );
  assert.equal(author.status, 403);
  assert.equal((await author.json()).error, 'Access denied');

  // A Read user (carol-dev, signed in but outside the repository scope): 403.
  const carolCookie = await signIn('carol-dev');
  const reader = await post(
    commentUrl(1),
    { filePath: 'src/search.ts', line: addLine, body: 'reader', pending: false },
    carolCookie
  );
  assert.equal(reader.status, 403);
  assert.equal((await reader.json()).error, 'Access denied');

  // A Draft PR does not allow review comments: 400 (bob-reviewer is a
  // non-author Write user, so the draft-status rule is what rejects him).
  const draftDetail = await detail(3, bobCookie);
  const draftFile = draftDetail.filesChanged.find((f) => f.path === 'main-only.md');
  assert.ok(draftFile, 'the Draft PR diff contains main-only.md');
  const draftLine = draftFile.lines.findIndex((l) => l.type === 'add');
  assert.ok(draftLine >= 0);
  const draft = await post(
    commentUrl(3),
    { filePath: draftFile.path, line: draftLine, body: 'on a draft', pending: false },
    bobCookie
  );
  assert.equal(draft.status, 400);
  assert.equal((await draft.json()).errors.general, 'Pull request is not open');

  // Unknown PR: 404.
  const unknown = await post(
    commentUrl(99),
    { filePath: 'src/search.ts', line: 0, body: 'nope', pending: false },
    aliceCookie
  );
  assert.equal(unknown.status, 404);

  // No comment record was created by any rejected call (the earlier
  // scenario comments on PR #1 remain the only ones — an anonymous viewer
  // sees exactly the two published comments, pending drafts are not public).
  const after = await detail(1);
  assert.equal(after.inlineComments.length, 2);
  assert.ok(
    !after.inlineComments.some((c) => c.body === 'anon' || c.body === 'own pr' || c.body === 'reader'),
    'rejected comments are not stored'
  );
});
