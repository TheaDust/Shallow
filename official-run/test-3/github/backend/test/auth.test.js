import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';
import { provisionSeed, SEED_ACCOUNT } from '../src/seed.js';
import * as auth from '../src/auth.js';
import { RECOVERY_CODE } from '../src/validation.js';

let dir;
let store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shallow-auth-test-'));
  store = createStore(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('seed provisions alice-dev once and persists', () => {
  provisionSeed(store);
  const alice = store.findAccountByUsername('alice-dev');
  assert.ok(alice);
  assert.equal(alice.email, 'alice.dev@example.test');
  assert.equal(alice.emailVerified, true);
  assert.equal(alice.status, 'active');

  // Re-provisioning does not duplicate.
  provisionSeed(store);
  assert.equal(store.findAccountByUsername('alice-dev').username, 'alice-dev');

  // Reload from disk keeps the seeded account.
  const reloaded = createStore(dir);
  assert.ok(reloaded.findAccountByUsername('alice-dev'));
});

test('register: success stores a sign-in capable verified account', () => {
  provisionSeed(store);
  const result = auth.register(store, {
    username: 'pw-user-1',
    email: 'pw.user@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    agreeToTerms: true,
  });
  assert.equal(result.ok, true);
  const account = store.findAccountByUsername('pw-user-1');
  assert.ok(account);
  assert.equal(account.emailVerified, true);
  assert.equal(account.status, 'active');

  // Email can sign in immediately.
  const signin = auth.signIn(store, { identifier: 'pw.user@example.test', password: 'Valid-password-123!' });
  assert.equal(signin.ok, true);
  assert.equal(signin.user.username, 'pw-user-1');
});

test('register: duplicate username with unused email keeps both values and reports error', () => {
  provisionSeed(store);
  const result = auth.register(store, {
    username: 'alice-dev',
    email: 'someone-else@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    agreeToTerms: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.fieldErrors.username, 'Username already exists');
  assert.equal(result.fieldErrors.email, undefined);
  assert.equal(store.findAccountByEmail('someone-else@example.test'), null);
});

test('register: several invalid fields are reported together', () => {
  const result = auth.register(store, {
    username: '-leading-hyphen',
    email: 'not-an-email',
    password: 'short',
    confirmPassword: 'different',
    agreeToTerms: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.fieldErrors.username, 'Username format is invalid');
  assert.equal(result.fieldErrors.email, 'Email format is invalid');
  assert.equal(result.fieldErrors.password, 'Password requirements are not satisfied');
  assert.equal(result.fieldErrors.confirmPassword, 'Password confirmation does not match');
  assert.equal(result.fieldErrors.agreeToTerms, 'Agree to terms is required');
  assert.equal(store.isSeeded(), false); // no account was created
});

test('register: duplicate email reports email conflict and creates nothing', () => {
  provisionSeed(store);
  const result = auth.register(store, {
    username: 'another-user',
    email: 'alice.dev@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    agreeToTerms: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.fieldErrors.email, 'Email already exists');
  assert.equal(store.findAccountByUsername('another-user'), null);
});

test('register: missing fields and unchecked terms fail', () => {
  const result = auth.register(store, { username: '', email: '', password: '', confirmPassword: '', agreeToTerms: false });
  assert.equal(result.ok, false);
  assert.equal(result.fieldErrors.username, 'Username format is invalid');
  assert.equal(result.fieldErrors.email, 'Email format is invalid');
  assert.equal(result.fieldErrors.password, 'Password requirements are not satisfied');
  assert.equal(result.fieldErrors.agreeToTerms, 'Agree to terms is required');
});

test('register: whitespace-trimmed email conflict detected', () => {
  provisionSeed(store);
  const result = auth.register(store, {
    username: 'new-user',
    email: '  alice.dev@example.test  ',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    agreeToTerms: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.fieldErrors.email, 'Email already exists');
});

test('sign in: success by username and by email creates an active session', () => {
  provisionSeed(store);
  const byUsername = auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' });
  assert.equal(byUsername.ok, true);
  assert.equal(byUsername.user.username, 'alice-dev');
  const session = store.findSessionById(byUsername.session.id);
  assert.equal(session.active, true);
  assert.equal(session.accountId, store.findAccountByUsername('alice-dev').id);

  const byEmail = auth.signIn(store, { identifier: 'alice.dev@example.test', password: 'Valid-password-123!' });
  assert.equal(byEmail.ok, true);
});

test('sign in: unknown account, wrong password all show the same generic message', () => {
  provisionSeed(store);
  const unknown = auth.signIn(store, { identifier: 'nobody-here', password: 'Valid-password-123!' });
  const wrongPw = auth.signIn(store, { identifier: 'alice-dev', password: 'Wrong-password-123!' });
  const empty = auth.signIn(store, { identifier: '', password: '' });
  for (const result of [unknown, wrongPw, empty]) {
    assert.equal(result.ok, false);
    assert.equal(result.message, 'Invalid credentials');
  }
  // no session was created for any failed attempt
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.deepEqual(Object.keys(onDisk.sessions), []);
});

test('sign out: invalidates only the current session', () => {
  provisionSeed(store);
  const s1 = auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).session;
  const s2 = auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).session;
  auth.signOut(store, s1.id);
  assert.equal(store.findSessionById(s1.id).active, false);
  assert.equal(store.findSessionById(s2.id).active, true);
});

test('recovery: request never discloses existence and returns the fixed code', () => {
  provisionSeed(store);
  const known = auth.recoverRequest(store, { email: 'alice.dev@example.test' });
  const unknown = auth.recoverRequest(store, { email: 'ghost@example.test' });
  assert.equal(known.code, '123456');
  assert.equal(unknown.code, '123456');
});

test('recovery: correct code + compliant password updates only that account', () => {
  provisionSeed(store);
  const result = auth.recoverReset(store, {
    email: 'alice.dev@example.test',
    code: '123456',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(result.ok, true);
  // old password fails, new password works
  assert.equal(auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).ok, false);
  assert.equal(auth.signIn(store, { identifier: 'alice-dev', password: 'Replacement-password-456!' }).ok, true);
});

test('recovery: wrong code, unknown email, bad password, mismatch all fail atomically', () => {
  provisionSeed(store);
  const wrongCode = auth.recoverReset(store, {
    email: 'alice.dev@example.test',
    code: '000000',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(wrongCode.ok, false);
  assert.equal(wrongCode.fieldErrors.code, 'Verification code is invalid');

  const unknownEmail = auth.recoverReset(store, {
    email: 'ghost@example.test',
    code: '123456',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(unknownEmail.ok, false);
  assert.equal(unknownEmail.fieldErrors.email, 'Email is not registered');

  const badPassword = auth.recoverReset(store, {
    email: 'alice.dev@example.test',
    code: '123456',
    newPassword: 'weak',
    confirmPassword: 'weak',
  });
  assert.equal(badPassword.ok, false);
  assert.equal(badPassword.fieldErrors.newPassword, 'Password requirements are not satisfied');

  const mismatch = auth.recoverReset(store, {
    email: 'alice.dev@example.test',
    code: '123456',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Different-password-456!',
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.fieldErrors.confirmPassword, 'Password confirmation does not match');

  // The account is untouched: old password still works.
  assert.equal(auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).ok, true);
});

test('recovery: code constant used literally', () => {
  assert.equal(RECOVERY_CODE, '123456');
});

test('persistence: registered accounts and sessions survive reload', () => {
  provisionSeed(store);
  auth.register(store, {
    username: 'persist-user',
    email: 'persist@example.test',
    password: 'Valid-password-123!',
    confirmPassword: 'Valid-password-123!',
    agreeToTerms: true,
  });
  const session = auth.signIn(store, { identifier: 'persist-user', password: 'Valid-password-123!' }).session;
  const reloaded = createStore(dir);
  assert.ok(reloaded.findAccountByUsername('persist-user'));
  const s = reloaded.findSessionById(session.id);
  assert.ok(s && s.active);
});

test('change password: success updates only that account and invalidates its sessions', () => {
  provisionSeed(store);
  const alice = store.findAccountByUsername('alice-dev');
  const session = auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).session;
  const result = auth.changePassword(store, alice.id, {
    currentPassword: 'Valid-password-123!',
    newPassword: 'New-password-456!',
    confirmPassword: 'New-password-456!',
  });
  assert.equal(result.ok, true);
  // old password no longer works, new password does
  assert.equal(auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).ok, false);
  assert.equal(auth.signIn(store, { identifier: 'alice-dev', password: 'New-password-456!' }).ok, true);
  // existing sessions of the account are invalidated (REQ-1)
  assert.equal(store.findSessionById(session.id).active, false);
});

test('change password: empty current password reports required and changes nothing', () => {
  provisionSeed(store);
  const alice = store.findAccountByUsername('alice-dev');
  const result = auth.changePassword(store, alice.id, {
    currentPassword: '',
    newPassword: 'New-password-456!',
    confirmPassword: 'New-password-456!',
  });
  assert.equal(result.ok, false);
  assert.equal(result.fieldErrors.currentPassword, 'Current password is required');
  assert.equal(auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).ok, true);
});

test('change password: wrong current password and mismatch report reasons, old credentials remain usable', () => {
  provisionSeed(store);
  const alice = store.findAccountByUsername('alice-dev');
  const wrongCurrent = auth.changePassword(store, alice.id, {
    currentPassword: 'Wrong-password-123!',
    newPassword: 'New-password-456!',
    confirmPassword: 'New-password-456!',
  });
  assert.equal(wrongCurrent.ok, false);
  assert.equal(wrongCurrent.fieldErrors.currentPassword, 'Current password is incorrect');

  const mismatch = auth.changePassword(store, alice.id, {
    currentPassword: 'Valid-password-123!',
    newPassword: 'New-password-456!',
    confirmPassword: 'does-not-match',
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.fieldErrors.confirmPassword, 'Password confirmation does not match');

  // account untouched
  assert.equal(auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).ok, true);
});

test('change password: noncompliant new password is rejected beside the field', () => {
  provisionSeed(store);
  const alice = store.findAccountByUsername('alice-dev');
  const result = auth.changePassword(store, alice.id, {
    currentPassword: 'Valid-password-123!',
    newPassword: 'short',
    confirmPassword: 'short',
  });
  assert.equal(result.ok, false);
  assert.equal(result.fieldErrors.newPassword, 'Password requirements are not satisfied');
  assert.equal(auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).ok, true);
});

test('password update invalidates existing sessions of that account', () => {
  provisionSeed(store);
  const session = auth.signIn(store, { identifier: 'alice-dev', password: 'Valid-password-123!' }).session;
  auth.recoverReset(store, {
    email: 'alice.dev@example.test',
    code: '123456',
    newPassword: 'Replacement-password-456!',
    confirmPassword: 'Replacement-password-456!',
  });
  assert.equal(store.findSessionById(session.id).active, false);
});

test('seed account constant matches requirement values', () => {
  assert.equal(SEED_ACCOUNT.username, 'alice-dev');
  assert.equal(SEED_ACCOUNT.email, 'alice.dev@example.test');
  assert.equal(SEED_ACCOUNT.password, 'Valid-password-123!');
});
