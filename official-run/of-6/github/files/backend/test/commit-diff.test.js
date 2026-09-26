'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createApp } = require('../src/app');
const { createStore } = require('../src/store');

let dataDir;
let server;
let baseUrl;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-commit-diff-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function get(url) {
  return fetch(`${baseUrl}${url}`);
}

test('REQ-4-2-2: the commit detail exposes the base identifier, changed files and the numeric additions/deletions summary', async () => {
  const list = await get('/api/repositories/acme-demo/acme-docs/commits');
  const newest = (await list.json()).commits[0];
  assert.equal(newest.message, 'Document search flow');

  const res = await get(
    `/api/repositories/acme-demo/acme-docs/commits/${newest.id}`
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.commit.message, 'Document search flow');

  // The base (parent) and compare (commit) identifiers are both displayed.
  assert.ok(payload.commit.base, 'the parent revision must be exposed');
  assert.equal(payload.commit.base.shortId.length, 7);
  assert.equal(payload.commit.base.message, 'Initial commit');
  assert.equal(payload.commit.shortId, newest.shortId);

  // The commit contains an added file and a modified file; both appear in
  // the changed-files list with their stored content.
  const paths = payload.commit.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['README.md', 'src/search.ts']);
  const searchTs = payload.commit.files.find((f) => f.path === 'src/search.ts');
  assert.ok(searchTs.content.includes('Search flow'));
  assert.equal(searchTs.additions, 4, 'src/search.ts is added with 4 lines');
  assert.equal(searchTs.deletions, 0);
  assert.ok(searchTs.lines.every((l) => l.type === 'add'));
  const readme = payload.commit.files.find((f) => f.path === 'README.md');
  assert.ok(readme.content.includes('## Search flow'), 'README is modified');
  assert.equal(readme.additions, 3, 'README gained the Search flow section');
  assert.equal(readme.deletions, 1, 'README line was updated');

  // Aggregate additions/deletions summary matches the per-file numbers.
  assert.equal(
    payload.commit.additions,
    searchTs.additions + readme.additions
  );
  assert.equal(payload.commit.deletions, readme.deletions);
});

test('REQ-4-2-2: the compare endpoint returns the diff between a base and a compare commit', async () => {
  const list = await get('/api/repositories/acme-demo/acme-docs/commits');
  const [newest, oldest] = (await list.json()).commits;

  const res = await get(
    `/api/repositories/acme-demo/acme-docs/compare?base=${oldest.id}&compare=${newest.id}`
  );
  assert.equal(res.status, 200);
  const payload = await res.json();

  assert.equal(payload.base.id, oldest.id);
  assert.equal(payload.base.shortId, oldest.shortId);
  assert.equal(payload.compare.id, newest.id);
  assert.equal(payload.compare.shortId, newest.shortId);

  assert.deepEqual(
    payload.files.map((f) => f.path).sort(),
    ['README.md', 'src/search.ts']
  );
  const searchTs = payload.files.find((f) => f.path === 'src/search.ts');
  assert.equal(searchTs.additions, 4);
  assert.equal(searchTs.deletions, 0);
  assert.ok(searchTs.lines.some((l) => l.type === 'add' && l.text.includes('searchFlow')));
  const readme = payload.files.find((f) => f.path === 'README.md');
  assert.equal(readme.additions, 3);
  assert.equal(readme.deletions, 1);
  assert.equal(payload.additions, 7);
  assert.equal(payload.deletions, 1);
});

test('REQ-4-2-2: an omitted base treats every compare file as added (root commit diff)', async () => {
  const list = await get('/api/repositories/acme-demo/acme-docs/commits');
  const oldest = (await list.json()).commits[1];
  assert.equal(oldest.message, 'Initial commit');

  const res = await get(
    `/api/repositories/acme-demo/acme-docs/compare?compare=${oldest.id}`
  );
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.base, null);
  assert.equal(payload.compare.id, oldest.id);
  assert.deepEqual(payload.files.map((f) => f.path), ['README.md']);
  assert.equal(payload.files[0].additions, 3);
  assert.equal(payload.files[0].deletions, 0);
  assert.equal(payload.additions, 3);
  assert.equal(payload.deletions, 0);
});

