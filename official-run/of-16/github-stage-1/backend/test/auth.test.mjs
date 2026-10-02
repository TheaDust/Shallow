import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";

const ALICE = { username: "alice-dev", email: "alice.dev@example.test", password: "Valid-password-123!" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-auth-"));
  const store = createStateStore({ dataDir });
  const app = createApp({ store });
  const server = createServer((request, response) => {
    void app(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    store,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function call(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, body: payload, cookie: setCookie ? setCookie.split(";")[0] : null };
}

async function signIn(baseUrl, identifier, password) {
  return call(baseUrl, "/api/auth/signin", { method: "POST", body: { identifier, password } });
}

test("seeded account signs in with username or email and keeps the session across reloads", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const byUsername = await signIn(app.baseUrl, ALICE.username, ALICE.password);
  assert.equal(byUsername.status, 200);
  assert.equal(byUsername.body.account.username, "alice-dev");
  assert.equal(byUsername.body.account.email, ALICE.email);
  assert.equal(byUsername.body.account.verified, true);
  assert.ok(byUsername.cookie?.startsWith("session="));
  assert.equal("passwordHash" in byUsername.body.account, false);

  const session = await call(app.baseUrl, "/api/auth/session", { cookie: byUsername.cookie });
  assert.equal(session.status, 200);
  assert.equal(session.body.account.username, "alice-dev");

  const restored = await call(app.baseUrl, "/api/auth/session", { cookie: byUsername.cookie });
  assert.equal(restored.body.account.username, "alice-dev");

  const byEmail = await signIn(app.baseUrl, ALICE.email, ALICE.password);
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.body.account.username, "alice-dev");
  assert.notEqual(byEmail.cookie, byUsername.cookie);
});

test("failed authentication is generic and never creates a session", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const unknown = await signIn(app.baseUrl, "unknown@example.test", ALICE.password);
  assert.equal(unknown.status, 401);
  assert.deepEqual(unknown.body, { error: "Invalid credentials" });
  assert.equal(unknown.cookie, null);

  const wrongPassword = await signIn(app.baseUrl, ALICE.username, `${ALICE.password}-wrong`);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(wrongPassword.body, { error: "Invalid credentials" });

  const anonymous = await call(app.baseUrl, "/api/auth/session");
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.body.account, null);
});

test("registration stores a verified account and rejects duplicates", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const created = await call(app.baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      username: "nora-demo",
      email: "nora.demo@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.account.username, "nora-demo");
  assert.equal(created.body.account.verified, true);

  const signInAfterRegistration = await signIn(app.baseUrl, "nora.demo@example.test", "Valid-password-123!");
  assert.equal(signInAfterRegistration.status, 200);
  assert.equal(signInAfterRegistration.body.account.username, "nora-demo");

  const duplicateUsername = await call(app.baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      username: "nora-demo",
      email: "nora.other@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    },
  });
  assert.equal(duplicateUsername.status, 400);
  assert.deepEqual(duplicateUsername.body.errors, { username: "Username already exists" });

  const duplicateSeedEmail = await call(app.baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      username: "alice-copy",
      email: ALICE.email,
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    },
  });
  assert.equal(duplicateSeedEmail.status, 400);
  assert.deepEqual(duplicateSeedEmail.body.errors, { email: "Email already exists" });
});

test("registration returns all field errors of one submission", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const response = await call(app.baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      username: "-invalid-demo",
      email: "not-an-email",
      password: "short",
      confirmPassword: "different",
      agreeToTerms: false,
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.errors.username, "Username format is invalid");
  assert.equal(response.body.errors.email, "Email format is invalid");
  assert.equal(response.body.errors.password, "Password requirements are not satisfied");
  assert.equal(response.body.errors.agreeToTerms, "Agree to terms is required");

  const stillAbsent = await signIn(app.baseUrl, "invalid-demo", "short");
  assert.equal(stillAbsent.status, 401);
});

