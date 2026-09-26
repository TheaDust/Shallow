'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { isValidFilePath, validateFileWrite } = require('../src/validation');

let dataDir;
let server;
let baseUrl;
let ownerCookie;
let memberCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-file-editor-test-'));
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
  // user (carol-dev) plays the rejected Read fixture of the editor rules.
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

const post = (url, body, cookie) => request('POST', url, body, cookie);
const get = (url, cookie) => request('GET', url, undefined, cookie);

async function branchHead(branchName) {
  const res = await get('/api/repositories/acme-demo/acme-docs/branches');
  assert.equal(res.status, 200);
  const payload = await res.json();
  const branch = payload.branches.find((b) => b.name === branchName);
  return branch ? branch.headCommitId : null;
}

test('isValidFilePath implements the REQ-4-4 path rule', () => {
  for (const valid of ['docs/guide.md', 'README.md', 'a/b/c.txt', 'pw-file-abc123.md', 'my file.txt']) {
    assert.equal(isValidFilePath(valid), true, valid);
  }
  for (const invalid of ['', '   ', '/docs/guide.md', '../invalid.md', 'docs/../x.md', '..', 'a/../b']) {
    assert.equal(isValidFilePath(invalid), false, JSON.stringify(invalid));
  }
});

test('validateFileWrite reports the exact REQ-4-4 messages', () => {
  const noConflict = { isPathConflict: () => false };
  assert.deepEqual(validateFileWrite({ path: '../invalid.md', message: '' }, noConflict), {
    path: 'Invalid file path',
    message: 'Commit message is required',
  });
  assert.deepEqual(validateFileWrite({ path: '', message: 'Add file' }, noConflict), {
    path: 'Invalid file path',
  });
  assert.deepEqual(validateFileWrite({ path: 'README.md', message: 'Add file' }, { isPathConflict: () => true }), {
    path: 'Invalid file path',
  });
  assert.deepEqual(validateFileWrite({ path: 'ok.md', message: '  ' }, noConflict), {
    message: 'Commit message is required',
  });
  assert.deepEqual(validateFileWrite({ path: 'ok.md', message: 'x'.repeat(73) }, noConflict), {
    message: 'Commit message is too long',
  });
  assert.deepEqual(validateFileWrite({ path: 'ok.md', message: 'Add ok.md' }, noConflict), {});
});

test('REQ-4-4 scenario 1: alice-dev creates docs/guide.md as one commit whose parent is the branch head', async () => {
  const beforeHead = await branchHead('main');

  const res = await post(
    '/api/repositories/acme-demo/acme-docs/contents',
    {
      branch: 'main',
      path: 'docs/guide.md',
      content: '# Guide\n\nStep by step instructions.\n',
      message: 'Add guide',
    },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.branch.name, 'main');
  assert.equal(typeof payload.commit.id, 'string');
  assert.equal(payload.commit.message, 'Add guide');
  assert.equal(payload.commit.author, 'alice-dev');
  assert.equal(payload.file.path, 'docs/guide.md');
  assert.equal(payload.file.content, '# Guide\n\nStep by step instructions.\n');

  // The new commit's parent is the original branch head and the branch head
  // now points at the new commit (newest first in the history).
  const history = await get('/api/repositories/acme-demo/acme-docs/commits');
  const historyPayload = await history.json();
  assert.equal(historyPayload.commits[0].message, 'Add guide');
  assert.equal(historyPayload.commits[0].author, 'alice-dev');
  assert.ok(historyPayload.commits[0].parents.some((p) => p.id === beforeHead));
  assert.ok(historyPayload.commits[0].files.includes('docs/guide.md'));
  assert.equal(historyPayload.commits[1].message, 'Document search flow');

  // The file-browser shows the new file under docs/ and its content.
  const treeDocs = await get('/api/repositories/acme-demo/acme-docs/tree/main/docs');
  assert.equal(treeDocs.status, 200);
  const treePayload = await treeDocs.json();
  assert.deepEqual(
    treePayload.entries.map((e) => ({ name: e.name, type: e.type })),
    [{ name: 'guide.md', type: 'file' }]
  );

  const file = await get('/api/repositories/acme-demo/acme-docs/contents/main/docs/guide.md');
  assert.equal(file.status, 200);
  const filePayload = await file.json();
  assert.equal(filePayload.file.content, '# Guide\n\nStep by step instructions.\n');
  assert.equal(filePayload.commit.message, 'Add guide');

  // Refreshing the file page and commit history keeps the new file/commit.
  const fileAgain = await get('/api/repositories/acme-demo/acme-docs/contents/main/docs/guide.md');
  const fileAgainPayload = await fileAgain.json();
  assert.equal(fileAgainPayload.file.content, '# Guide\n\nStep by step instructions.\n');
  const historyAgain = await get('/api/repositories/acme-demo/acme-docs/commits');
  const historyAgainPayload = await historyAgain.json();
  assert.equal(historyAgainPayload.commits[0].message, 'Add guide');

  // A fresh store read confirms persistence (commit + branch head).
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const main = store.findBranchByRepositoryAndName(repo.id, 'main');
  const head = store.findCommitById(main.headCommitId);
  assert.equal(head.message, 'Add guide');
  assert.ok(store.getFilesAtCommit(head.id).some((f) => f.path === 'docs/guide.md'));
});