test('REQ-4-2-2: unchanged files never appear in the diff', async () => {
  // Add a third commit to acme-docs whose snapshot keeps README.md and
  // src/search.ts identical to the head and adds a brand-new file; the diff
  // against the head must list only the new file.
  const dataFile = path.join(dataDir, 'data.json');
  const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const acmeDocs = raw.repositories.find((r) => r.name === 'acme-docs');
  const main = raw.branches.find(
    (b) => b.repositoryId === acmeDocs.id && b.name === 'main'
  );
  const head = main.headCommitId;
  const headFiles = raw.commitFiles.filter((f) => f.commitId === head);
  const alice = raw.accounts.find((a) => a.username === 'alice-dev');
  const thirdId = 'commit-third';
  raw.commits.push({
    id: thirdId,
    repositoryId: acmeDocs.id,
    message: 'Third commit',
    authorId: alice.id,
    parentCommitIds: [head],
    createdAt: new Date().toISOString(),
  });
  for (const file of headFiles) {
    raw.commitFiles.push({
      id: crypto.randomUUID(),
      commitId: thirdId,
      path: file.path,
      content: file.content,
    });
  }
  raw.commitFiles.push({
    id: crypto.randomUUID(),
    commitId: thirdId,
    path: 'NEW.txt',
    content: 'hello\n',
  });
  main.headCommitId = thirdId;
  fs.writeFileSync(dataFile, JSON.stringify(raw, null, 2), 'utf8');

  const store = createStore(dataDir);
  const repo = store.findRepositoryByOwnerAndName('acme-demo', 'acme-docs');
  const diff = store.getCommitDiff(repo.id, head, thirdId);
  assert.deepEqual(diff.files.map((f) => f.path), ['NEW.txt']);
  assert.equal(diff.additions, 1);
  assert.equal(diff.deletions, 0);
});

test('REQ-4-2-2: a commit of another repository is not comparable here and unknown compares are 404', async () => {
  const store = createStore(dataDir);
  const secret = store.findRepositoryByOwnerAndName('alice-dev', 'secret-research');
  assert.ok(secret);
  const secretCommit = store.getCommitHistory(secret.id, 'main')[0];
  assert.ok(secretCommit);

  const foreign = await get(
    `/api/repositories/acme-demo/acme-docs/compare?base=${secretCommit.id}&compare=${secretCommit.id}`
  );
  assert.equal(foreign.status, 404);
  const foreignPayload = await foreign.json();
  assert.equal(foreignPayload.error, 'Commit not found');

  const unknown = await get(
    '/api/repositories/acme-demo/acme-docs/compare?base=does-not-exist&compare=does-not-exist'
  );
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'Commit not found');

  const missingCompare = await get('/api/repositories/acme-demo/acme-docs/compare?base=x');
  assert.equal(missingCompare.status, 404);
  assert.equal((await missingCompare.json()).error, 'Commit not found');
});

test('REQ-4-2-2: the diff respects repository visibility (no permission, no diff)', async () => {
  const compare = await get(
    '/api/repositories/alice-dev/secret-research/compare?base=x&compare=y'
  );
  assert.equal(compare.status, 403);
  assert.equal((await compare.json()).error, 'Access denied');

  const detail = await get('/api/repositories/alice-dev/secret-research/commits/any-id');
  assert.equal(detail.status, 403);
});

test('REQ-4-2-2: the read-only comparison never modifies branches, commits or files', async () => {
  const before = await get('/api/repositories/acme-demo/acme-docs/commits');
  const beforePayload = await before.json();
  assert.equal(beforePayload.commits.length, 2);

  const list = await get('/api/repositories/acme-demo/acme-docs/commits');
  const [newest, oldest] = (await list.json()).commits;
  await get(
    `/api/repositories/acme-demo/acme-docs/compare?base=${oldest.id}&compare=${newest.id}`
  );
  await get(`/api/repositories/acme-demo/acme-docs/commits/${newest.id}`);

  const after = await get('/api/repositories/acme-demo/acme-docs/commits');
  const afterPayload = await after.json();
  assert.equal(afterPayload.commits.length, 2);
  assert.deepEqual(
    afterPayload.commits.map((c) => c.message),
    ['Document search flow', 'Initial commit']
  );
  const contents = await get('/api/repositories/acme-demo/acme-docs/contents');
  const contentsPayload = await contents.json();
  assert.deepEqual(
    contentsPayload.files.map((f) => f.path).sort(),
    ['README.md', 'src/search.ts']
  );
});
