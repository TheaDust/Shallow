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
  return mkdtemp(join(tmpdir(), "shallowcode-accounts-"));
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

test("seed account can sign in by username and by email and keeps the session", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  for (const identifier of ["alice-dev", "alice.dev@example.test"]) {
    const response = await jsonRequest(app.baseUrl, "/api/sessions", {
      method: "POST",
      body: { identifier, password: "Valid-password-123!" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.account.username, "alice-dev");
    assert.equal(body.account.email, "alice.dev@example.test");
    assert.equal(body.account.emailVerified, true);
    assert.ok(!JSON.stringify(body).includes("Valid-password-123!"));

    const cookie = sessionCookieFrom(response);
    const sessionResponse = await jsonRequest(app.baseUrl, "/api/session", { cookie });
    const session = await sessionResponse.json();
    assert.equal(session.account.username, "alice-dev");
  }

  const anonymous = await jsonRequest(app.baseUrl, "/api/session");
  assert.deepEqual(await anonymous.json(), { account: null });
});

test("failed authentication always reports the same generic message", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const attempts = [
    { identifier: "alice-dev", password: "wrong-password-123!" },
    { identifier: "unknown-user", password: "Valid-password-123!" },
    { identifier: "unknown@example.test", password: "Valid-password-123!" },
    { identifier: "", password: "" },
  ];
  for (const attempt of attempts) {
    const response = await jsonRequest(app.baseUrl, "/api/sessions", { method: "POST", body: attempt });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid credentials" });
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("registration creates a sign-in-capable verified account", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const payload = {
    username: "pw-user-1234",
    email: "pw-user-1234@example.test",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    termsAccepted: true,
  };
  const created = await jsonRequest(app.baseUrl, "/api/accounts", { method: "POST", body: payload });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.account.username, "pw-user-1234");
  assert.equal(createdBody.account.emailVerified, true);
  assert.equal(createdBody.account.email, "pw-user-1234@example.test");
  assert.ok(!JSON.stringify(createdBody).includes("Valid-password-123!"));

  const signedIn = await jsonRequest(app.baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier: "pw-user-1234@example.test", password: "Valid-password-123!" },
  });
  assert.equal(signedIn.status, 200);

  const persisted = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  assert.equal(persisted.accounts.length, SEED_ACCOUNT_COUNT + 1);
  assert.ok(!JSON.stringify(persisted).includes("Valid-password-123!"));
});

test("registration reports conflicts and keeps the stored accounts unchanged", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const duplicateUsername = await jsonRequest(app.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "alice-dev",
      email: "alice.unused@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(duplicateUsername.status, 400);
  assert.equal((await duplicateUsername.json()).fields.username, "Username already exists");

  const duplicateEmail = await jsonRequest(app.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "brand-new-user",
      email: "alice.dev@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(duplicateEmail.status, 400);
  assert.equal((await duplicateEmail.json()).fields.email, "Email already exists");

  const multiple = await jsonRequest(app.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "-bad",
      email: "not-an-email",
      password: "short",
      confirmPassword: "different",
      termsAccepted: false,
    },
  });
  assert.equal(multiple.status, 400);
  const fields = (await multiple.json()).fields;
  assert.deepEqual(Object.keys(fields).sort(), ["confirmPassword", "email", "password", "terms", "username"]);

  const signInAttempt = await jsonRequest(app.baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier: "alice.unused@example.test", password: "Valid-password-123!" },
  });
  assert.equal(signInAttempt.status, 401);

  const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  assert.equal(state.accounts.length, SEED_ACCOUNT_COUNT);
});

test("sign-out immediately invalidates the session", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const signIn = await jsonRequest(app.baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier: "alice-dev", password: "Valid-password-123!" },
  });
  const cookie = sessionCookieFrom(signIn);

  const signOut = await jsonRequest(app.baseUrl, "/api/sessions/current", { method: "DELETE", cookie });
  assert.equal(signOut.status, 200);

  const after = await jsonRequest(app.baseUrl, "/api/session", { cookie });
  assert.deepEqual(await after.json(), { account: null });

  const state = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  assert.equal(state.sessions.every((session) => session.active === false), true);
});

test("sessions and accounts survive a restart on the same data directory", async (t) => {
  const dataDir = await newDataDir();
  const first = await startApp(dataDir);
  const registration = await jsonRequest(first.baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username: "restart-user",
      email: "restart-user@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(registration.status, 201);
  const cookie = sessionCookieFrom(await jsonRequest(first.baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier: "restart-user", password: "Valid-password-123!" },
  }));
  await first.close();

  const second = await startApp(dataDir);
  t.after(() => second.close());
  const session = await jsonRequest(second.baseUrl, "/api/session", { cookie });
  assert.equal((await session.json()).account.username, "restart-user");
});

test("health, unknown paths and static hosting follow the platform contract", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  for (const path of ["/health", "/api/health"]) {
    const response = await jsonRequest(app.baseUrl, path);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }

  for (const path of ["/api/unknown", "/missing.js", "/favicon.ico"]) {
    const response = await jsonRequest(app.baseUrl, path);
    assert.equal(response.status, 404);
  }
  const afterNotFound = await jsonRequest(app.baseUrl, "/health");
  assert.equal(afterNotFound.status, 200);
});
