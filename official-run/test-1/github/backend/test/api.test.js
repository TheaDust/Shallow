import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../src/server.js';
import { loadStore, saveStore } from '../src/store.js';

let dir;
let server;
let base;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gh-test-'));
  process.env.SHALLOW_DATA_DIR = dir;
  server = createServer(createHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  delete process.env.SHALLOW_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json, headers: res.headers };
}

test('seed provisions alice-dev on an empty store', () => {
  const store = loadStore(dir);
  const alice = store.accounts.find((a) => a.username === 'alice-dev');
  assert.ok(alice);
  assert.equal(alice.email, 'alice.dev@example.test');
  assert.equal(alice.emailVerified, true);
  assert.equal(alice.status, 'active');
  assert.ok(alice.passwordHash);
});

test('seed persists and is not re-created after user writes', () => {
  const file = join(dir, 'store.json');
  assert.ok(existsSync(file));
  const store = loadStore(dir);
  assert.equal(store.accounts.length, 3);
});

test('health endpoints respond', async () => {
  for (const path of ['/health', '/api/health']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  }
});

test('register success creates a sign-in-capable verified account', async () => {
  const username = `pw-user-${Date.now()}`;
  const email = `${username}@example.test`;
  const res = await post('/api/register', {
    username,
    email,
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    terms: true,
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.account.emailVerified, true);
  assert.equal(res.json.account.username, username);
  // No password material is ever returned.
  assert.ok(!JSON.stringify(res.json).includes('Valid-password-123!'));
  assert.ok(!JSON.stringify(res.json).includes('passwordHash'));

  // The account is persisted.
  const store = loadStore(dir);
  const created = store.accounts.find((a) => a.username === username);
  assert.ok(created);
  assert.equal(created.email, email);
  assert.equal(created.emailVerified, true);
});

test('register with several invalid fields shows all messages together', async () => {
  const res = await post('/api/register', {
    username: '-bad',
    email: 'not-an-email',
    password: 'short',
    confirmPassword: 'different',
    terms: false,
  });
  assert.equal(res.status, 422);
  const fe = res.json.fieldErrors;
  assert.equal(fe.username, 'Username format is invalid');
  assert.equal(fe.email, 'Email format is invalid');
  assert.equal(fe.password, 'Password requirements are not satisfied');
  assert.equal(fe.confirmPassword, 'Passwords do not match');
  assert.equal(fe.terms, 'Agree to terms is required');
});

test('register with duplicate username keeps all messages itemized', async () => {
  const res = await post('/api/register', {
    username: 'alice-dev',
    email: 'brand.new@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    terms: true,
  });
  assert.equal(res.status, 422);
  assert.equal(res.json.fieldErrors.username, 'Username already exists');
  assert.equal(res.json.fieldErrors.email, undefined);
});

test('register with duplicate email reports email conflict', async () => {
  const res = await post('/api/register', {
    username: 'brand-new-user',
    email: 'alice.dev@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    terms: true,
  });
  assert.equal(res.status, 422);
  assert.equal(res.json.fieldErrors.email, 'Email already exists');
});

test('register without terms is rejected', async () => {
  const res = await post('/api/register', {
    username: 'terms-user',
    email: 'terms.user@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    terms: false,
  });
  assert.equal(res.status, 422);
  assert.equal(res.json.fieldErrors.terms, 'Agree to terms is required');
});

test('sign in with seed credentials creates a session', async () => {
  const res = await post('/api/signin', {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.user.username, 'alice-dev');
  assert.ok(res.headers.get('set-cookie').includes('session_id='));
});

test('sign in with wrong credentials is generic', async () => {
  for (const body of [
    { identifier: 'alice-dev', password: 'Wrong-password-123!' },
    { identifier: 'ghost-user', password: 'Valid-password-123!' },
    { identifier: 'alice-dev', password: '' },
  ]) {
    const res = await post('/api/signin', body);
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'Invalid credentials');
  }
});

test('sign in with an unavailable account is generic and creates no session', async () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'gh-unavailable-'));
  const prevDir = process.env.SHALLOW_DATA_DIR;
  process.env.SHALLOW_DATA_DIR = dir2;
  let srv;
  try {
    const store = loadStore(dir2);
    const alice = store.accounts.find((a) => a.username === 'alice-dev');
    alice.status = 'suspended';
    saveStore(store, dir2);

    srv = createServer(createHandler());
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const base2 = `http://127.0.0.1:${srv.address().port}`;

    const res = await fetch(`${base2}/api/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'alice-dev', password: 'Valid-password-123!' }),
    });
    const json = await res.json();
    assert.equal(res.status, 401);
    assert.equal(json.error, 'Invalid credentials');
    assert.equal(JSON.stringify(json).includes('Valid-password-123!'), false);

    const storeAfter = loadStore(dir2);
    assert.equal(storeAfter.sessions.length, 0);
  } finally {
    if (srv) srv.close();
    process.env.SHALLOW_DATA_DIR = prevDir;
    rmSync(dir2, { recursive: true, force: true });
  }
});

async function signInCookie(identifier, password) {
  const res = await post('/api/signin', { identifier, password });
  const cookie = res.headers.get('set-cookie');
  return cookie ? cookie.split(';')[0] : null;
}

async function registerUser(username) {
  const email = `${username}@example.test`;
  const res = await post('/api/register', {
    username,
    email,
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    terms: true,
  });
  assert.equal(res.status, 201);
  return { username, email };
}

test('change password requires an authenticated session', async () => {
  const res = await post('/api/change-password', {
    currentPassword: 'Valid-password-123!',
    newPassword: 'New-password-456!',
    confirmPassword: 'New-password-456!',
  });
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'Unauthorized');
  // No password material is ever returned.
  assert.ok(!JSON.stringify(res.json).includes('New-password-456!'));
});

test('change password: empty current password shows the required message and keeps old credentials', async () => {
  const { username } = await registerUser(`pw-change-${Date.now()}`);
  const cookie = await signInCookie(username, 'Valid-password-123!');
  assert.ok(cookie);
  const res = await fetch(`${base}/api/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      currentPassword: '',
      newPassword: 'Required-password-789!',
      confirmPassword: 'Required-password-789!',
    }),
  });
  const json = await res.json();
  assert.equal(res.status, 422);
  assert.equal(json.fieldErrors.currentPassword, 'Current password is required');

  // Old credentials remain usable; the candidate new password does not work.
  const oldPass = await post('/api/signin', { identifier: username, password: 'Valid-password-123!' });
  assert.equal(oldPass.status, 200);
  const candidate = await post('/api/signin', { identifier: username, password: 'Required-password-789!' });
  assert.equal(candidate.status, 401);
});

