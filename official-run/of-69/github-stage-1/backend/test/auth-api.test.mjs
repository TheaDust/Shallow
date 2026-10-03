import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

async function startServer() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallow-auth-"));
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
  const payload = text ? JSON.parse(text) : null;
  return { status: response.status, payload, setCookie: response.headers.get("set-cookie") };
}

function cookieOf(setCookie) {
  return setCookie ? setCookie.split(";")[0] : "";
}

test("registration errors are itemized and retain nothing sensitive", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await post(app.baseUrl, "/api/register", {
    username: "-invalid-demo",
    email: "not-an-email",
    password: "short",
    confirmPassword: "different",
    agreeToTerms: false,
  });
  assert.equal(response.status, 422);
  assert.equal(response.payload.errors.username, "Username format is invalid");
  assert.equal(response.payload.errors.email, "Email format is invalid");
  assert.equal(response.payload.errors.password, "Password requirements are not satisfied");
  assert.equal(response.payload.errors.terms, "Agree to terms is required");
});

test("registration rejects a duplicate username while keeping the new email", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await post(app.baseUrl, "/api/register", {
    username: "alice-dev",
    email: "unused-address@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.equal(response.status, 422);
  assert.equal(response.payload.errors.username, "Username already exists");
  assert.equal(response.payload.errors.email, undefined);
});

test("registration creates a sign-in capable account that survives a fresh request", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const created = await post(app.baseUrl, "/api/register", {
    username: "nora-demo",
    email: "nora.demo@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });
  assert.equal(created.status, 201);

  const signedIn = await post(app.baseUrl, "/api/signin", {
    identifier: "nora.demo@example.test",
    password: "Valid-password-123!",
  });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.payload.account.username, "nora-demo");

  const session = await fetch(`${app.baseUrl}/api/session`, {
    headers: { cookie: cookieOf(signedIn.setCookie) },
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).account.username, "nora-demo");
});

test("sign-in uses one generic failure message for unknown and wrong credentials", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  for (const body of [
    { identifier: "unknown@example.test", password: "Valid-password-123!" },
    { identifier: "alice-dev", password: "Valid-password-123!-wrong" },
    { identifier: "alice.dev@example.test", password: "Valid-password-123!-incorrect" },
  ]) {
    const response = await post(app.baseUrl, "/api/signin", body);
    assert.equal(response.status, 401);
    assert.equal(response.payload.error, "Invalid credentials");
  }
});

test("seed account alice-dev signs in by username and by email", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const byUsername = await post(app.baseUrl, "/api/signin", {
    identifier: "alice-dev",
    password: "Valid-password-123!",
  });
  assert.equal(byUsername.status, 200);
  assert.equal(byUsername.payload.account.username, "alice-dev");

  const byEmail = await post(app.baseUrl, "/api/signin", {
    identifier: "alice.dev@example.test",
    password: "Valid-password-123!",
  });
  assert.equal(byEmail.status, 200);
});

test("recovery reaches the reset step for known and unknown addresses", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  for (const email of ["recovery-visibility@example.test", "unknown@example.test"]) {
    const response = await post(app.baseUrl, "/api/recovery/start", { email });
    assert.equal(response.status, 200);
    assert.equal(response.payload.code, "123456");
  }
});

test("a wrong recovery code keeps the original password usable", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const reset = await post(app.baseUrl, "/api/recovery/reset", {
    email: "recovery-invalid-code@example.test",
    code: "000000",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(reset.status, 400);
  assert.equal(reset.payload.error, "Verification code is invalid");

  const signIn = await post(app.baseUrl, "/api/signin", {
    identifier: "recovery-invalid-code@example.test",
    password: "Valid-password-123!",
  });
  assert.equal(signIn.status, 200);
  assert.equal(signIn.payload.account.username, "recovery-invalid-code");
});

test("a correct recovery code replaces the password for the same account", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const reset = await post(app.baseUrl, "/api/recovery/reset", {
    email: "recovery-success@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.payload.message, "Password updated");

  const withNew = await post(app.baseUrl, "/api/signin", {
    identifier: "recovery-success@example.test",
    password: "Replacement-password-456!",
  });
  assert.equal(withNew.status, 200);
  assert.equal(withNew.payload.account.username, "recovery-success");

  const withOld = await post(app.baseUrl, "/api/signin", {
    identifier: "recovery-success@example.test",
    password: "Valid-password-123!",
  });
  assert.equal(withOld.status, 401);
});

test("sign-out invalidates only the current session", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const signIn = await post(app.baseUrl, "/api/signin", {
    identifier: "alice-dev",
    password: "Valid-password-123!",
  });
  const cookie = cookieOf(signIn.setCookie);

  const before = await fetch(`${app.baseUrl}/api/session`, { headers: { cookie } });
  assert.equal((await before.json()).account.username, "alice-dev");

  const signOut = await post(app.baseUrl, "/api/signout", {}, cookie);
  assert.equal(signOut.status, 204);

  const after = await fetch(`${app.baseUrl}/api/session`, { headers: { cookie } });
  assert.equal((await after.json()).account, null);

  // A second, separate session for the same account stays valid.
  const second = await post(app.baseUrl, "/api/signin", {
    identifier: "alice-dev",
    password: "Valid-password-123!",
  });
  const secondCookie = cookieOf(second.setCookie);
  assert.notEqual(secondCookie, cookie);
  const secondSession = await fetch(`${app.baseUrl}/api/session`, { headers: { cookie: secondCookie } });
  assert.equal((await secondSession.json()).account.username, "alice-dev");
});

test("data persists across restarts of the same directory", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallow-restart-"));
  const handler = await createRequestHandler({ dataDir, staticRoot: dataDir });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => new Promise((resolve) => server.close(resolve)));

  await post(baseUrl, "/api/register", {
    username: "persist-demo",
    email: "persist-demo@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });

  const secondHandler = await createRequestHandler({ dataDir, staticRoot: dataDir });
  const secondServer = createServer((request, response) => void secondHandler(request, response));
  await new Promise((resolve) => secondServer.listen(0, "127.0.0.1", resolve));
  t.after(async () => new Promise((resolve) => secondServer.close(resolve)));
  const secondBase = `http://127.0.0.1:${secondServer.address().port}`;

  const signIn = await post(secondBase, "/api/signin", {
    identifier: "persist-demo@example.test",
    password: "Valid-password-123!",
  });
  assert.equal(signIn.status, 200);
  assert.equal(signIn.payload.account.username, "persist-demo");
});
