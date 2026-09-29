import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAccountsDomain, SEED_ACCOUNT } from "../src/domain/accounts.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function createDomain() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-accounts-"));
  const store = createJsonStore(join(directory, "state.json"), { accounts: {}, sessions: {} });
  const domain = createAccountsDomain(store);
  await domain.seedIfEmpty();
  return { directory, store, domain };
}

test("seed provisions the alice-dev account", async () => {
  const { domain, store } = await createDomain();
  const state = await store.read();
  const account = state.accounts["alice-dev"];
  assert.ok(account);
  assert.equal(account.username, "alice-dev");
  assert.equal(account.email, "alice.dev@example.test");
  assert.equal(account.emailVerified, true);
  assert.equal(account.status, "active");
  assert.ok(!account.password.includes("Valid-password-123!"), "password is stored hashed");
});

test("sign in works with username and with email; wrong credentials fail generically", async () => {
  const { domain } = await createDomain();
  const byUsername = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  assert.equal(byUsername.ok, true);
  assert.equal(byUsername.account.username, "alice-dev");

  const byEmail = await domain.signIn({ identifier: "alice.dev@example.test", password: "Valid-password-123!" });
  assert.equal(byEmail.ok, true);

  const wrongPassword = await domain.signIn({ identifier: "alice-dev", password: "Wrong-password-1!" });
  assert.deepEqual(wrongPassword, { ok: false });

  const unknown = await domain.signIn({ identifier: "nobody", password: "Valid-password-123!" });
  assert.deepEqual(unknown, { ok: false });
});