test('REQ-4-4: invalid paths and a missing message are rejected and change nothing', async () => {
  const beforeHead = await branchHead('main');
  const beforeHistory = await get('/api/repositories/acme-demo/acme-docs/commits');
  const beforeMessages = (await beforeHistory.json()).commits.map((c) => c.message);

  const cases = [
    { path: '../invalid.md', content: 'must not be saved', message: '' },
    { path: '', content: 'x', message: 'Add file' },
    { path: '/docs/x.md', content: 'x', message: 'Add file' },
    { path: 'a/../b.md', content: 'x', message: 'Add file' },
    { path: 'README.md', content: 'overwrite', message: 'Add file' }, // conflict
    { path: 'src', content: 'x', message: 'Add file' }, // conflict with directory
    { path: 'README.md/sub.md', content: 'x', message: 'Add file' }, // conflict under an existing file path
    { path: 'ok.md', content: 'x', message: 'x'.repeat(73) }, // over-long message
  ];
  for (const body of cases) {
    const res = await post(
      '/api/repositories/acme-demo/acme-docs/contents',
      { branch: 'main', ...body },
      ownerCookie
    );
    assert.equal(res.status, 400, JSON.stringify(body));
    const payload = await res.json();
    if (body.message === '') {
      assert.equal(payload.errors.message, 'Commit message is required', JSON.stringify(body));
    }
    if (body.path === 'ok.md') {
      assert.equal(payload.errors.message, 'Commit message is too long');
    } else {
      assert.equal(payload.errors.path, 'Invalid file path', JSON.stringify(body));
    }
  }

  // Neither the branch head, the file list, nor the commit history changed.
  assert.equal(await branchHead('main'), beforeHead);
  const history = await get('/api/repositories/acme-demo/acme-docs/commits');
  const afterMessages = (await history.json()).commits.map((c) => c.message);
  assert.deepEqual(afterMessages, beforeMessages);
  const contents = await get('/api/repositories/acme-demo/acme-docs/contents');
  const files = (await contents.json()).files.map((f) => f.path);
  assert.ok(!files.includes('ok.md'));
  assert.ok(!files.includes('../invalid.md'));
  assert.equal(files.includes('README.md'), true);
  assert.equal((await get('/api/repositories/acme-demo/acme-docs/contents/main/src')).status, 404);
});

