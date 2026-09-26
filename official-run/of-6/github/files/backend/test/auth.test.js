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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-auth-test-'));
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

test('seed account alice-dev can sign in with the seeded password', async () => {
  const res = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.username, 'alice-dev');
  assert.equal(payload.email, 'alice.dev@example.test');
});

test('unknown account and wrong password show the same generic message', async () => {
  for (const body of [
    { identifier: 'ghost-user', password: 'Whatever-123!' },
    { identifier: 'alice-dev', password: 'Wrong-password-999!' },
  ]) {
    const res = await postJson(`${baseUrl}/api/auth/signin`, body);
    assert.equal(res.status, 401);
    const payload = await res.json();
    assert.equal(payload.message, 'Invalid credentials');
  }
});

test('the verified email also works as the sign-in identifier', async () => {
  const res = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'alice.dev@example.test',
    password: 'Valid-password-123!',
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.username, 'alice-dev');
});

test('failed sign-in creates no session cookie', async () => {
  const res = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'alice-dev',
    password: 'Wrong-password-999!',
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('unavailable account is rejected with the same generic message and no session', async () => {
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-auth-unavailable-'));
  const { createStore } = require('../src/store');
  const store = createStore(localDir);
  const account = store.findAccountByUsername('alice-dev');
  store.setAccountAvailable(account.id, false);

  const localApp = createApp({ dataDir: localDir, distDir: path.join(__dirname, 'fixtures', 'dist') });
  const localServer = http.createServer(localApp);
  await new Promise((resolve) => localServer.listen(0, resolve));
  const localBase = `http://127.0.0.1:${localServer.address().port}`;
  try {
    const res = await postJson(`${localBase}/api/auth/signin`, {
      identifier: 'alice-dev',
      password: 'Valid-password-123!',
    });
    assert.equal(res.status, 401);
    const payload = await res.json();
    assert.equal(payload.message, 'Invalid credentials');
    assert.equal(res.headers.get('set-cookie'), null);
  } finally {
    await new Promise((resolve) => localServer.close(resolve));
    fs.rmSync(localDir, { recursive: true, force: true });
  }
});

test('successful registration creates a sign-in-capable verified account', async () => {
  const res = await postJson(`${baseUrl}/api/auth/register`, {
    username: 'pw-user-abc',
    email: 'pw-user-abc@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    agreeToTerms: true,
  });
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.emailVerified, true);
  assert.ok(!JSON.stringify(payload).includes('Valid-password-123!'));
});

test('duplicate username is rejected with the exact message and no account is created', async () => {
  const res = await postJson(`${baseUrl}/api/auth/register`, {
    username: 'alice-dev',
    email: 'another.new@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    agreeToTerms: true,
  });
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.username, 'Username already exists');
  assert.equal(payload.errors.email, undefined);
});

test('several invalid fields produce all field errors together', async () => {
  const res = await postJson(`${baseUrl}/api/auth/register`, {
    username: '-bad',
    email: 'not-an-email',
    password: 'short',
    confirmPassword: 'different',
    agreeToTerms: false,
  });
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.errors.username, 'Username format is invalid');
  assert.equal(payload.errors.email, 'Email format is invalid');
  assert.equal(payload.errors.password, 'Password requirements are not satisfied');
  assert.equal(payload.errors.agreeToTerms, 'Agree to terms is required');
  assert.equal(payload.errors.confirmPassword, 'Password confirmation does not match');
});

test('new account email can sign in and the session survives a reload lookup', async () => {
  const registerRes = await postJson(`${baseUrl}/api/auth/register`, {
    username: 'pw-user-reload',
    email: 'pw-user-reload@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    agreeToTerms: true,
  });
  assert.equal(registerRes.status, 201);

  const signinRes = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'pw-user-reload@example.test',
    password: 'Valid-password-123!',
  });
  assert.equal(signinRes.status, 200);
  const setCookie = signinRes.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('session='));
  const sessionId = setCookie.split(';')[0].split('=')[1];

  // Reload / session lookup with the same cookie keeps the user signed in.
  const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: `session=${sessionId}` },
  });
  const sessionPayload = await sessionRes.json();
  assert.equal(sessionPayload.authenticated, true);
  assert.equal(sessionPayload.username, 'pw-user-reload');
});

