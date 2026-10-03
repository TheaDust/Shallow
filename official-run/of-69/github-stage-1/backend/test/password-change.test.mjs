import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

const ORIGINAL_PASSWORD = "Valid-password-123!";

async function startServer() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallow-password-"));
  const handler = await createRequestHandler({ dataDir, staticRoot: dataDir });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function post(baseUrl, path, body, cookies = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookies ? { cookie: cookies } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, payload: text ? JSON.parse(text) : null, setCookie: response.headers.get("set-cookie") };
}

function cookieOf(setCookie) {
  return setCookie ? setCookie.split(";")[0] : "";
}

async function signIn(baseUrl, identifier, password) {
  const response = await post(baseUrl, "/api/signin", { identifier, password });
  return { status: response.status, payload: response.payload, cookie: cookieOf(response.setCookie) };
}

test("scenario 1: a successful update switches the password used for sign-in", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, "password-change-success", ORIGINAL_PASSWORD);
  assert.equal(session.status, 200);

  const updated = await post(
    app.baseUrl,
    "/api/account/password",
    {
      currentPassword: ORIGINAL_PASSWORD,
      newPassword: "New-password-456!",
      confirmPassword: "New-password-456!",
    },
    session.cookie,
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.message, "Password updated");

  const withNew = await signIn(app.baseUrl, "password-change-success@example.test", "New-password-456!");
  assert.equal(withNew.status, 200);
  assert.equal(withNew.payload.account.username, "password-change-success");

  const withOld = await signIn(app.baseUrl, "password-change-success@example.test", ORIGINAL_PASSWORD);
  assert.equal(withOld.status, 401);
  assert.equal(withOld.payload.error, "Invalid credentials");
});

test("scenario 1: the session cookie stays usable and only this account changes", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, "password-change-success", ORIGINAL_PASSWORD);
  await post(
    app.baseUrl,
    "/api/account/password",
    { currentPassword: ORIGINAL_PASSWORD, newPassword: "New-password-456!", confirmPassword: "New-password-456!" },
    session.cookie,
  );

  const current = await fetch(`${app.baseUrl}/api/session`, { headers: { cookie: session.cookie } });
  assert.equal((await current.json()).account.username, "password-change-success");

  // Unrelated accounts and their passwords are untouched.
  for (const [username, email] of [
    ["password-change-invalid", "password-change-invalid@example.test"],
    ["password-change-required", "password-change-required@example.test"],
    ["alice-dev", "alice.dev@example.test"],
  ]) {
    const other = await signIn(app.baseUrl, email, ORIGINAL_PASSWORD);
    assert.equal(other.status, 200);
    assert.equal(other.payload.account.username, username);
  }
});

test("scenario 2: a wrong current password and a mismatched confirmation are both reported", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, "password-change-invalid", ORIGINAL_PASSWORD);
  const rejected = await post(
    app.baseUrl,
    "/api/account/password",
    {
      currentPassword: "Valid-password-123!-wrong",
      newPassword: "Another-valid-password-123!",
      confirmPassword: "does-not-match",
    },
    session.cookie,
  );
  assert.equal(rejected.status, 422);
  assert.equal(rejected.payload.errors.currentPassword, "Current password is incorrect");
  assert.equal(rejected.payload.errors.confirmPassword, "Password confirmation does not match");

  const withOriginal = await signIn(app.baseUrl, "password-change-invalid@example.test", ORIGINAL_PASSWORD);
  assert.equal(withOriginal.status, 200);
  assert.equal(withOriginal.payload.account.username, "password-change-invalid");

  const withCandidate = await signIn(app.baseUrl, "password-change-invalid@example.test", "Another-valid-password-123!");
  assert.equal(withCandidate.status, 401);
});

test("scenario 3: an empty current password reports the required message and changes nothing", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, "password-change-required", ORIGINAL_PASSWORD);
  const rejected = await post(
    app.baseUrl,
    "/api/account/password",
    { currentPassword: "", newPassword: "Required-password-789!", confirmPassword: "Required-password-789!" },
    session.cookie,
  );
  assert.equal(rejected.status, 422);
  assert.equal(rejected.payload.errors.currentPassword, "Current password is required");

  const withOriginal = await signIn(app.baseUrl, "password-change-required@example.test", ORIGINAL_PASSWORD);
  assert.equal(withOriginal.status, 200);
  assert.equal(withOriginal.payload.account.username, "password-change-required");

  const withCandidate = await signIn(app.baseUrl, "password-change-required@example.test", "Required-password-789!");
  assert.equal(withCandidate.status, 401);
});

test("a noncompliant new password is rejected in its own field", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const session = await signIn(app.baseUrl, "password-change-success", ORIGINAL_PASSWORD);
  const rejected = await post(
    app.baseUrl,
    "/api/account/password",
    { currentPassword: ORIGINAL_PASSWORD, newPassword: "short", confirmPassword: "short" },
    session.cookie,
  );
  assert.equal(rejected.status, 422);
  assert.equal(rejected.payload.errors.newPassword, "Password requirements are not satisfied");

  const withOriginal = await signIn(app.baseUrl, "password-change-success@example.test", ORIGINAL_PASSWORD);
  assert.equal(withOriginal.status, 200);
});

test("an unauthenticated request cannot change any password", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const rejected = await post(app.baseUrl, "/api/account/password", {
    currentPassword: ORIGINAL_PASSWORD,
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.equal(rejected.status, 401);

  const signedIn = await signIn(app.baseUrl, "password-change-success@example.test", ORIGINAL_PASSWORD);
  assert.equal(signedIn.status, 200);
});

test("the new password survives a restart of the same data directory", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallow-password-restart-"));
  const handler = await createRequestHandler({ dataDir, staticRoot: dataDir });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => new Promise((resolve) => server.close(resolve)));

  const session = await signIn(baseUrl, "password-change-success", ORIGINAL_PASSWORD);
  await post(
    baseUrl,
    "/api/account/password",
    { currentPassword: ORIGINAL_PASSWORD, newPassword: "New-password-456!", confirmPassword: "New-password-456!" },
    session.cookie,
  );
  await new Promise((resolve) => server.close(resolve));

  const secondHandler = await createRequestHandler({ dataDir, staticRoot: dataDir });
  const secondServer = createServer((request, response) => void secondHandler(request, response));
  await new Promise((resolve) => secondServer.listen(0, "127.0.0.1", resolve));
  t.after(async () => new Promise((resolve) => secondServer.close(resolve)));
  const secondBase = `http://127.0.0.1:${secondServer.address().port}`;

  const withNew = await signIn(secondBase, "password-change-success@example.test", "New-password-456!");
  assert.equal(withNew.status, 200);
  assert.equal(withNew.payload.account.username, "password-change-success");
});
