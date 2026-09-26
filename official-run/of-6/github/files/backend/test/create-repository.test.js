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
let aliceCookie;
let bobCookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-create-repo-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const aliceSignin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'alice-dev', password: 'Valid-password-123!' }),
  });
  assert.equal(aliceSignin.status, 200);
  aliceCookie = aliceSignin.headers.get('set-cookie').split(';')[0];

  const bobSignin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'bob-reviewer', password: 'Valid-password-123!' }),
  });
  assert.equal(bobSignin.status, 200);
  bobCookie = bobSignin.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function post(url, body, cookie) {
  return fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function get(url, cookie) {
  return fetch(`${baseUrl}${url}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test('creating a repository requires authentication', async () => {
  const res = await post('/api/repositories', {
    owner: 'alice-dev',
    name: 'new-project',
    visibility: 'public',
    initialize: false,
  });
  assert.equal(res.status, 401);
});

test('alice creates an initialized private personal repository with the optional description', async () => {
  const res = await post(
    '/api/repositories',
    {
      owner: 'alice-dev',
      name: 'new-project',
      description: 'Repository created by Playwright',
      visibility: 'private',
      initialize: true,
    },
    aliceCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.repository.owner, 'alice-dev');
  assert.equal(payload.repository.name, 'new-project');
  assert.equal(payload.repository.visibility, 'private');
  assert.equal(payload.repository.defaultBranch, 'main');
  assert.equal(payload.repository.description, 'Repository created by Playwright');
  assert.equal(typeof payload.repository.createdAt, 'string');

  // The overview page data is reachable and stays Private.
  const overview = await get('/api/repositories/alice-dev/new-project', aliceCookie);
  assert.equal(overview.status, 200);
  const overviewPayload = await overview.json();
  assert.equal(overviewPayload.repository.owner, 'alice-dev');
  assert.equal(overviewPayload.repository.name, 'new-project');
  assert.equal(overviewPayload.repository.visibility, 'private');

  // The default branch contains exactly the README file.
  const contents = await get('/api/repositories/alice-dev/new-project/contents', aliceCookie);
  assert.equal(contents.status, 200);
  const contentsPayload = await contents.json();
  assert.equal(contentsPayload.branch.name, 'main');
  assert.equal(contentsPayload.files.length, 1);
  assert.equal(contentsPayload.files[0].path, 'README.md');
  assert.ok(contentsPayload.files[0].content.includes('new-project'));

  // The commit history contains exactly one initialization commit.
  const commits = await get('/api/repositories/alice-dev/new-project/commits', aliceCookie);
  assert.equal(commits.status, 200);
  const commitsPayload = await commits.json();
  assert.equal(commitsPayload.commits.length, 1);
  assert.equal(commitsPayload.commits[0].message, 'Initial commit');
  assert.equal(commitsPayload.commits[0].author, 'alice-dev');

  // The README file content is readable through the file endpoint.
  const file = await get(
    '/api/repositories/alice-dev/new-project/contents/main/README.md',
    aliceCookie
  );
  assert.equal(file.status, 200);
  const filePayload = await file.json();
  assert.equal(filePayload.file.path, 'README.md');
  assert.ok(filePayload.file.content.includes('new-project'));

  // The repository appears in the personal repository list.
  const list = await get('/api/repositories?owner=alice-dev', aliceCookie);
  assert.equal(list.status, 200);
  const listPayload = await list.json();
  assert.ok(listPayload.repositories.some((r) => r.name === 'new-project'));
  assert.ok(listPayload.repositories.some((r) => r.name === 'secret-research'));
});

test('a visitor cannot read the contents or commits of a private personal repository', async () => {
  const contents = await get('/api/repositories/alice-dev/new-project/contents');
  assert.equal(contents.status, 403);
  const commits = await get('/api/repositories/alice-dev/new-project/commits');
  assert.equal(commits.status, 403);
});

test('an existing repository name in the default personal namespace is rejected', async () => {
  const res = await post(
    '/api/repositories',
    {
      owner: 'alice-dev',
      name: 'secret-research',
      visibility: 'private',
      initialize: false,
    },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.name, 'Repository name already exists');

  // No partial repository and no change to the existing record.
  const list = await get('/api/repositories?owner=alice-dev', aliceCookie);
  const listPayload = await list.json();
  const matches = listPayload.repositories.filter((r) => r.name === 'secret-research');
  assert.equal(matches.length, 1);
});

test('an empty repository name is rejected with the required message', async () => {
  const res = await post(
    '/api/repositories',
    { owner: 'alice-dev', name: '', visibility: 'private', initialize: false },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.name, 'Repository name is required');
});

test('a malformed repository name is rejected with the format message', async () => {
  const res = await post(
    '/api/repositories',
    { owner: 'alice-dev', name: 'Bad_Name', visibility: 'private', initialize: false },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.name, 'Repository name format is invalid');
});

test('an invalid visibility value is rejected', async () => {
  const res = await post(
    '/api/repositories',
    { owner: 'alice-dev', name: 'visibility-check', visibility: 'internal', initialize: false },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.visibility, 'Visibility is invalid');
});

test('an empty owner is rejected with the required message', async () => {
  const res = await post(
    '/api/repositories',
    { owner: '', name: 'some-name', visibility: 'public', initialize: false },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.owner, 'Owner is required');
});

test('an unknown owner namespace is rejected', async () => {
  const res = await post(
    '/api/repositories',
    { owner: 'no-such-owner', name: 'some-name', visibility: 'public', initialize: false },
    aliceCookie
  );
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.owner, 'Owner not found');
});

test('an organization Owner creates a repository that appears in the organization list', async () => {
  const res = await post(
    '/api/repositories',
    {
      owner: 'acme-demo',
      name: 'design-system',
      description: 'Shared design tokens',
      visibility: 'private',
      initialize: true,
    },
    aliceCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.repository.owner, 'acme-demo');
  assert.equal(payload.repository.ownerType, 'organization');

  const orgRepos = await get('/api/organizations/acme-demo/repositories', aliceCookie);
  const orgReposPayload = await orgRepos.json();
  assert.ok(orgReposPayload.repositories.some((r) => r.name === 'design-system'));

  const contents = await get('/api/repositories/acme-demo/design-system/contents', aliceCookie);
  const contentsPayload = await contents.json();
  assert.equal(contentsPayload.files[0].path, 'README.md');
});

test('an organization member without Owner permission cannot create repositories for the organization', async () => {
  const res = await post(
    '/api/repositories',
    { owner: 'acme-demo', name: 'sneaky-repo', visibility: 'public', initialize: false },
    bobCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.errors.owner, 'Access denied');

  // Nothing was created.
  const orgRepos = await get('/api/organizations/acme-demo/repositories', bobCookie);
  const orgReposPayload = await orgRepos.json();
  assert.ok(!orgReposPayload.repositories.some((r) => r.name === 'sneaky-repo'));
});

test('a user cannot create a repository in another user namespace', async () => {
  const res = await post(
    '/api/repositories',
    { owner: 'bob-reviewer', name: 'bob-second', visibility: 'public', initialize: false },
    aliceCookie
  );
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.errors.owner, 'Access denied');
});

test('bob creates an uninitialized personal repository with no commits yet', async () => {
  const res = await post(
    '/api/repositories',
    { owner: 'bob-reviewer', name: 'bob-second', visibility: 'private', initialize: false },
    bobCookie
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.repository.name, 'bob-second');
  assert.equal(payload.repository.visibility, 'private');

  const contents = await get('/api/repositories/bob-reviewer/bob-second/contents', bobCookie);
  const contentsPayload = await contents.json();
  assert.equal(contentsPayload.branch, null);
  assert.deepEqual(contentsPayload.files, []);

  const commits = await get('/api/repositories/bob-reviewer/bob-second/commits', bobCookie);
  const commitsPayload = await commits.json();
  assert.deepEqual(commitsPayload.commits, []);
});

test('rejected attempts leave the original state unchanged', async () => {
  const before = await get('/api/repositories?owner=alice-dev', aliceCookie);
  const beforePayload = await before.json();

  await post(
    '/api/repositories',
    { owner: 'alice-dev', name: 'secret-research', visibility: 'public', initialize: true },
    aliceCookie
  );
  await post(
    '/api/repositories',
    { owner: 'alice-dev', name: '', visibility: 'private', initialize: true },
    aliceCookie
  );
  await post(
    '/api/repositories',
    { owner: 'acme-demo', name: 'sneaky-repo', visibility: 'public', initialize: true },
    bobCookie
  );

  const after = await get('/api/repositories?owner=alice-dev', aliceCookie);
  const afterPayload = await after.json();
  assert.deepEqual(
    afterPayload.repositories.map((r) => r.name).sort(),
    beforePayload.repositories.map((r) => r.name).sort()
  );
});

test('created repositories, branches, commits and files survive a store reload', async () => {
  const { createStore } = require('../src/store');
  const store2 = createStore(dataDir);
  const repo = store2.findRepositoryByOwnerAndName('alice-dev', 'new-project');
  assert.ok(repo, 'repository must persist');
  assert.equal(repo.visibility, 'private');
  assert.equal(repo.defaultBranch, 'main');
  assert.equal(repo.description, 'Repository created by Playwright');
  const creator = store2.findAccountByUsername('alice-dev');
  assert.equal(repo.creatorId, creator.id);

  const files = store2.getFilesForBranch(repo.id, 'main');
  assert.equal(files.files.length, 1);
  assert.equal(files.files[0].path, 'README.md');

  const commits = store2.getCommitHistory(repo.id, 'main');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].message, 'Initial commit');
  assert.equal(commits[0].authorId, creator.id);
});

test('the personal repository list is filtered by visibility for other accounts', async () => {
  // bob-reviewer has no access to alice's private new-project repository.
  const list = await get('/api/repositories?owner=alice-dev', bobCookie);
  const listPayload = await list.json();
  assert.ok(!listPayload.repositories.some((r) => r.name === 'new-project'));
  assert.ok(!listPayload.repositories.some((r) => r.name === 'secret-research'));
});
