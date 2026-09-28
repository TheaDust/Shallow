import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RECOVERY_CODE,
  changePassword,
  createSession,
  currentAccount,
  endSession,
  hashPassword,
  registerAccount,
  requestRecovery,
  resetPassword,
  seedState,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "../src/domain/accounts.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

function freshState() {
  return { accounts: [], sessions: [], recovery: [] };
}

test("seeds alice-dev only into an empty storage and preserves modifications", () => {
  const state = freshState();
  seedState(state);
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].username, "alice-dev");
  assert.equal(state.accounts[0].email, "alice.dev@example.test");
  assert.equal(state.accounts[0].emailVerified, true);
  assert.equal(state.accounts[0].status, "active");
  assert.ok(verifyPassword("Valid-password-123!", state.accounts[0].password));

  // Restart must not re-seed or overwrite user changes.
  const restarted = freshState();
  restarted.accounts = state.accounts;
  const before = state.accounts[0].password;
  seedState(restarted);
  assert.equal(restarted.accounts.length, 1);
  assert.equal(restarted.accounts[0].password, before);
});

test("username validation follows the 1-39 lowercase ASCII rule", () => {
  assert.ok(validateUsername("pw-user-123"));
  assert.ok(validateUsername("a"));
  assert.ok(validateUsername("a-b-c"));
  assert.ok(validateUsername("alice-dev"));
  assert.ok(!validateUsername("-leading"));
  assert.ok(!validateUsername("trailing-"));
  assert.ok(!validateUsername("double--hyphen"));
  assert.ok(!validateUsername("Upper-Case"));
  assert.ok(!validateUsername(""));
  assert.ok(!validateUsername("a".repeat(40)));
  assert.ok(!validateUsername("a b"));
  assert.ok(!validateUsername("user.name"));
});

test("email validation requires one @, length and dotted domain", () => {
  assert.ok(validateEmail("pw-user-1@example.test"));
  assert.ok(validateEmail("alice.dev@example.test"));
  assert.ok(validateEmail("  padded@example.test  "));
  assert.ok(!validateEmail("not-an-email"));
  assert.ok(!validateEmail("a@b"));
  assert.ok(!validateEmail("a@b."));
  assert.ok(!validateEmail("a@.b"));
  assert.ok(!validateEmail("@example.test"));
  assert.ok(!validateEmail("a@b@c.test"));
  assert.ok(!validateEmail("a@b..test"));
  assert.ok(!validateEmail("a".repeat(250) + "@x.test"));
});

test("password validation requires 12-128 chars, four classes, no whitespace", () => {
  assert.ok(validatePassword("Valid-password-123!"));
  assert.ok(!validatePassword("short"));
  assert.ok(!validatePassword("valid-password-123!"));
  assert.ok(!validatePassword("VALID-PASSWORD-123!"));
  assert.ok(!validatePassword("Validpassword123"));
  assert.ok(!validatePassword("Valid-password-123! "));
  assert.ok(!validatePassword("Valid password 123!"));
  assert.ok(!validatePassword("Valid-password-123!" + "x".repeat(120)));
});

test("passwords are stored hashed and never plaintext", () => {
  const stored = hashPassword("Valid-password-123!");
  assert.ok(verifyPassword("Valid-password-123!", stored));
  assert.ok(!verifyPassword("Valid-password-124!", stored));
  assert.ok(!JSON.stringify(stored).includes("Valid-password-123!"));
});

