'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { validateIssueComment, validateIssueReaction } = require('../src/validation');

let dataDir;
let server;
let baseUrl;
let ownerCookie;
let memberCookie;
let bobCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-comment-test-'));
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
  // user (carol-dev) plays the rejected Read fixture of the comment rules.
  memberCookie = await signin('carol-dev');
  bobCookie = await signin('bob-reviewer');
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

const post = (url, body, cookie) => request('POST', url, body, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

async function detail(number, cookie) {
  const res = await get(`/api/repositories/acme-demo/acme-docs/issues/${number}`, cookie);
  assert.equal(res.status, 200);
  const payload = await res.json();
  return { issue: payload.issue, role: payload.role };
}

test('validateIssueComment implements the REQ-5-2-3 rules', () => {
  assert.deepEqual(validateIssueComment({ body: 'A comment' }), {});
  assert.deepEqual(validateIssueComment({ body: '  A comment  ' }), {});
  assert.deepEqual(validateIssueComment({ body: 'x'.repeat(65536) }), {});
  // Whitespace-only text reports the exact visible message.
  assert.deepEqual(validateIssueComment({ body: '   ' }), {
    body: 'Comment is required',
  });
  assert.deepEqual(validateIssueComment({ body: '' }), {
    body: 'Comment is required',
  });
  assert.deepEqual(validateIssueComment({}), {
    body: 'Comment is required',
  });
  assert.deepEqual(validateIssueComment({ body: 'x'.repeat(65537) }), {
    body: 'Comment is too long',
  });
});

test('validateIssueReaction requires a non-empty reaction type', () => {
  assert.deepEqual(validateIssueReaction({ reaction: '👍' }), {});
  assert.deepEqual(validateIssueReaction({ reaction: '  👍  ' }), {});
  assert.deepEqual(validateIssueReaction({ reaction: '' }), {
    reaction: 'Reaction is required',
  });
  assert.deepEqual(validateIssueReaction({}), {
    reaction: 'Reaction is required',
  });
});

test('REQ-5-2-3: unauthenticated and Read callers cannot comment; the server rejects their submissions without changing anything', async () => {
  const anonymous = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/comments',
    { body: 'anon comment' }
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, 'Authentication required');

  // bob-reviewer has Read on the public repository -> Access denied.
  const member = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/comments',
    { body: 'not allowed' },
    memberCookie
  );
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error, 'Access denied');

  // Neither submission appended a comment or a timeline record.
  const { issue } = await detail(1);
  assert.equal(issue.comments.length, 1);
  assert.deepEqual(
    issue.activity.map((e) => e.type),
    ['created', 'commented']
  );
});

test('REQ-5-2-3: an unknown issue number or comment is a 404 and changes nothing', async () => {
  const missingIssue = await post(
    '/api/repositories/acme-demo/acme-docs/issues/999/comments',
    { body: 'nope' },
    ownerCookie
  );
  assert.equal(missingIssue.status, 404);
  assert.equal((await missingIssue.json()).error, 'Issue not found');

  const missingComment = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/comments/does-not-exist/reactions',
    { reaction: '👍' },
    ownerCookie
  );
  assert.equal(missingComment.status, 404);
  assert.equal((await missingComment.json()).error, 'Comment not found');
});

test('REQ-5-2-3: a Write/Maintain/Admin user appends a comment; it shows the author, body, and time and survives reload', async () => {
  const before = await detail(1, ownerCookie);
  assert.equal(before.issue.comments.length, 1);

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/comments',
    { body: '  This is a new discussion comment.  ' },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.role, 'admin');
  const issue = payload.issue;
  assert.equal(issue.number, 1);
  assert.equal(issue.title, 'Improve onboarding', 'title unchanged');
  assert.equal(issue.state, 'open', 'status unchanged');
  // The comment is stored with the trimmed body, the current user, and a
  // creation time; it is part of the discussion and the activity timeline.
  assert.equal(issue.comments.length, 2);
  const added = issue.comments[issue.comments.length - 1];
  assert.equal(added.author, 'alice-dev');
  assert.equal(added.body, 'This is a new discussion comment.');
  assert.equal(typeof added.createdAt, 'string');
  assert.deepEqual(added.reactions, []);
  assert.deepEqual(
    issue.activity.map((e) => e.type),
    ['created', 'commented', 'commented']
  );
  const addedEvent = issue.activity[issue.activity.length - 1];
  assert.equal(addedEvent.actor, 'alice-dev');
  assert.equal(addedEvent.body, 'This is a new discussion comment.');
  assert.equal(addedEvent.commentId, added.id);

  // The saved comment remains after reload (fresh store read).
  const reloaded = await detail(1, ownerCookie);
  assert.equal(reloaded.issue.comments.length, 2);
  assert.equal(
    reloaded.issue.comments[reloaded.issue.comments.length - 1].body,
    'This is a new discussion comment.'
  );
  assert.deepEqual(
    reloaded.issue.activity.map((e) => e.type),
    ['created', 'commented', 'commented']
  );
});

test('REQ-5-2-3: blank, over-long, and failed comment submissions append no comment and no timeline record', async () => {
  const before = await detail(1, ownerCookie);
  const commentsBefore = before.issue.comments.length;
  const activityBefore = before.issue.activity.length;

  const blank = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/comments',
    { body: '   ' },
    ownerCookie
  );
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).errors.body, 'Comment is required');

  const overlong = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/comments',
    { body: 'x'.repeat(65537) },
    ownerCookie
  );
  assert.equal(overlong.status, 400);
  assert.equal((await overlong.json()).errors.body, 'Comment is too long');

  // Nothing was appended; the discussion count is unchanged.
  const after = await detail(1, ownerCookie);
  assert.equal(after.issue.comments.length, commentsBefore);
  assert.equal(after.issue.activity.length, activityBefore);
});