test('REQ-4-4: a protected branch rejects the submission with the reason', async () => {
  const { createStore } = require('../src/store');
  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  store.setBranchProtected(repo.id, 'main', true);

  // A fresh app instance on the same data directory reads the persisted
  // protected-branch record (the shared server keeps its own in-memory copy).
  const protectedApp = createApp({
    dataDir,
    distDir: path.join(__dirname, 'fixtures', 'dist'),
  });
  const protectedServer = http.createServer(protectedApp);
  await new Promise((resolve) => protectedServer.listen(0, resolve));
  const protectedBase = `http://127.0.0.1:${protectedServer.address().port}`;
  try {
    const signinRes = await fetch(`${protectedBase}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'alice-dev', password: 'Valid-password-123!' }),
    });
    const protectedCookie = signinRes.headers.get('set-cookie').split(';')[0];

    const beforeHead = await branchHead('main');
    const res = await fetch(
      `${protectedBase}/api/repositories/acme-demo/acme-docs/contents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: protectedCookie },
        body: JSON.stringify({
          branch: 'main',
          path: 'docs/protected.md',
          content: 'x',
          message: 'Add protected',
        }),
      }
    );
    assert.equal(res.status, 400);
    const payload = await res.json();
    assert.equal(payload.errors.branch, 'Branch is protected');

    // File, branch head, and history are unchanged.
    assert.equal(await branchHead('main'), beforeHead);
    const file = await fetch(
      `${protectedBase}/api/repositories/acme-demo/acme-docs/contents/main/docs/protected.md`
    );
    assert.equal(file.status, 404);
  } finally {
    await new Promise((resolve) => protectedServer.close(resolve));
    store.setBranchProtected(repo.id, 'main', false);
  }
});

test('REQ-4-4: an unknown branch is rejected and nothing is stored', async () => {
  const beforeHead = await branchHead('main');
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/contents',
    { branch: 'no-such-branch', path: 'x.md', content: 'x', message: 'Add file' },
    ownerCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.branch, 'Branch not found');
  assert.equal(await branchHead('main'), beforeHead);
});

test('REQ-4-4: carol-dev (Read) and anonymous users cannot submit file changes', async () => {
  const beforeHead = await branchHead('main');

  const memberRes = await post(
    '/api/repositories/acme-demo/acme-docs/contents',
    { branch: 'main', path: 'member.md', content: 'x', message: 'Add member' },
    memberCookie
  );
  assert.equal(memberRes.status, 403);
  assert.equal((await memberRes.json()).error, 'Access denied');

  const anonymousRes = await post(
    '/api/repositories/acme-demo/acme-docs/contents',
    { branch: 'main', path: 'anon.md', content: 'x', message: 'Add anon' }
  );
  assert.equal(anonymousRes.status, 401);
  assert.equal((await anonymousRes.json()).error, 'Authentication required');

  assert.equal(await branchHead('main'), beforeHead);
  assert.equal((await get('/api/repositories/acme-demo/acme-docs/contents/main/member.md')).status, 404);
  assert.equal((await get('/api/repositories/acme-demo/acme-docs/contents/main/anon.md')).status, 404);
});

test('REQ-4-4: the tree and file endpoints report the role for the writable Code page', async () => {
  const anonymousTree = await get('/api/repositories/acme-demo/acme-docs/tree/main');
  assert.equal((await anonymousTree.json()).role, 'read');

  const ownerTree = await get('/api/repositories/acme-demo/acme-docs/tree/main', ownerCookie);
  assert.equal((await ownerTree.json()).role, 'admin');

  const memberTree = await get('/api/repositories/acme-demo/acme-docs/tree/main', memberCookie);
  assert.equal((await memberTree.json()).role, 'read');

  const file = await get('/api/repositories/acme-demo/acme-docs/contents/main/README.md', ownerCookie);
  assert.equal((await file.json()).role, 'admin');
});

test('REQ-4-4: the file-scoped history shows the exact submitted message', async () => {
  const res = await post(
    '/api/repositories/acme-demo/acme-docs/contents',
    {
      branch: 'main',
      path: 'docs/history.md',
      content: '# History\n\nTracked here.\n',
      message: 'Add docs/history.md',
    },
    ownerCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();

  const history = await get(
    '/api/repositories/acme-demo/acme-docs/commits?branch=main&path=docs/history.md'
  );
  assert.equal(history.status, 200);
  const historyPayload = await history.json();
  assert.ok(historyPayload.commits.some((c) => c.id === payload.commit.id));
  assert.equal(historyPayload.commits[0].message, 'Add docs/history.md');
});
