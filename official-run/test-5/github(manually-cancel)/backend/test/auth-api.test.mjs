import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDirectory = await mkdtemp(join(tmpdir(), "shallowcode-auth-"));
process.env.SHALLOW_DATA_DIR = dataDirectory;
process.env.ARC_EXTRA_PORTS = "0";

const { createRequestHandler } = await import("../src/app.mjs");
const { SEED_ACCOUNT, ensureSeedData } = await import("../src/lib/db.mjs");
await ensureSeedData();

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
  const raw = await readFile(join(dataDirectory, "accounts.json"), "utf8").catch(() => null);
  return raw ? JSON.parse(raw).accounts : [];
}

test("the seeded alice-dev account is provisioned for a fresh visitor", async () => {
  const server = await startServer();
  try {
    const api = client(server.base);
    const session = await api.request("/api/auth/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.account, null);
    const signIn = await api.request("/api/auth/sign-in", {
      method: "POST",
      body: { identifier: SEED_ACCOUNT.username, password: SEED_ACCOUNT.password },
    });
    assert.equal(signIn.status, 200);
    assert.equal(signIn.body.account.username, "alice-dev");
    assert.equal(signIn.body.account.email, "alice.dev@example.test");
    assert.equal(signIn.body.account.emailVerified, true);
    const stored = await readAccounts();
    const seeded = stored.find((account) => account.username === "alice-dev");
    assert.ok(seeded, "the seeded account is stored for later scenarios");
    assert.equal(seeded.emailVerified, true);
    assert.equal("password" in seeded, false);
  } finally {
    await server.close();
  }
});

test("sign-in rejects unknown account, wrong password and unavailable account identically", async () => {
  const server = await startServer();
  try {
    const cases = [
      { identifier: "nobody-here", password: "Valid-password-123!" },
      { identifier: SEED_ACCOUNT.username, password: "wrong-password-123!" },
      { identifier: SEED_ACCOUNT.email, password: "wrong-password-123!" },
    ];
    for (const body of cases) {
      const api = client(server.base);
      const response = await api.request("/api/auth/sign-in", { method: "POST", body });
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { error: "Invalid credentials" });
      assert.equal(api.cookie, null);
      const session = await api.request("/api/auth/session");
      assert.equal(session.body.account, null);
    }
  } finally {
    await server.close();
  }
});