test('change password: incorrect current password and does-not-match confirmation are rejected', async () => {
  const { username } = await registerUser(`pw-change-${Date.now()}`);
  const cookie = await signInCookie(username, 'Valid-password-123!');
  assert.ok(cookie);
  const res = await fetch(`${base}/api/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      currentPassword: 'Wrong-password-123!',
      newPassword: 'New-password-456!',
      confirmPassword: 'does-not-match',
    }),
  });
  const json = await res.json();
  assert.equal(res.status, 422);
  assert.equal(json.fieldErrors.currentPassword, 'Current password is incorrect');
  assert.equal(json.fieldErrors.confirmPassword, 'Password confirmation does not match');

  const oldPass = await post('/api/signin', { identifier: username, password: 'Valid-password-123!' });
  assert.equal(oldPass.status, 200);
  const candidate = await post('/api/signin', { identifier: username, password: 'New-password-456!' });
  assert.equal(candidate.status, 401);
});

test('change password: noncompliant new password is explained beside the field', async () => {
  const { username } = await registerUser(`pw-change-${Date.now()}`);
  const cookie = await signInCookie(username, 'Valid-password-123!');
  assert.ok(cookie);
  const res = await fetch(`${base}/api/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      currentPassword: 'Valid-password-123!',
      newPassword: 'short',
      confirmPassword: 'short',
    }),
  });
  const json = await res.json();
  assert.equal(res.status, 422);
  assert.equal(json.fieldErrors.newPassword, 'Password requirements are not satisfied');

  const oldPass = await post('/api/signin', { identifier: username, password: 'Valid-password-123!' });
  assert.equal(oldPass.status, 200);
});