test('sign-out invalidates the session for subsequent requests', async () => {
  const signinRes = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  const setCookie = signinRes.headers.get('set-cookie');
  const sessionId = setCookie.split(';')[0].split('=')[1];
  const cookie = `session=${sessionId}`;

  const signoutRes = await postJson(`${baseUrl}/api/auth/signout`, {}, { Cookie: cookie });
  assert.equal(signoutRes.status, 200);

  const sessionRes = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
  const sessionPayload = await sessionRes.json();
  assert.equal(sessionPayload.authenticated, false);
});

test('recovery request always shows the fixed code for registered and unknown emails', async () => {
  for (const email of ['alice.dev@example.test', 'nobody@example.test']) {
    const res = await postJson(`${baseUrl}/api/auth/recovery/request`, { email });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.code, '123456');
  }
});

test('recovery reset updates only the matching account when code and password are valid', async () => {
  const res = await postJson(`${baseUrl}/api/auth/recovery/reset`, {
    email: 'alice.dev@example.test',
    code: '123456',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.message, 'Password updated');

  const oldPasswordRes = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'alice-dev',
    password: 'Valid-password-123!',
  });
  assert.equal(oldPasswordRes.status, 401);
  const newPasswordRes = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'alice-dev',
    password: 'Replacement-password-456!',
  });
  assert.equal(newPasswordRes.status, 200);
});

test('recovery reset with invalid code or unknown email explains the reason and changes nothing', async () => {
  const wrongCodeRes = await postJson(`${baseUrl}/api/auth/recovery/reset`, {
    email: 'alice.dev@example.test',
    code: '000000',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(wrongCodeRes.status, 400);
  const wrongCodePayload = await wrongCodeRes.json();
  assert.equal(wrongCodePayload.errors.verificationCode, 'Verification code is invalid');

  const unknownEmailRes = await postJson(`${baseUrl}/api/auth/recovery/reset`, {
    email: 'unknown@example.test',
    code: '123456',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(unknownEmailRes.status, 400);
  const unknownEmailPayload = await unknownEmailRes.json();
  assert.equal(unknownEmailPayload.errors.email, 'Email is not registered');

  // Credentials unchanged (still the replacement password from previous test).
  const checkRes = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'alice-dev',
    password: 'Replacement-password-456!',
  });
  assert.equal(checkRes.status, 200);
});

test('recovery reset with noncompliant password or mismatched confirmation changes nothing', async () => {
  // At this point alice-dev's password is the replacement value from the
  // successful-reset test above; each failed attempt must leave it intact.
  const attempts = [
    {
      body: {
        email: 'alice.dev@example.test',
        code: '123456',
        newPassword: 'short',
        confirmPassword: 'short',
      },
      field: 'newPassword',
      message: 'Password requirements are not satisfied',
    },
    {
      body: {
        email: 'alice.dev@example.test',
        code: '123456',
        newPassword: 'Replacement-password-456!',
        confirmPassword: 'Different-password-789!',
      },
      field: 'confirmPassword',
      message: 'Password confirmation does not match',
    },
  ];
  for (const attempt of attempts) {
    const res = await postJson(`${baseUrl}/api/auth/recovery/reset`, attempt.body);
    assert.equal(res.status, 400);
    const payload = await res.json();
    assert.equal(payload.errors[attempt.field], attempt.message);
  }

  const checkRes = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'alice-dev',
    password: 'Replacement-password-456!',
  });
  assert.equal(checkRes.status, 200);
  const candidateRes = await postJson(`${baseUrl}/api/auth/signin`, {
    identifier: 'alice-dev',
    password: 'Different-password-789!',
  });
  assert.equal(candidateRes.status, 401);
});

test('registered accounts are persisted and re-read from the same data directory', async () => {
  const store = require('../src/store');
  const store2 = store.createStore(dataDir);
  const account = store2.findAccountByEmail('pw-user-reload@example.test');
  assert.ok(account, 'account must survive a store reload');
  assert.equal(account.username, 'pw-user-reload');
  assert.equal(account.emailVerified, true);
});