test("recovery shows the fixed code for known and unknown emails and only updates with it", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const known = await call(app.baseUrl, "/api/auth/password-reset/request", {
    method: "POST",
    body: { email: "recovery-visibility@example.test" },
  });
  assert.equal(known.status, 200);
  assert.equal(known.body.code, "123456");

  const unknown = await call(app.baseUrl, "/api/auth/password-reset/request", {
    method: "POST",
    body: { email: "unknown@example.test" },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.code, "123456");

  const wrongCode = await call(app.baseUrl, "/api/auth/password-reset/confirm", {
    method: "POST",
    body: {
      email: "recovery-invalid-code@example.test",
      code: "000000",
      newPassword: "Replacement-password-456!",
      confirmPassword: "Replacement-password-456!",
    },
  });
  assert.equal(wrongCode.status, 400);
  assert.deepEqual(wrongCode.body.errors, { code: "Verification code is invalid" });

  const originalPassword = await signIn(app.baseUrl, "recovery-invalid-code@example.test", "Valid-password-123!");
  assert.equal(originalPassword.status, 200);
  assert.equal(originalPassword.body.account.username, "recovery-invalid-code");

  const replacementRejected = await signIn(app.baseUrl, "recovery-invalid-code@example.test", "Replacement-password-456!");
  assert.equal(replacementRejected.status, 401);

  const applied = await call(app.baseUrl, "/api/auth/password-reset/confirm", {
    method: "POST",
    body: {
      email: "recovery-success@example.test",
      code: "123456",
      newPassword: "Replacement-password-456!",
      confirmPassword: "Replacement-password-456!",
    },
  });
  assert.equal(applied.status, 200);
  assert.deepEqual(applied.body, { message: "Password updated" });

  const newPassword = await signIn(app.baseUrl, "recovery-success@example.test", "Replacement-password-456!");
  assert.equal(newPassword.status, 200);
  assert.equal(newPassword.body.account.username, "recovery-success");

  const oldPassword = await signIn(app.baseUrl, "recovery-success@example.test", "Valid-password-123!");
  assert.equal(oldPassword.status, 401);
});

test("recovery for an unknown email leaves every account untouched", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.store.read();
  const unknownReset = await call(app.baseUrl, "/api/auth/password-reset/confirm", {
    method: "POST",
    body: {
      email: "unknown@example.test",
      code: "123456",
      newPassword: "Replacement-password-456!",
      confirmPassword: "Replacement-password-456!",
    },
  });
  assert.equal(unknownReset.status, 200);
  const after = await app.store.read();
  assert.deepEqual(after.accounts.map((account) => account.username), before.accounts.map((account) => account.username));
});

test("seed data survives a restart and keeps user changes", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  await call(app.baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      username: "restart-demo",
      email: "restart-demo@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    },
  });
  await call(app.baseUrl, "/api/auth/password-reset/confirm", {
    method: "POST",
    body: {
      email: "recovery-success@example.test",
      code: "123456",
      newPassword: "Replacement-password-456!",
      confirmPassword: "Replacement-password-456!",
    },
  });

  // A brand new store over the same data dir simulates a process restart.
  const restarted = createStateStore({ dataDir: app.dataDir });
  const state = await restarted.read();
  const usernames = state.accounts.map((account) => account.username).sort();
  assert.deepEqual(usernames, [
    "alice-dev",
    "bob-reviewer",
    "existing-member",
    "new-member",
    "org-member",
    "org-owner",
    "password-change-invalid",
    "password-change-required",
    "password-change-success",
    "protected-member",
    "recovery-invalid-code",
    "recovery-success",
    "recovery-visibility",
    "repo-admin",
    "restart-demo",
    "team-maintainer",
  ]);

  const server = createServer((request, response) => {
    void createApp({ store: restarted })(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const seededStillWorks = await signIn(baseUrl, "alice-dev", ALICE.password);
  assert.equal(seededStillWorks.status, 200);

  const newPasswordPersisted = await signIn(baseUrl, "recovery-success@example.test", "Replacement-password-456!");
  assert.equal(newPasswordPersisted.status, 200);
});

test("health, unknown api routes and unknown static paths answer without crashing", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const health = await call(app.baseUrl, "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok: true });

  const apiHealth = await call(app.baseUrl, "/api/health");
  assert.equal(apiHealth.status, 200);
  assert.deepEqual(apiHealth.body, { ok: true });

  const missingApi = await call(app.baseUrl, "/api/does-not-exist");
  assert.equal(missingApi.status, 404);

  const favicon = await call(app.baseUrl, "/favicon.ico");
  assert.equal(favicon.status, 404);

  const stillAlive = await call(app.baseUrl, "/health");
  assert.equal(stillAlive.status, 200);
});

test("sign-out invalidates only the current session", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const first = await signIn(app.baseUrl, ALICE.username, ALICE.password);
  const second = await signIn(app.baseUrl, ALICE.username, ALICE.password);

  const signedOut = await call(app.baseUrl, "/api/auth/signout", { method: "POST", cookie: first.cookie, body: {} });
  assert.equal(signedOut.status, 200);

  const firstSession = await call(app.baseUrl, "/api/auth/session", { cookie: first.cookie });
  assert.equal(firstSession.body.account, null);

  const secondSession = await call(app.baseUrl, "/api/auth/session", { cookie: second.cookie });
  assert.equal(secondSession.body.account.username, "alice-dev");

  // Re-authentication after signing out works again.
  const again = await signIn(app.baseUrl, ALICE.username, ALICE.password);
  assert.equal(again.status, 200);
});