test("registration creates a verified account atomically", () => {
  const state = freshState();
  const result = registerAccount(state, {
    username: "pw-user-1",
    email: "pw-user-1@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].emailVerified, true);
  assert.equal(state.accounts[0].username, "pw-user-1");
});

test("registration rejects multiple invalid fields together and keeps state empty", () => {
  const state = freshState();
  const result = registerAccount(state, {
    username: "-leading",
    email: "not-an-email",
    password: "short",
    confirmPassword: "different",
    agreeToTerms: false,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, {
    username: "Username format is invalid",
    email: "Email format is invalid",
    password: "Password requirements are not satisfied",
    confirmPassword: "Password confirmation does not match",
    terms: "Agree to terms is required",
  });
  assert.equal(state.accounts.length, 0);
});

test("duplicate username paired with an unused email is rejected", () => {
  const state = freshState();
  seedState(state);
  const result = registerAccount(state, {
    username: "alice-dev",
    email: "fresh@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.username, "Username already exists");
  assert.equal(result.errors.email, undefined);
  assert.equal(state.accounts.length, 1);
});

test("duplicate email is rejected and no account is created", () => {
  const state = freshState();
  seedState(state);
  const result = registerAccount(state, {
    username: "another-user",
    email: "alice.dev@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.email, "Email already exists");
  assert.equal(state.accounts.length, 1);
});

test("sign-in succeeds by username or email and stores an active session", () => {
  const state = freshState();
  seedState(state);
  for (const identifier of ["alice-dev", "alice.dev@example.test"]) {
    const result = createSession(state, { identifier, password: "Valid-password-123!" });
    assert.equal(result.ok, true);
    assert.equal(result.account.username, "alice-dev");
    assert.ok(result.sessionId.startsWith("sess_"));
    assert.equal(currentAccount(state, result.sessionId).username, "alice-dev");
  }
});

test("sign-in failures share one generic result and create no session", () => {
  const state = freshState();
  seedState(state);
  const attempts = [
    { identifier: "unknown-user", password: "Valid-password-123!" },
    { identifier: "alice-dev", password: "Wrong-password-1!" },
    { identifier: "alice-dev", password: "" },
  ];
  for (const attempt of attempts) {
    const result = createSession(state, attempt);
    assert.deepEqual(result, { ok: false });
  }
  assert.equal(state.sessions.length, 0);
});

test("sign-out invalidates the session so it can no longer be used", () => {
  const state = freshState();
  seedState(state);
  const { sessionId } = createSession(state, { identifier: "alice-dev", password: "Valid-password-123!" });
  assert.ok(currentAccount(state, sessionId));
  endSession(state, sessionId);
  assert.equal(currentAccount(state, sessionId), null);
  assert.equal(state.sessions[0].active, false);
});

test("changePassword updates only the current account and applies to sign-in", () => {
  const state = freshState();
  seedState(state);
  registerAccount(state, {
    username: "other-user",
    email: "other@example.test",
    password: "Other-password-123!",
    confirmPassword: "Other-password-123!",
    agreeToTerms: true,
  });
  const alice = state.accounts.find((account) => account.username === "alice-dev");
  const result = changePassword(state, {
    accountId: alice.id,
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.deepEqual(result, { ok: true });
  assert.ok(!createSession(state, { identifier: "alice-dev", password: "Valid-password-123!" }).ok);
  assert.equal(createSession(state, { identifier: "alice-dev", password: "New-password-456!" }).ok, true);
  // Other accounts are untouched.
  assert.equal(createSession(state, { identifier: "other-user", password: "Other-password-123!" }).ok, true);
});

test("changePassword rejects empty, incorrect or mismatched input and changes nothing", () => {
  const state = freshState();
  seedState(state);
  const alice = state.accounts.find((account) => account.username === "alice-dev");

  const missing = changePassword(state, {
    accountId: alice.id,
    currentPassword: "",
    newPassword: "Required-password-789!",
    confirmPassword: "Required-password-789!",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.errors.currentPassword, "Current password is required");

  const wrong = changePassword(state, {
    accountId: alice.id,
    currentPassword: "Wrong-password-1!",
    newPassword: "New-password-456!",
    confirmPassword: "does-not-match",
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.errors.currentPassword, "Current password is incorrect");
  assert.equal(wrong.errors.confirmPassword, "Password confirmation does not match");

  const weak = changePassword(state, {
    accountId: alice.id,
    currentPassword: "Valid-password-123!",
    newPassword: "short",
    confirmPassword: "short",
  });
  assert.equal(weak.ok, false);
  assert.equal(weak.errors.password, "Password requirements are not satisfied");

  const mismatch = changePassword(state, {
    accountId: alice.id,
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-789!",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.errors.confirmPassword, "Password confirmation does not match");

  // The old credentials remain usable after every rejected attempt.
  assert.equal(createSession(state, { identifier: "alice-dev", password: "Valid-password-123!" }).ok, true);
  assert.ok(!createSession(state, { identifier: "alice-dev", password: "New-password-456!" }).ok);
});

test("changePassword rejects a session that does not map to an account", () => {
  const state = freshState();
  seedState(state);
  const result = changePassword(state, {
    accountId: "acc_missing",
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.currentPassword, "Current password is required");
  assert.equal(createSession(state, { identifier: "alice-dev", password: "Valid-password-123!" }).ok, true);
});

test("recovery request returns the fixed code for registered and unknown emails", () => {
  const state = freshState();
  seedState(state);
  const registered = requestRecovery(state, { email: "alice.dev@example.test" });
  const unknown = requestRecovery(state, { email: "ghost@example.test" });
  assert.equal(registered.code, RECOVERY_CODE);
  assert.equal(unknown.code, RECOVERY_CODE);
  assert.equal(registered.code, "123456");
});

test("recovery reset updates only the registered account when code and password are valid", () => {
  const state = freshState();
  seedState(state);
  const { token } = requestRecovery(state, { email: "alice.dev@example.test" });
  const result = resetPassword(state, {
    token,
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.deepEqual(result, { ok: true });
  assert.ok(!createSession(state, { identifier: "alice-dev", password: "Valid-password-123!" }).ok);
  assert.equal(createSession(state, { identifier: "alice-dev", password: "Replacement-password-456!" }).ok, true);
});

test("recovery reset with wrong code, unknown email or bad confirmation changes nothing", () => {
  const state = freshState();
  seedState(state);
  const wrongCode = resetPassword(state, {
    token: requestRecovery(state, { email: "alice.dev@example.test" }).token,
    code: "000000",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(wrongCode.ok, false);
  assert.equal(wrongCode.errors.code, "Verification code is invalid");

  const unknown = resetPassword(state, {
    token: requestRecovery(state, { email: "ghost@example.test" }).token,
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors.email, "Email is not registered");

  const mismatch = resetPassword(state, {
    token: requestRecovery(state, { email: "alice.dev@example.test" }).token,
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-789!",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.errors.confirmPassword, "Password confirmation does not match");

  assert.ok(createSession(state, { identifier: "alice-dev", password: "Valid-password-123!" }).ok);
});

test("route-style updates keep the full state and return results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-routes-"));
  const path = join(directory, "state.json");
  const store = createJsonStore(path, { accounts: [], sessions: [], recovery: [] });

  await store.update((state) => {
    seedState(state);
  });
  let outcome;
  await store.update((state) => {
    outcome = createSession(state, { identifier: "alice-dev", password: "Valid-password-123!" });
  });
  assert.equal(outcome.ok, true);
  assert.ok(outcome.sessionId);

  const state = await store.read();
  assert.equal(state.accounts.length, 1);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].active, true);
});

test("registration and session writes persist through the JSON store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-accounts-"));
  const path = join(directory, "state.json");
  const store = createJsonStore(path, { accounts: [], sessions: [], recovery: [] });
  await store.update((state) => {
    seedState(state);
    registerAccount(state, {
      username: "pw-user-1",
      email: "pw-user-1@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    });
  });
  const persisted = JSON.parse(await readFile(path, "utf8"));
  assert.equal(persisted.accounts.length, 2);
  const reloaded = await store.read();
  assert.equal(reloaded.accounts[0].username, "alice-dev");
});