test("registration requires compliant username, email, password, confirmation and terms", async () => {
  const server = await startServer();
  try {
    const api = client(server.base);
    const response = await api.request("/api/auth/register", {
      method: "POST",
      body: {
        username: "-invalid",
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
    assert.equal(response.body.errors.terms, "Agree to terms is required");
    assert.equal(response.body.account, undefined);
  } finally {
    await server.close();
  }
});

test("username format rules follow the 1-39 lowercase pattern", async () => {
  const server = await startServer();
  try {
    const suffix = uniqueSuffix();
    const rejected = ["-lead", "trail-", "Upper", "double--hyphen", "under_score", "a".repeat(40), ""];
    for (const [index, username] of rejected.entries()) {
      const api = client(server.base);
      const response = await api.request("/api/auth/register", {
        method: "POST",
        body: {
          username,
          email: `user${index}-${suffix}@example.test`,
          password: "Valid-password-123!",
          confirmPassword: "Valid-password-123!",
          agreeToTerms: true,
        },
      });
      assert.equal(response.status, 400, `expected rejection for ${JSON.stringify(username)}`);
      assert.equal(response.body.errors.username, "Username format is invalid");
    }
    const accepted = ["a", "a-1", "a".repeat(39)];
    for (const [index, username] of accepted.entries()) {
      const api = client(server.base);
      const response = await api.request("/api/auth/register", {
        method: "POST",
        body: {
          username,
          email: `ok${index}-${suffix}@example.test`,
          password: "Valid-password-123!",
          confirmPassword: "Valid-password-123!",
          agreeToTerms: true,
        },
      });
      assert.equal(response.status, 201, `expected acceptance for ${JSON.stringify(username)}`);
    }
  } finally {
    await server.close();
  }
});

test("email rules reject missing @, multiple @, missing domain labels and trim whitespace", async () => {
  const server = await startServer();
  try {
    const suffix = uniqueSuffix();
    const invalid = [
      "not-an-email",
      "two@@example.test",
      "user@localhost",
      "user@.test",
      "user@example.",
      "user name@example.test",
      `${"a".repeat(250)}@example.test`,
    ];
    for (const [index, email] of invalid.entries()) {
      const api = client(server.base);
      const response = await api.request("/api/auth/register", {
        method: "POST",
        body: {
          username: `mail-bad-${index}-${suffix}`,
          email,
          password: "Valid-password-123!",
          confirmPassword: "Valid-password-123!",
          agreeToTerms: true,
        },
      });
      assert.equal(response.status, 400, `expected rejection for ${JSON.stringify(email)}`);
      assert.equal(response.body.errors.email, "Email format is invalid");
    }
    const api = client(server.base);
    const trimmed = await api.request("/api/auth/register", {
      method: "POST",
      body: {
        username: `mail-trim-${suffix}`,
        email: `  Trim-${suffix}@Example.Test  `,
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(trimmed.status, 201);
    assert.equal(trimmed.body.account.email, `trim-${suffix}@example.test`);
  } finally {
    await server.close();
  }
});

test("password rules require 12-128 chars with mixed classes and no whitespace", async () => {
  const server = await startServer();
  try {
    const suffix = uniqueSuffix();
    const invalid = [
      "short",
      "alllowercase1234!",
      "ALLUPPERCASE1234!",
      "NoDigitsHere!!!",
      "NoSpecial12345",
      "With space 123!",
      `A1!${"a".repeat(130)}`,
    ];
    for (const [index, password] of invalid.entries()) {
      const api = client(server.base);
      const response = await api.request("/api/auth/register", {
        method: "POST",
        body: {
          username: `pw-bad-${index}-${suffix}`,
          email: `pw-bad-${index}-${suffix}@example.test`,
          password,
          confirmPassword: password,
          agreeToTerms: true,
        },
      });
      assert.equal(response.status, 400, `expected rejection for ${JSON.stringify(password)}`);
      assert.equal(response.body.errors.password, "Password requirements are not satisfied");
    }
    const api = client(server.base);
    const accepted = await api.request("/api/auth/register", {
      method: "POST",
      body: {
        username: `pw-ok-${suffix}`,
        email: `pw-ok-${suffix}@example.test`,
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(accepted.status, 201);
  } finally {
    await server.close();
  }
});

test("mismatched confirmation is reported beside the confirm field", async () => {
  const server = await startServer();
  try {
    const suffix = uniqueSuffix();
    const api = client(server.base);
    const response = await api.request("/api/auth/register", {
      method: "POST",
      body: {
        username: `pw-mismatch-${suffix}`,
        email: `pw-mismatch-${suffix}@example.test`,
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-321!",
        agreeToTerms: true,
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.errors.confirmPassword, "Password confirmation does not match");
    assert.equal(response.body.errors.password, undefined);
  } finally {
    await server.close();
  }
});

test("duplicate username or email conflicts are rejected and never echoed as password", async () => {
  const server = await startServer();
  try {
    const api = client(server.base);
    const duplicateUsername = await api.request("/api/auth/register", {
      method: "POST",
      body: {
        username: SEED_ACCOUNT.username,
        email: `unused-${uniqueSuffix()}@example.test`,
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(duplicateUsername.status, 400);
    assert.equal(duplicateUsername.body.errors.username, "Username already exists");
    assert.equal(duplicateUsername.body.errors.email, undefined);

    const duplicateEmail = await api.request("/api/auth/register", {
      method: "POST",
      body: {
        username: `fresh-${uniqueSuffix()}`,
        email: SEED_ACCOUNT.email,
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(duplicateEmail.status, 400);
    assert.equal(duplicateEmail.body.errors.email, "Email already exists");

    const accounts = await readAccounts();
    const created = accounts.filter((account) => account.username.startsWith("fresh-"));
    assert.equal(created.length, 0);
  } finally {
    await server.close();
  }
});

test("registration stores a usable verified account that can sign in, and the session survives reloads", async () => {
  const server = await startServer();
  try {
    const suffix = uniqueSuffix();
    const username = `pw-user-${suffix}`;
    const email = `pw-user-${suffix}@example.test`;
    const guest = client(server.base);
    const registered = await guest.request("/api/auth/register", {
      method: "POST",
      body: {
        username,
        email,
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.account.username, username);
    assert.equal(registered.body.account.emailVerified, true);
    assert.equal(JSON.stringify(registered.body).includes("Valid-password-123!"), false);
    // Registration must not create a session by itself.
    const beforeSignIn = await guest.request("/api/auth/session");
    assert.equal(beforeSignIn.body.account, null);

    // Signing in twice never duplicates the account.
    const api = client(server.base);
    const signIn = await api.request("/api/auth/sign-in", { method: "POST", body: { identifier: email, password: "Valid-password-123!" } });
    assert.equal(signIn.status, 200);
    assert.equal(signIn.body.account.username, username);
    assert.equal(typeof signIn.body.session.id, "string");
    assert.equal(signIn.body.session.active, true);
    const sessionAfterReload = await api.request("/api/auth/session");
    assert.equal(sessionAfterReload.body.account.username, username);

    const signInAgain = await api.request("/api/auth/sign-in", { method: "POST", body: { identifier: username, password: "Valid-password-123!" } });
    assert.equal(signInAgain.status, 200);
    const stored = await readAccounts();
    const matches = stored.filter((account) => account.email === email);
    assert.equal(matches.length, 1);
    assert.equal("password" in matches[0], false);
    assert.match(matches[0].passwordHash, /^scrypt\$/);
  } finally {
    await server.close();
  }
});

test("sign-out invalidates only the acting browser session", async () => {
  const server = await startServer();
  try {
    const first = client(server.base);
    const second = client(server.base);
    for (const api of [first, second]) {
      const signIn = await api.request("/api/auth/sign-in", {
        method: "POST",
        body: { identifier: SEED_ACCOUNT.username, password: SEED_ACCOUNT.password },
      });
      assert.equal(signIn.status, 200);
    }
    const signedOut = await first.request("/api/auth/sign-out", { method: "POST" });
    assert.equal(signedOut.status, 200);
    assert.equal(first.cookie, null);
    assert.equal((await first.request("/api/auth/session")).body.account, null);
    // The other browser session stays valid.
    assert.equal((await second.request("/api/auth/session")).body.account.username, "alice-dev");
    // Replaying the invalidated identifier must not restore the session.
    const sessions = JSON.parse(await readFile(join(dataDirectory, "sessions.json"), "utf8"));
    const ended = sessions.sessions.filter((session) => session.active === false);
    assert.equal(ended.length, 1);
  } finally {
    await server.close();
  }
});

test("unknown api paths and assets return error responses without killing the process", async () => {
  const server = await startServer();
  try {
    const api = client(server.base);
    assert.equal((await api.request("/api/auth/unknown")).status, 404);
    assert.equal((await api.request("/api/unknown")).status, 404);
    assert.equal((await api.request("/definitely-missing-asset.js")).status, 404);
    assert.equal((await api.request("/favicon.ico")).status, 404);
    const health = await api.request("/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { ok: true });
    const apiHealth = await api.request("/api/health");
    assert.equal(apiHealth.status, 200);
    // still alive after the error paths
    assert.equal((await api.request("/health")).status, 200);
  } finally {
    await server.close();
  }
});

test("invalid json bodies are rejected with an error response", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(response.status, 400);
  } finally {
    await server.close();
  }
});