test('REQ-5-2-3: a persistence failure rolls back the comment and the timeline record', async () => {
  const { createStore } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issue-comment-fail-'));
  try {
    const store = createStore(dir);
    const alice = store.findAccountByUsername('alice-dev');
    const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
    const issue = store.findIssueByNumber(repo.id, 1);
    const commentsBefore = store.getIssueComments(issue.id).length;
    const activityBefore = store.getIssueActivity(issue.id).length;

    // Sabotage the store file so the next persist throws.
    const filePath = path.join(dir, 'data.json');
    fs.rmSync(filePath);
    fs.mkdirSync(filePath);

    assert.throws(() =>
      store.addIssueComment(issue.id, 'Will not persist', alice.id)
    );
    // The rollback leaves no partial comment or timeline record.
    assert.equal(store.getIssueComments(issue.id).length, commentsBefore);
    assert.equal(store.getIssueActivity(issue.id).length, activityBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('REQ-5-2-3: a signed-in viewer may react to a comment; the same reaction again removes it and never duplicates', async () => {
  // bob-reviewer (Write via the seeded reviewer grant) is signed in, so he
  // may add/remove his own reactions on the existing comment.
  const { issue, role } = await detail(1, bobCookie);
  assert.equal(role, 'write');
  const seedComment = issue.comments[0];
  assert.deepEqual(seedComment.reactions, []);

  const addRes = await post(
    `/api/repositories/acme-demo/acme-docs/issues/1/comments/${encodeURIComponent(seedComment.id)}/reactions`,
    { reaction: '👍' },
    bobCookie
  );
  assert.equal(addRes.status, 200);
  const addPayload = await addRes.json();
  const targetAfterAdd = addPayload.issue.comments.find(
    (c) => c.id === seedComment.id
  );
  assert.deepEqual(targetAfterAdd.reactions, [
    { reaction: '👍', count: 1, reactedByMe: true },
  ]);

  // The same user selecting the same reaction again removes the association
  // (no duplicate association can exist).
  const removeRes = await post(
    `/api/repositories/acme-demo/acme-docs/issues/1/comments/${encodeURIComponent(seedComment.id)}/reactions`,
    { reaction: '👍' },
    bobCookie
  );
  assert.equal(removeRes.status, 200);
  const removePayload = await removeRes.json();
  const targetAfterRemove = removePayload.issue.comments.find(
    (c) => c.id === seedComment.id
  );
  assert.deepEqual(targetAfterRemove.reactions, []);

  // Two different accounts may both react; the count reflects both.
  const aliceRes = await post(
    `/api/repositories/acme-demo/acme-docs/issues/1/comments/${encodeURIComponent(seedComment.id)}/reactions`,
    { reaction: '👍' },
    ownerCookie
  );
  assert.equal(aliceRes.status, 200);
  const alicePayload = await aliceRes.json();
  const forAlice = alicePayload.issue.comments.find((c) => c.id === seedComment.id);
  assert.deepEqual(forAlice.reactions, [
    { reaction: '👍', count: 1, reactedByMe: true },
  ]);

  const bobRes = await post(
    `/api/repositories/acme-demo/acme-docs/issues/1/comments/${encodeURIComponent(seedComment.id)}/reactions`,
    { reaction: '👍' },
    bobCookie
  );
  assert.equal(bobRes.status, 200);
  const bobPayload = await bobRes.json();
  const forBob = bobPayload.issue.comments.find((c) => c.id === seedComment.id);
  assert.deepEqual(forBob.reactions, [
    { reaction: '👍', count: 2, reactedByMe: true },
  ]);
  // alice sees the same count and her own state.
  const aliceReload = await detail(1, ownerCookie);
  const forAlice2 = aliceReload.issue.comments.find((c) => c.id === seedComment.id);
  assert.deepEqual(forAlice2.reactions, [
    { reaction: '👍', count: 2, reactedByMe: true },
  ]);

  // Reactions persist after a store reload.
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const issue2 = store.findIssueByNumber(repo.id, 1);
  assert.deepEqual(
    store.getIssueReactionGroups(issue2.id, 'comment', seedComment.id, null),
    [{ reaction: '👍', count: 2, reactedByMe: false }]
  );
});

test('REQ-5-2-3: signed-in viewers may react to the issue itself; anonymous callers are rejected', async () => {
  const anonymous = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/reactions',
    { reaction: '❤️' }
  );
  assert.equal(anonymous.status, 401);

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/reactions',
    { reaction: '❤️' },
    memberCookie
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.issue.reactions, [
    { reaction: '❤️', count: 1, reactedByMe: true },
  ]);

  const removeRes = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/reactions',
    { reaction: '❤️' },
    memberCookie
  );
  assert.equal(removeRes.status, 200);
  const removePayload = await removeRes.json();
  assert.deepEqual(removePayload.issue.reactions, []);

  // An empty reaction type is a field error.
  const empty = await post(
    '/api/repositories/acme-demo/acme-docs/issues/1/reactions',
    { reaction: '   ' },
    memberCookie
  );
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).errors.reaction, 'Reaction is required');
});