test("registration creates a sign-in-capable verified account", async () => {
  const { domain } = await createDomain();
  const result = await domain.register({
    username: "pw-user-abc123",
    email: "pw-user-abc123@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.equal(result.ok, true);

  const signIn = await domain.signIn({ identifier: "pw-user-abc123@example.test", password: "Valid-password-123!" });
  assert.equal(signIn.ok, true);
  assert.equal(signIn.account.username, "pw-user-abc123");
});

test("registration rejects conflicts without creating an account", async () => {
  const { domain, store } = await createDomain();
  const duplicateUsername = await domain.register({
    username: "alice-dev",
    email: "unused@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.equal(duplicateUsername.ok, false);
  assert.equal(duplicateUsername.errors.username, "Username already exists");

  const duplicateEmail = await domain.register({
    username: "other-user",
    email: "alice.dev@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.equal(duplicateEmail.ok, false);
  assert.equal(duplicateEmail.errors.email, "Email already exists");

  const state = await store.read();
  assert.equal(state.accounts["other-user"], undefined);
  assert.equal(state.accounts["pw-user-abc123"], undefined);
});

test("registration reports several invalid fields together", async () => {
  const { domain } = await createDomain();
  const result = await domain.register({
    username: "-hyphen",
    email: "not-an-email",
    password: "short",
    confirmPassword: "different",
    agreeToTerms: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.username, "Username format is invalid");
  assert.equal(result.errors.email, "Email format is invalid");
  assert.equal(result.errors.password, "Password requirements are not satisfied");
  assert.equal(result.errors.confirmPassword, "Passwords do not match");
  assert.equal(result.errors.terms, "Agree to terms is required");
});

test("registration requires every field and valid terms", async () => {
  const { domain } = await createDomain();
  const result = await domain.register({
    username: "pw-user-abc123",
    email: "pw-user-abc123@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.terms, "Agree to terms is required");
  assert.equal(result.errors.username, undefined);
});

test("sessions persist, authorize the account, and are destroyed on sign out", async () => {
  const { domain } = await createDomain();
  const signIn = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  assert.equal(signIn.ok, true);
  const sessionId = signIn.session.id;

  const account = await domain.getSessionAccount(sessionId);
  assert.equal(account.username, "alice-dev");

  await domain.destroySession(sessionId);
  assert.equal(await domain.getSessionAccount(sessionId), null);
});

test("recovery updates only the registered account with the correct code", async () => {
  const { domain } = await createDomain();
  const reset = await domain.resetPassword({
    email: "alice.dev@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(reset.ok, true);

  const oldPassword = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  assert.equal(oldPassword.ok, false);
  const newPassword = await domain.signIn({ identifier: "alice-dev", password: "Replacement-password-456!" });
  assert.equal(newPassword.ok, true);
});

test("recovery failures leave credentials unchanged", async () => {
  const { domain } = await createDomain();

  const wrongCode = await domain.resetPassword({
    email: "alice.dev@example.test",
    code: "000000",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(wrongCode.ok, false);
  assert.equal(wrongCode.errors.code, "Verification code is invalid");

  const unknownEmail = await domain.resetPassword({
    email: "nobody@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(unknownEmail.ok, false);
  assert.equal(unknownEmail.errors.email, "Email is not registered");

  const noncompliant = await domain.resetPassword({
    email: "alice.dev@example.test",
    code: "123456",
    newPassword: "short",
    confirmPassword: "short",
  });
  assert.equal(noncompliant.ok, false);
  assert.equal(noncompliant.errors.newPassword, "Password requirements are not satisfied");

  const mismatch = await domain.resetPassword({
    email: "alice.dev@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Other-password-789!",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.errors.confirmPassword, "Passwords do not match");

  const stillOld = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  assert.equal(stillOld.ok, true);
  const candidateNew = await domain.signIn({ identifier: "alice-dev", password: "Replacement-password-456!" });
  assert.equal(candidateNew.ok, false);
});

test("registered and unknown emails enter the same recovery request step", async () => {
  const { domain } = await createDomain();
  // The request step performs no write and cannot distinguish accounts; a reset
  // still requires a registered email, correct code and compliant password.
  const unknown = await domain.resetPassword({
    email: "no-such-user@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors.email, "Email is not registered");
  assert.equal(SEED_ACCOUNT.username, "alice-dev");
});

test("change password updates the signed-in account's credentials", async () => {
  const { domain } = await createDomain();
  const signIn = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  assert.equal(signIn.ok, true);

  const result = await domain.changePassword(signIn.session.id, {
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.equal(result.ok, true);

  const oldPassword = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  assert.equal(oldPassword.ok, false);
  const newPassword = await domain.signIn({ identifier: "alice-dev", password: "New-password-456!" });
  assert.equal(newPassword.ok, true);
  assert.equal(newPassword.account.username, "alice-dev");
});

test("change password requires the current password", async () => {
  const { domain } = await createDomain();
  const signIn = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  const result = await domain.changePassword(signIn.session.id, {
    currentPassword: "",
    newPassword: "Required-password-789!",
    confirmPassword: "Required-password-789!",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.currentPassword, "Current password is required");

  const stillOld = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  assert.equal(stillOld.ok, true);
  const candidateNew = await domain.signIn({ identifier: "alice-dev", password: "Required-password-789!" });
  assert.equal(candidateNew.ok, false);
});

test("change password rejects incorrect current, noncompliant new, missing and mismatched fields", async () => {
  const { domain } = await createDomain();
  const signIn = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  const sessionId = signIn.session.id;

  const wrongCurrent = await domain.changePassword(sessionId, {
    currentPassword: "Wrong-password-1!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.equal(wrongCurrent.ok, false);
  assert.equal(wrongCurrent.errors.currentPassword, "Current password is incorrect");

  const noncompliant = await domain.changePassword(sessionId, {
    currentPassword: "Valid-password-123!",
    newPassword: "short",
    confirmPassword: "short",
  });
  assert.equal(noncompliant.ok, false);
  assert.equal(noncompliant.errors.newPassword, "Password requirements are not satisfied");

  const mismatch = await domain.changePassword(sessionId, {
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "does-not-match",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.errors.confirmPassword, "Password confirmation does not match");

  const missingNew = await domain.changePassword(sessionId, {
    currentPassword: "Valid-password-123!",
    newPassword: "",
    confirmPassword: "",
  });
  assert.equal(missingNew.ok, false);
  assert.equal(missingNew.errors.newPassword, "New password is required");
  assert.equal(missingNew.errors.confirmPassword, "Confirm password is required");

  const stillOld = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  assert.equal(stillOld.ok, true);
  const candidateNew = await domain.signIn({ identifier: "alice-dev", password: "New-password-456!" });
  assert.equal(candidateNew.ok, false);
});

test("change password requires a valid session and touches only the current account", async () => {
  const { domain } = await createDomain();

  const unauthorized = await domain.changePassword("no-such-session", {
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.unauthorized, true);

  const registered = await domain.register({
    username: "bob-user",
    email: "bob.user@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.equal(registered.ok, true);
  const bobSignIn = await domain.signIn({ identifier: "bob-user", password: "Valid-password-123!" });
  assert.equal(bobSignIn.ok, true);

  const result = await domain.changePassword(bobSignIn.session.id, {
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.equal(result.ok, true);

  const aliceOld = await domain.signIn({ identifier: "alice-dev", password: "Valid-password-123!" });
  assert.equal(aliceOld.ok, true, "alice's password is untouched");
  const bobOld = await domain.signIn({ identifier: "bob-user", password: "Valid-password-123!" });
  assert.equal(bobOld.ok, false);
  const bobNew = await domain.signIn({ identifier: "bob-user", password: "New-password-456!" });
  assert.equal(bobNew.ok, true);
});
