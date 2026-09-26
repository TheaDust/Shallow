'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');

const SEED_PASSWORD = 'Valid-password-123!';
const NEW_PASSWORD = 'New-password-456!';

let dataDir;
let server;
let baseUrl;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-change-pw-test-'));
  const app = createApp({ dataDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function signIn(identifier, password) {
  const res = await postJson(`${baseUrl}/api/auth/signin`, { identifier, password });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('session='));
  return setCookie.split(';')[0].split('=')[1];
}

async function changePassword(sessionId, body) {
  return postJson(`${baseUrl}/api/auth/change-password`, body, {
    Cookie: `session=${sessionId}`,
  });
}

async function signInStatus(identifier, password) {
  const res = await postJson(`${baseUrl}/api/auth/signin`, { identifier, password });
  return res.status;
}

test('successful change uses the new password immediately and rejects the old one', async () => {
  const sessionId = await signIn('alice-dev', SEED_PASSWORD);
  const res = await changePassword(sessionId, {
    currentPassword: SEED_PASSWORD,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.message, 'Password updated');
  // The response never contains a full password.
  assert.ok(!JSON.stringify(payload).includes(SEED_PASSWORD));
  assert.ok(!JSON.stringify(payload).includes(NEW_PASSWORD));

  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 401);
  assert.equal(await signInStatus('alice-dev', NEW_PASSWORD), 200);

  // Restore the seeded password for the remaining tests in this file.
  const sessionId2 = await signIn('alice-dev', NEW_PASSWORD);
  const restoreRes = await changePassword(sessionId2, {
    currentPassword: NEW_PASSWORD,
    newPassword: SEED_PASSWORD,
    confirmPassword: SEED_PASSWORD,
  });
  assert.equal(restoreRes.status, 200);
  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 200);
});

test('empty current password shows "Current password is required" and changes nothing', async () => {
  const sessionId = await signIn('alice-dev', SEED_PASSWORD);
  const res = await changePassword(sessionId, {
    currentPassword: '',
    newPassword: 'Required-password-789!',
    confirmPassword: 'Required-password-789!',
  });
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.currentPassword, 'Current password is required');
  assert.equal(payload.errors.newPassword, undefined);

  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 200);
  assert.equal(await signInStatus('alice-dev', 'Required-password-789!'), 401);
});

test('incorrect current password shows "Current password is incorrect" and changes nothing', async () => {
  const sessionId = await signIn('alice-dev', SEED_PASSWORD);
  const res = await changePassword(sessionId, {
    currentPassword: 'Wrong-current-000!',
    newPassword: 'Required-password-789!',
    confirmPassword: 'Required-password-789!',
  });
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.currentPassword, 'Current password is incorrect');

  // Old credentials stay usable and the candidate new password does not work.
  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 200);
  assert.equal(await signInStatus('alice-dev', 'Required-password-789!'), 401);
});

test('mismatched confirmation shows "Password confirmation does not match" and changes nothing', async () => {
  const sessionId = await signIn('alice-dev', SEED_PASSWORD);
  const res = await changePassword(sessionId, {
    currentPassword: SEED_PASSWORD,
    newPassword: 'Required-password-789!',
    confirmPassword: 'Different-password-000!',
  });
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.confirmPassword, 'Password confirmation does not match');

  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 200);
  assert.equal(await signInStatus('alice-dev', 'Required-password-789!'), 401);
});

test('noncompliant new password shows "Password requirements are not satisfied"', async () => {
  const sessionId = await signIn('alice-dev', SEED_PASSWORD);
  const res = await changePassword(sessionId, {
    currentPassword: SEED_PASSWORD,
    newPassword: 'short',
    confirmPassword: 'short',
  });
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.newPassword, 'Password requirements are not satisfied');
  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 200);
});

test('missing new password and missing confirmation are reported on their fields', async () => {
  const sessionId = await signIn('alice-dev', SEED_PASSWORD);
  const res = await changePassword(sessionId, {
    currentPassword: SEED_PASSWORD,
    newPassword: '',
    confirmPassword: '',
  });
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.newPassword, 'New password is required');
  assert.equal(payload.errors.confirmPassword, 'Confirm password is required');
  assert.equal(payload.errors.currentPassword, undefined);
  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 200);
});

test('unauthenticated change-password request is rejected and changes nothing', async () => {
  const res = await postJson(`${baseUrl}/api/auth/change-password`, {
    currentPassword: SEED_PASSWORD,
    newPassword: 'Required-password-789!',
    confirmPassword: 'Required-password-789!',
  });
  assert.equal(res.status, 401);
  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 200);
  assert.equal(await signInStatus('alice-dev', 'Required-password-789!'), 401);
});

test('changing one account password leaves other accounts untouched', async () => {
  const otherUsername = 'other-dev-xyz';
  const otherEmail = 'other.dev@example.test';
  const registerRes = await postJson(`${baseUrl}/api/auth/register`, {
    username: otherUsername,
    email: otherEmail,
    password: SEED_PASSWORD,
    confirmPassword: SEED_PASSWORD,
    agreeToTerms: true,
  });
  assert.equal(registerRes.status, 201);

  const aliceSession = await signIn('alice-dev', SEED_PASSWORD);
  const res = await changePassword(aliceSession, {
    currentPassword: SEED_PASSWORD,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  assert.equal(res.status, 200);

  // The other account still signs in with its own credentials.
  assert.equal(await signInStatus(otherUsername, SEED_PASSWORD), 200);
  // alice-dev now needs the new password.
  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 401);
  assert.equal(await signInStatus('alice-dev', NEW_PASSWORD), 200);

  // Restore the seeded password.
  const aliceSession2 = await signIn('alice-dev', NEW_PASSWORD);
  const restoreRes = await changePassword(aliceSession2, {
    currentPassword: NEW_PASSWORD,
    newPassword: SEED_PASSWORD,
    confirmPassword: SEED_PASSWORD,
  });
  assert.equal(restoreRes.status, 200);
  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 200);
});

test('a rejected attempt keeps the previously successful password working', async () => {
  const sessionId = await signIn('alice-dev', SEED_PASSWORD);
  const res = await changePassword(sessionId, {
    currentPassword: 'Wrong-current-000!',
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  assert.equal(res.status, 400);
  assert.equal(await signInStatus('alice-dev', SEED_PASSWORD), 200);
  assert.equal(await signInStatus('alice-dev', NEW_PASSWORD), 401);
});