test('change password: mismatched confirmation is rejected without touching credentials', async () => {
  const { username } = await registerUser(`pw-change-${Date.now()}`);
  const cookie = await signInCookie(username, 'Valid-password-123!');
  assert.ok(cookie);
  const res = await fetch(`${base}/api/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      currentPassword: 'Valid-password-123!',
      newPassword: 'New-password-456!',
      confirmPassword: 'New-password-456!-different',
    }),
  });
  const json = await res.json();
  assert.equal(res.status, 422);
  assert.equal(json.fieldErrors.confirmPassword, 'Password confirmation does not match');

  const oldPass = await post('/api/signin', { identifier: username, password: 'Valid-password-123!' });
  assert.equal(oldPass.status, 200);
});

test('change password: success applies the new password immediately and affects only the current account', async () => {
  const { username, email } = await registerUser(`pw-change-${Date.now()}`);
  const cookie = await signInCookie(username, 'Valid-password-123!');
  assert.ok(cookie);

  const res = await fetch(`${base}/api/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      currentPassword: 'Valid-password-123!',
      newPassword: 'New-password-456!',
      confirmPassword: 'New-password-456!',
    }),
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.message, 'Password updated');
  assert.ok(!JSON.stringify(json).includes('New-password-456!'));

  // The old password no longer works; the new one signs in immediately.
  const oldPass = await post('/api/signin', { identifier: username, password: 'Valid-password-123!' });
  assert.equal(oldPass.status, 401);
  const newPass = await post('/api/signin', { identifier: email, password: 'New-password-456!' });
  assert.equal(newPass.status, 200);

  // The current session stays valid and other accounts are untouched.
  const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  const alice = await post('/api/signin', {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  assert.equal(alice.status, 200);
});

