import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createInitialState } from "../src/seed.mjs";

/** Seeded accounts are compatibility-stable; later packages add more. */
const SEED_ACCOUNT_COUNT = createInitialState().accounts.length;

async function startApp(dataDir) {
  const handler = createApp({ dataDir, staticRoot: join(dataDir, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function newDataDir() {
  return mkdtemp(join(tmpdir(), "shallowcode-passwords-"));
}

function jsonRequest(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sessionCookieFrom(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "expected a session cookie");
  return header.split(";")[0];
}

async function signIn(baseUrl, identifier, password) {
  return jsonRequest(baseUrl, "/api/sessions", { method: "POST", body: { identifier, password } });
}

async function requestReset(baseUrl, email) {
  return jsonRequest(baseUrl, "/api/password-recovery/requests", { method: "POST", body: { email } });
}

function reset(baseUrl, body) {
  return jsonRequest(baseUrl, "/api/password-recovery", { method: "POST", body });
}

test("recovery request answers identically for a registered and an unknown email", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const known = await requestReset(app.baseUrl, "alice.dev@example.test");
  const unknown = await requestReset(app.baseUrl, "nobody@example.test");
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(await known.json(), { code: "123456" });
  assert.deepEqual(await unknown.json(), { code: "123456" });

  // Requesting a code writes nothing at all: no account, no session, no recovery record.
  await assert.rejects(readFile(join(dataDir, "state.json"), "utf8"), { code: "ENOENT" });
  assert.equal((await signIn(app.baseUrl, "alice-dev", "Valid-password-123!")).status, 200);
  const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  assert.equal(state.accounts.length, SEED_ACCOUNT_COUNT);
});

test("a registered email with the fixed code updates that account's password only", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const registration = await jsonRequest(app.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "recovery-neighbour",
      email: "recovery-neighbour@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(registration.status, 201);

  const oldSession = sessionCookieFrom(await signIn(app.baseUrl, "alice-dev", "Valid-password-123!"));
  const response = await reset(app.baseUrl, {
    email: "alice.dev@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  assert.equal((await signIn(app.baseUrl, "alice-dev", "Valid-password-123!")).status, 401);
  assert.equal((await signIn(app.baseUrl, "alice.dev@example.test", "Replacement-password-456!")).status, 200);
  // The recovered account loses its earlier sessions.
  const stale = await jsonRequest(app.baseUrl, "/api/session", { cookie: oldSession });
  assert.deepEqual(await stale.json(), { account: null });
  // Other accounts keep their credentials.
  assert.equal((await signIn(app.baseUrl, "recovery-neighbour", "Valid-password-123!")).status, 200);

  const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  assert.equal(state.accounts.length, SEED_ACCOUNT_COUNT + 1);
  assert.ok(!JSON.stringify(state).includes("Replacement-password-456!"));
});

test("recovery failures report the reason and change nothing", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const wrongCode = await reset(app.baseUrl, {
    email: "alice.dev@example.test",
    code: "000000",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(wrongCode.status, 400);
  assert.equal((await wrongCode.json()).fields.verificationCode, "Verification code is invalid");

  const weakPassword = await reset(app.baseUrl, {
    email: "alice.dev@example.test",
    code: "123456",
    newPassword: "short",
    confirmPassword: "short",
  });
  assert.equal(weakPassword.status, 400);
  assert.equal((await weakPassword.json()).fields.newPassword, "Password requirements are not satisfied");

  const mismatch = await reset(app.baseUrl, {
    email: "alice.dev@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-457!",
  });
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).fields.confirmPassword, "Passwords do not match");

  const unknownEmail = await reset(app.baseUrl, {
    email: "nobody@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(unknownEmail.status, 400);
  assert.deepEqual((await unknownEmail.json()).fields, {});

  assert.equal((await signIn(app.baseUrl, "alice-dev", "Valid-password-123!")).status, 200);
  assert.equal((await signIn(app.baseUrl, "alice-dev", "Replacement-password-456!")).status, 401);

  const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  assert.equal(state.accounts.length, SEED_ACCOUNT_COUNT);
  assert.equal(state.accounts[0].username, "alice-dev");
  assert.equal(state.accounts[0].email, "alice.dev@example.test");
});

test("changing a password requires the session and the current password", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const anonymous = await jsonRequest(app.baseUrl, "/api/account/password", {
    method: "POST",
    body: { currentPassword: "Valid-password-123!", newPassword: "New-password-456!", confirmPassword: "New-password-456!" },
  });
  assert.equal(anonymous.status, 401);

  const cookie = sessionCookieFrom(await signIn(app.baseUrl, "alice-dev", "Valid-password-123!"));

  const empty = await jsonRequest(app.baseUrl, "/api/account/password", {
    method: "POST",
    cookie,
    body: { currentPassword: "", newPassword: "New-password-456!", confirmPassword: "New-password-456!" },
  });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).fields.currentPassword, "Current password is required");

  const wrongCurrent = await jsonRequest(app.baseUrl, "/api/account/password", {
    method: "POST",
    cookie,
    body: { currentPassword: "Wrong-password-123!", newPassword: "New-password-456!", confirmPassword: "does-not-match" },
  });
  assert.equal(wrongCurrent.status, 400);
  const wrongFields = (await wrongCurrent.json()).fields;
  assert.equal(wrongFields.currentPassword, "Current password is incorrect");
  assert.equal(wrongFields.confirmPassword, "Password confirmation does not match");

  const weak = await jsonRequest(app.baseUrl, "/api/account/password", {
    method: "POST",
    cookie,
    body: { currentPassword: "Valid-password-123!", newPassword: "short", confirmPassword: "short" },
  });
  assert.equal(weak.status, 400);
  assert.equal((await weak.json()).fields.newPassword, "Password requirements are not satisfied");

  assert.equal((await signIn(app.baseUrl, "alice-dev", "Valid-password-123!")).status, 200);
  assert.equal((await signIn(app.baseUrl, "alice-dev", "New-password-456!")).status, 401);
});

test("a successful password change applies to the next sign-in only for that account", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const registration = await jsonRequest(app.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "second-account",
      email: "second-account@example.test",
      password: "Required-password-789!",
      confirmPassword: "Required-password-789!",
      termsAccepted: true,
    },
  });
  assert.equal(registration.status, 201);

  const otherSession = sessionCookieFrom(await signIn(app.baseUrl, "second-account", "Required-password-789!"));
  const cookie = sessionCookieFrom(await signIn(app.baseUrl, "alice-dev", "Valid-password-123!"));

  const response = await jsonRequest(app.baseUrl, "/api/account/password", {
    method: "POST",
    cookie,
    body: {
      currentPassword: "Valid-password-123!",
      newPassword: "New-password-456!",
      confirmPassword: "New-password-456!",
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  // The current session survives, and the new password works immediately.
  const current = await jsonRequest(app.baseUrl, "/api/session", { cookie });
  assert.equal((await current.json()).account.username, "alice-dev");
  assert.equal((await signIn(app.baseUrl, "alice-dev", "New-password-456!")).status, 200);
  assert.equal((await signIn(app.baseUrl, "alice-dev", "Valid-password-123!")).status, 401);

  // The other account is untouched.
  assert.equal((await signIn(app.baseUrl, "second-account", "Required-password-789!")).status, 200);
  const other = await jsonRequest(app.baseUrl, "/api/session", { cookie: otherSession });
  assert.equal((await other.json()).account.username, "second-account");

  const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  assert.ok(!JSON.stringify(state).includes("New-password-456!"));
});