const CHANGE_SUCCESS = "password-change-success";
const CHANGE_INVALID = "password-change-invalid";
const CHANGE_REQUIRED = "password-change-required";

function changePassword(baseUrl, cookie, body) {
  return call(baseUrl, "/api/auth/password", { method: "POST", body, cookie });
}

test("a signed-in account changes its own password and subsequent sign-ins use the new one", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, CHANGE_SUCCESS, "Valid-password-123!");
  assert.equal(session.status, 200);

  const updated = await changePassword(app.baseUrl, session.cookie, {
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body, { message: "Password updated" });

  const withNew = await signIn(app.baseUrl, `${CHANGE_SUCCESS}@example.test`, "New-password-456!");
  assert.equal(withNew.status, 200);
  assert.equal(withNew.body.account.username, CHANGE_SUCCESS);

  const withOld = await signIn(app.baseUrl, CHANGE_SUCCESS, "Valid-password-123!");
  assert.equal(withOld.status, 401);
  assert.deepEqual(withOld.body, { error: "Invalid credentials" });

  // The change is scoped to the signed-in account.
  const other = await signIn(app.baseUrl, ALICE.username, ALICE.password);
  assert.equal(other.status, 200);
  assert.equal(other.body.account.username, "alice-dev");
});

test("a rejected password change reports the reason and keeps the old credentials", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const invalid = await signIn(app.baseUrl, CHANGE_INVALID, "Valid-password-123!");
  const wrongCurrent = await changePassword(app.baseUrl, invalid.cookie, {
    currentPassword: "Valid-password-123!-wrong",
    newPassword: "Another-valid-password-123!",
    confirmPassword: "does-not-match",
  });
  assert.equal(wrongCurrent.status, 400);
  assert.deepEqual(wrongCurrent.body.errors, { currentPassword: "Current password is incorrect" });

  const originalStillWorks = await signIn(app.baseUrl, CHANGE_INVALID, "Valid-password-123!");
  assert.equal(originalStillWorks.status, 200);
  assert.equal(originalStillWorks.body.account.username, CHANGE_INVALID);
  const rejectedCandidate = await signIn(app.baseUrl, CHANGE_INVALID, "Another-valid-password-123!");
  assert.equal(rejectedCandidate.status, 401);

  const required = await signIn(app.baseUrl, CHANGE_REQUIRED, "Valid-password-123!");
  const missingCurrent = await changePassword(app.baseUrl, required.cookie, {
    currentPassword: "",
    newPassword: "Required-password-789!",
    confirmPassword: "Required-password-789!",
  });
  assert.equal(missingCurrent.status, 400);
  assert.deepEqual(missingCurrent.body.errors, { currentPassword: "Current password is required" });

  const afterMissing = await signIn(app.baseUrl, CHANGE_REQUIRED, "Valid-password-123!");
  assert.equal(afterMissing.status, 200);
  const candidateRejected = await signIn(app.baseUrl, CHANGE_REQUIRED, "Required-password-789!");
  assert.equal(candidateRejected.status, 401);

  const misMatch = await changePassword(app.baseUrl, required.cookie, {
    currentPassword: "Valid-password-123!",
    newPassword: "Required-password-789!",
    confirmPassword: "Required-password-789!-other",
  });
  assert.equal(misMatch.status, 400);
  assert.deepEqual(misMatch.body.errors, { confirmPassword: "Password confirmation does not match" });

  const nonCompliant = await changePassword(app.baseUrl, required.cookie, {
    currentPassword: "Valid-password-123!",
    newPassword: "short",
    confirmPassword: "short",
  });
  assert.equal(nonCompliant.status, 400);
  assert.deepEqual(nonCompliant.body.errors, { newPassword: "Password requirements are not satisfied" });

  const stillOriginal = await signIn(app.baseUrl, CHANGE_REQUIRED, "Valid-password-123!");
  assert.equal(stillOriginal.status, 200);
  assert.equal(stillOriginal.body.account.username, CHANGE_REQUIRED);
});

test("a password change without a session is rejected and modifies nothing", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const anonymous = await changePassword(app.baseUrl, null, {
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.equal(anonymous.status, 401);

  const signedOut = await signIn(app.baseUrl, CHANGE_SUCCESS, "Valid-password-123!");
  await call(app.baseUrl, "/api/auth/signout", { method: "POST", cookie: signedOut.cookie, body: {} });
  const afterSignOut = await changePassword(app.baseUrl, signedOut.cookie, {
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.equal(afterSignOut.status, 401);

  const unchanged = await signIn(app.baseUrl, CHANGE_SUCCESS, "Valid-password-123!");
  assert.equal(unchanged.status, 200);
});