test('session flow: sign in, me, sign out', async () => {
  const signin = await post('/api/signin', {
    identifier: 'alice.dev@example.test',
    password: 'Valid-password-123!',
  });
  const cookie = signin.headers.get('set-cookie').split(';')[0];

  const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  const meJson = await me.json();
  assert.equal(meJson.user.username, 'alice-dev');

  const signout = await fetch(`${base}/api/signout`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(signout.status, 200);

  const after = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(after.status, 401);
});

test('seed provisions the two repositories', () => {
  const store = loadStore(dir);
  const acme = store.repositories.find((r) => r.name === 'acme-docs');
  assert.ok(acme);
  assert.equal(acme.owner, 'alice-dev');
  assert.equal(acme.visibility, 'public');
  assert.equal(acme.defaultBranch, 'main');
  assert.ok(acme.description);
  assert.ok(acme.files.length >= 1);
  const secret = store.repositories.find((r) => r.name === 'secret-research');
  assert.ok(secret);
  assert.equal(secret.owner, 'alice-dev');
  assert.equal(secret.visibility, 'private');
});

test('search exposes only repositories the visitor is authorized to view', async () => {
  const res = await fetch(`${base}/api/search?q=acme`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.results.length, 1);
  assert.equal(json.results[0].owner, 'alice-dev');
  assert.equal(json.results[0].name, 'acme-docs');
  assert.equal(json.results[0].visibility, 'public');
  assert.ok(json.results[0].description);
  assert.ok(json.results[0].updatedAt);

  const secret = await fetch(`${base}/api/search?q=secret`);
  const secretJson = await secret.json();
  assert.equal(secretJson.results.length, 0);

  const none = await fetch(`${base}/api/search?q=zzz-no-match`);
  const noneJson = await none.json();
  assert.equal(noneJson.results.length, 0);
});

test('search as the private repository owner includes it', async () => {
  const signin = await post('/api/signin', {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  const cookie = signin.headers.get('set-cookie').split(';')[0];
  const res = await fetch(`${base}/api/search?q=secret`, {
    headers: { Cookie: cookie },
  });
  const json = await res.json();
  assert.equal(json.results.length, 1);
  assert.equal(json.results[0].name, 'secret-research');
  assert.equal(json.results[0].visibility, 'private');
});

test('public repository detail and file content are readable without sign-in', async () => {
  const res = await fetch(`${base}/api/repositories/alice-dev/acme-docs`);
  assert.equal(res.status, 200);
  const { repository } = await res.json();
  assert.equal(repository.owner, 'alice-dev');
  assert.equal(repository.name, 'acme-docs');
  assert.equal(repository.visibility, 'public');
  assert.equal(repository.defaultBranch, 'main');
  assert.ok(repository.description);
  assert.ok(repository.files.some((f) => f.type === 'file'));
  assert.ok(repository.files.some((f) => f.name === 'docs' && f.type === 'directory'));

  const fileRes = await fetch(
    `${base}/api/repositories/alice-dev/acme-docs/file?path=${encodeURIComponent('README.md')}`
  );
  assert.equal(fileRes.status, 200);
  const { file } = await fileRes.json();
  assert.equal(file.fileName, 'README.md');
  assert.equal(file.branch, 'main');
  assert.ok(file.content.length > 0);

  const treeRes = await fetch(
    `${base}/api/repositories/alice-dev/acme-docs/tree?path=${encodeURIComponent('docs')}`
  );
  assert.equal(treeRes.status, 200);
  const { entries } = await treeRes.json();
  assert.ok(entries.some((e) => e.name === 'guide.md' && e.type === 'file'));
});

test('private repository denies visitors and admits only its owner', async () => {
  const res = await fetch(`${base}/api/repositories/alice-dev/secret-research`);
  assert.equal(res.status, 404);

  const fileRes = await fetch(
    `${base}/api/repositories/alice-dev/secret-research/file?path=notes.md`
  );
  assert.equal(fileRes.status, 404);

  const signin = await post('/api/signin', {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  const cookie = signin.headers.get('set-cookie').split(';')[0];
  const ownerRes = await fetch(`${base}/api/repositories/alice-dev/secret-research`, {
    headers: { Cookie: cookie },
  });
  assert.equal(ownerRes.status, 200);
  const { repository } = await ownerRes.json();
  assert.equal(repository.visibility, 'private');

  const ownerFile = await fetch(
    `${base}/api/repositories/alice-dev/secret-research/file?path=notes.md`,
    { headers: { Cookie: cookie } }
  );
  assert.equal(ownerFile.status, 200);
});

test('missing repository and unknown subpaths return 404', async () => {
  const missing = await fetch(`${base}/api/repositories/alice-dev/nope`);
  assert.equal(missing.status, 404);
  const missingFile = await fetch(
    `${base}/api/repositories/alice-dev/acme-docs/file?path=nope.md`
  );
  assert.equal(missingFile.status, 404);
  const wrongShape = await fetch(`${base}/api/repositories/alice-dev/acme-docs/extra`);
  assert.equal(wrongShape.status, 404);
});

test('forgot password does not disclose whether the email exists', async () => {
  for (const email of ['alice.dev@example.test', 'ghost@example.test']) {
    const res = await post('/api/forgot-password', { email });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
  }
});

test('reset password: wrong code and unknown email are rejected', async () => {
  const wrong = await post('/api/reset-password', {
    email: 'alice.dev@example.test',
    code: '000000',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.json.fieldErrors.code, 'Verification code is invalid');

  const unknown = await post('/api/reset-password', {
    email: 'ghost@example.test',
    code: '123456',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(unknown.status, 422);
  assert.equal(unknown.json.fieldErrors.email, 'Email is not registered');

  // A rejected attempt leaves the registered account able to sign in with its
  // old password; the candidate new password is not accepted.
  const oldPass = await post('/api/signin', {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  assert.equal(oldPass.status, 200);
  const candidate = await post('/api/signin', {
    identifier: 'alice-dev',
    password: 'Replacement-password-456!',
  });
  assert.equal(candidate.status, 401);
});

test('reset password updates credentials atomically', async () => {
  const res = await post('/api/reset-password', {
    email: 'alice.dev@example.test',
    code: '123456',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.message, 'Password updated');

  const oldPass = await post('/api/signin', {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  assert.equal(oldPass.status, 401);

  const newPass = await post('/api/signin', {
    identifier: 'alice.dev@example.test',
    password: 'Replacement-password-456!',
  });
  assert.equal(newPass.status, 200);
});

test('unknown api and static paths return 404 without crashing', async () => {
  const api = await fetch(`${base}/api/nope`);
  assert.equal(api.status, 404);
  const favicon = await fetch(`${base}/favicon.ico`);
  assert.equal(favicon.status, 404);
  const missing = await fetch(`${base}/some/missing/page`);
  assert.equal(missing.status, 404);
});

test('store file exists after writes', () => {
  assert.ok(readFileSync(join(dir, 'store.json'), 'utf8').includes('accounts'));
});
