import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDirectory = await mkdtemp(join(tmpdir(), "shallowcode-password-"));
process.env.SHALLOW_DATA_DIR = dataDirectory;
process.env.ARC_EXTRA_PORTS = "0";

const { createRequestHandler } = await import("../src/app.mjs");
const { SEED_ACCOUNT, ensureSeedData } = await import("../src/lib/db.mjs");
await ensureSeedData();

const OLD_PASSWORD = SEED_ACCOUNT.password; // "Valid-password-123!"
const NEW_PASSWORD = "New-password-456!";
const REPLACEMENT_PASSWORD = "Replacement-password-456!";

async function startServer() {
  const server = createServer(createRequestHandler());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function client(base) {
  let cookie = null;
  return {
    get cookie() {
      return cookie;
    },
    async request(path, { method = "GET", body } = {}) {
      const headers = {};
      if (body !== undefined) headers["content-type"] = "application/json";
      if (cookie) headers.cookie = cookie;
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        const [pair] = setCookie.split(";");
        cookie = pair.endsWith("=") ? null : pair;
      }
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
  };
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function readAccounts() {
  const raw = await readFile(join(dataDirectory, "accounts.json"), "utf8");
  return JSON.parse(raw).accounts;
}

async function registerAccount(base, { password = OLD_PASSWORD } = {}) {
  const suffix = uniqueSuffix();
  const api = client(base);
  const response = await api.request("/api/auth/register", {
    method: "POST",
    body: {
      username: `pw-${suffix}`,
      email: `pw-${suffix}@example.test`,
      password,
      confirmPassword: password,
      agreeToTerms: true,
    },
  });
  assert.equal(response.status, 201);
  return { api, account: response.body.account };
}

async function canSignIn(base, identifier, password) {
  const api = client(base);
  const response = await api.request("/api/auth/sign-in", {
    method: "POST",
    body: { identifier, password },
  });
  return response.status === 200;
}

// ---------------------------------------------------------------- REQ-1-3

test("changing a password requires an authenticated session", async () => {
  const server = await startServer();
  try {
    const anonymous = client(server.base);
    const response = await anonymous.request("/api/auth/password", {
      method: "POST",
      body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
    });
    assert.equal(response.status, 401);
    assert.equal(await canSignIn(server.base, SEED_ACCOUNT.username, OLD_PASSWORD), true);
  } finally {
    await server.close();
  }
});

test("an empty or incorrect current password and a mismatched confirmation are reported without changing credentials", async () => {
  const server = await startServer();
  try {
    const { api, account } = await registerAccount(server.base);
    await api.request("/api/auth/sign-in", {
      method: "POST",
      body: { identifier: account.username, password: OLD_PASSWORD },
    });

    const missing = await api.request("/api/auth/password", {
      method: "POST",
      body: { currentPassword: "", newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.errors.currentPassword, "Current password is required");
    assert.equal(missing.body.errors.newPassword, undefined);

    const rejected = await api.request("/api/auth/password", {
      method: "POST",
      body: { currentPassword: "Wrong-password-000!", newPassword: NEW_PASSWORD, confirmPassword: "does-not-match" },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.errors.currentPassword, "Current password is incorrect");
    assert.equal(rejected.body.errors.confirmPassword, "Password confirmation does not match");

    assert.equal(await canSignIn(server.base, account.username, OLD_PASSWORD), true);
    assert.equal(await canSignIn(server.base, account.username, NEW_PASSWORD), false);
  } finally {
    await server.close();
  }
});

test("a noncompliant new password or mismatched confirmation is rejected and leaves the credentials unchanged", async () => {
  const server = await startServer();
  try {
    const { api, account } = await registerAccount(server.base);
    await api.request("/api/auth/sign-in", {
      method: "POST",
      body: { identifier: account.username, password: OLD_PASSWORD },
    });

    const noncompliant = await api.request("/api/auth/password", {
      method: "POST",
      body: { currentPassword: OLD_PASSWORD, newPassword: "short", confirmPassword: "short" },
    });
    assert.equal(noncompliant.status, 400);
    assert.equal(noncompliant.body.errors.newPassword, "Password requirements are not satisfied");

    const mismatch = await api.request("/api/auth/password", {
      method: "POST",
      body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: `${NEW_PASSWORD}x` },
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.errors.confirmPassword, "Password confirmation does not match");
    assert.equal(mismatch.body.errors.newPassword, undefined);

    assert.equal(await canSignIn(server.base, account.username, OLD_PASSWORD), true);
    assert.equal(await canSignIn(server.base, account.username, NEW_PASSWORD), false);
  } finally {
    await server.close();
  }
});

test("a successful change applies to the signed-in account only and keeps the session usable", async () => {
  const server = await startServer();
  try {
    const { api, account } = await registerAccount(server.base);
    const { account: other } = await registerAccount(server.base);
    await api.request("/api/auth/sign-in", {
      method: "POST",
      body: { identifier: account.username, password: OLD_PASSWORD },
    });

    const changed = await api.request("/api/auth/password", {
      method: "POST",
      body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.body, { ok: true });

    // The acting browser session stays valid so the user can still sign out.
    const session = await api.request("/api/auth/session");
    assert.equal(session.body.account.username, account.username);

    assert.equal(await canSignIn(server.base, account.username, NEW_PASSWORD), true);
    assert.equal(await canSignIn(server.base, account.username, OLD_PASSWORD), false);
    assert.equal(await canSignIn(server.base, account.email, NEW_PASSWORD), true);
    // No other account is touched.
    assert.equal(await canSignIn(server.base, other.username, OLD_PASSWORD), true);
    assert.equal(await canSignIn(server.base, other.username, NEW_PASSWORD), false);
  } finally {
    await server.close();
  }
});

// ----------------------------------------------------------- REQ-1-1-3

test("reset rejects a wrong verification code, an unknown email, a noncompliant password and a mismatch", async () => {
  const server = await startServer();
  try {
    const accountsBefore = await readAccounts();

    const wrongCode = await client(server.base).request("/api/auth/password-reset", {
      method: "POST",
      body: {
        email: SEED_ACCOUNT.email,
        code: "000000",
        newPassword: REPLACEMENT_PASSWORD,
        confirmPassword: REPLACEMENT_PASSWORD,
      },
    });
    assert.equal(wrongCode.status, 400);
    assert.equal(wrongCode.body.errors.code, "Verification code is invalid");
    assert.equal(wrongCode.body.errors.email, undefined);

    const unknownEmail = await client(server.base).request("/api/auth/password-reset", {
      method: "POST",
      body: {
        email: `nobody-${uniqueSuffix()}@example.test`,
        code: "123456",
        newPassword: REPLACEMENT_PASSWORD,
        confirmPassword: REPLACEMENT_PASSWORD,
      },
    });
    assert.equal(unknownEmail.status, 400);
    assert.equal(unknownEmail.body.errors.email, "Email is not registered");
    assert.equal(unknownEmail.body.errors.code, undefined);

    const noncompliant = await client(server.base).request("/api/auth/password-reset", {
      method: "POST",
      body: {
        email: SEED_ACCOUNT.email,
        code: "123456",
        newPassword: "short",
        confirmPassword: "short",
      },
    });
    assert.equal(noncompliant.status, 400);
    assert.equal(noncompliant.body.errors.newPassword, "Password requirements are not satisfied");

    const mismatch = await client(server.base).request("/api/auth/password-reset", {
      method: "POST",
      body: {
        email: SEED_ACCOUNT.email,
        code: "123456",
        newPassword: REPLACEMENT_PASSWORD,
        confirmPassword: "Replacement-password-456?",
      },
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.errors.confirmPassword, "Password confirmation does not match");

    // Nothing was modified and no extra account appeared.
    assert.equal(await canSignIn(server.base, SEED_ACCOUNT.username, OLD_PASSWORD), true);
    assert.equal(await canSignIn(server.base, SEED_ACCOUNT.username, REPLACEMENT_PASSWORD), false);
    assert.deepEqual(await readAccounts(), accountsBefore);
  } finally {
    await server.close();
  }
});

test("a reset with the fixed code creates no session and is applied atomically for the registered email", async () => {
  const server = await startServer();
  try {
    const { account } = await registerAccount(server.base);
    const api = client(server.base);

    const success = await api.request("/api/auth/password-reset", {
      method: "POST",
      body: {
        email: account.email,
        code: "123456",
        newPassword: REPLACEMENT_PASSWORD,
        confirmPassword: REPLACEMENT_PASSWORD,
      },
    });
    assert.equal(success.status, 200);
    assert.deepEqual(success.body, { ok: true });
    // Recovery never signs the visitor in.
    assert.equal(success.body.session, undefined);
    assert.equal((await api.request("/api/auth/session")).body.account, null);

    assert.equal(await canSignIn(server.base, account.email, REPLACEMENT_PASSWORD), true);
    assert.equal(await canSignIn(server.base, account.username, OLD_PASSWORD), false);
    assert.equal(await canSignIn(server.base, account.username, REPLACEMENT_PASSWORD), true);
  } finally {
    await server.close();
  }
});

test("replaying the reset endpoint for the seeded account changes no counts and retires the old password", async () => {
  const server = await startServer();
  try {
    const before = await readAccounts();
    const success = await client(server.base).request("/api/auth/password-reset", {
      method: "POST",
      body: {
        email: SEED_ACCOUNT.email,
        code: "123456",
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
    });
    assert.equal(success.status, 200);

    const accounts = await readAccounts();
    assert.equal(accounts.length, before.length);
    const seeded = accounts.find((account) => account.username === SEED_ACCOUNT.username);
    assert.ok(seeded);
    assert.match(seeded.passwordHash, /^scrypt\$/);

    assert.equal(await canSignIn(server.base, SEED_ACCOUNT.email, NEW_PASSWORD), true);
    assert.equal(await canSignIn(server.base, SEED_ACCOUNT.email, OLD_PASSWORD), false);
  } finally {
    await server.close();
  }
});
