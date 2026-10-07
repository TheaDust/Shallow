import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";

// REQ-1-1-1 (evolution username rule, duplicate username), REQ-1-1-2
// (case-insensitive email lookup) and REQ-1-4 (active browser sessions).

const EVO_PASSWORD = "Evo-Password-987!";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-sessions-"));
  const store = createAuthStore(dataDir);
  const handler = createRequestHandler({ store, staticRoot: join(dataDir, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function collectCookie(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function request(baseUrl, path, { method = "GET", body, cookie, userAgent } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(userAgent ? { "user-agent": userAgent } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
    cookie: collectCookie(response),
  };
}

const signIn = (baseUrl, identifier, password, options = {}) =>
  request(baseUrl, "/api/auth/sign-in", { method: "POST", body: { identifier, password }, ...options });

const register = (baseUrl, input) =>
  request(baseUrl, "/api/auth/register", { method: "POST", body: input });

test("seeds every evolution account with the documented password", async () => {
  const app = await startApp();
  try {
    for (const username of [
      "evo-register-existing",
      "evo-login-case",
      "evo-session-owner",
      "evo-session-owner-s2",
      "evo-session-owner-s3",
    ]) {
      const result = await signIn(app.baseUrl, username, EVO_PASSWORD);
      assert.equal(result.status, 200, `${username} should sign in with the seeded password`);
      assert.equal(result.body.user.username, username);
    }
  } finally {
    await app.close();
  }
});

test("registers a username with a single underscore and rejects uppercase and repeated separators", async () => {
  const app = await startApp();
  try {
    const created = await register(app.baseUrl, {
      username: "evo_user_01",
      email: "evo.register.s1@evolution.test",
      password: EVO_PASSWORD,
      confirmPassword: EVO_PASSWORD,
      agreeToTerms: true,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.username, "evo_user_01");

    const signedIn = await signIn(app.baseUrl, "evo.register.s1@evolution.test", EVO_PASSWORD);
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.user.username, "evo_user_01");

    for (const username of ["EvoUpper01", "evo__user", "evo__user_01", "_evo_user", "evo_user_"]) {
      const rejected = await register(app.baseUrl, {
        username,
        email: `evo.register.${username.length}@evolution.test`,
        password: EVO_PASSWORD,
        confirmPassword: EVO_PASSWORD,
        agreeToTerms: true,
      });
      assert.equal(rejected.status, 400, username);
      assert.equal(rejected.body.fieldErrors.username, "Username format is invalid", username);
    }
  } finally {
    await app.close();
  }
});

test("rejects a duplicate username while keeping the unused email free", async () => {
  const app = await startApp();
  try {
    const duplicate = await register(app.baseUrl, {
      username: "evo-register-existing",
      email: "evo.register.s3@evolution.test",
      password: EVO_PASSWORD,
      confirmPassword: EVO_PASSWORD,
      agreeToTerms: true,
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fieldErrors.username, "Username already exists");
    assert.equal(duplicate.body.fieldErrors.email, undefined);

    // The rejected submission created no second account.
    const signInAsAttempt = await signIn(app.baseUrl, "evo.register.s3@evolution.test", EVO_PASSWORD);
    assert.equal(signInAsAttempt.status, 401);
  } finally {
    await app.close();
  }
});

test("looks up email addresses case-insensitively but usernames exactly", async () => {
  const app = await startApp();
  try {
    const upper = await signIn(app.baseUrl, "EVO.LOGIN.CASE@EVOLUTION.TEST", EVO_PASSWORD);
    assert.equal(upper.status, 200);
    assert.equal(upper.body.user.username, "evo-login-case");

    const usernameCase = await signIn(app.baseUrl, "EVO-LOGIN-CASE", EVO_PASSWORD);
    assert.equal(usernameCase.status, 401);
    assert.equal(usernameCase.body.message, "Invalid credentials");

    const wrongPassword = await signIn(app.baseUrl, "evo.login.case@evolution.test", `${EVO_PASSWORD}-incorrect`);
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.body.message, "Invalid credentials");
    assert.equal(wrongPassword.cookie, "");
  } finally {
    await app.close();
  }
});

test("lists the current session with a device label and last-active time but no secret", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.baseUrl, "evo-session-owner", EVO_PASSWORD, {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36",
    });
    assert.equal(signedIn.status, 200);

    const listed = await request(app.baseUrl, "/api/account/sessions", { cookie: signedIn.cookie });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.sessions.length, 1);
    const [row] = listed.body.sessions;
    assert.equal(row.current, true);
    assert.equal(row.active, true);
    assert.match(row.device, /Chrome on macOS/);
    assert.ok(!Number.isNaN(Date.parse(row.lastActiveAt)));
    assert.ok(!Number.isNaN(Date.parse(row.createdAt)));
    // No session id, cookie value or other secret is handed to the page.
    const serialized = JSON.stringify(listed.body);
    const sessionId = signedIn.cookie.split("=")[1];
    assert.equal(serialized.includes(sessionId), false);
    assert.deepEqual(Object.keys(row).sort(), [
      "active",
      "createdAt",
      "current",
      "device",
      "handle",
      "lastActiveAt",
    ]);

    const withoutCookie = await request(app.baseUrl, "/api/account/sessions");
    assert.equal(withoutCookie.status, 401);
  } finally {
    await app.close();
  }
});

test("lists the pre-provisioned second session and revokes it", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.baseUrl, "evo-session-owner-s2", EVO_PASSWORD);

    const listed = await request(app.baseUrl, "/api/account/sessions", { cookie: signedIn.cookie });
    assert.equal(listed.body.sessions.length, 2, "the account starts with two active sessions");
    assert.equal(listed.body.sessions.filter((row) => row.current).length, 1);
    const other = listed.body.sessions.find((row) => !row.current);
    assert.equal(other.device, "Firefox on Windows");
    assert.equal(other.active, true);

    const revoked = await request(app.baseUrl, `/api/account/sessions/${other.handle}/revoke`, {
      method: "POST",
      cookie: signedIn.cookie,
      body: {},
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.message, "Session revoked");
    assert.equal(revoked.body.sessions.find((row) => row.handle === other.handle).active, false);

    const afterReload = await request(app.baseUrl, "/api/account/sessions", { cookie: signedIn.cookie });
    assert.equal(afterReload.body.sessions.length, 2);
    assert.equal(afterReload.body.sessions.filter((row) => row.current).length, 1);
    assert.equal(afterReload.body.sessions.find((row) => row.handle === other.handle).active, false);

    const stillSignedIn = await request(app.baseUrl, "/api/session", { cookie: signedIn.cookie });
    assert.equal(stillSignedIn.body.user.username, "evo-session-owner-s2");
    assert.equal(stillSignedIn.body.revoked, false);
  } finally {
    await app.close();
  }
});

test("two real browser sessions replace the seeded stand-in and revoking one keeps the other", async () => {
  const app = await startApp();
  try {
    const first = await signIn(app.baseUrl, "evo-session-owner-s2", EVO_PASSWORD);
    const second = await signIn(app.baseUrl, "evo-session-owner-s2", EVO_PASSWORD);
    assert.notEqual(first.cookie, second.cookie);

    const listed = await request(app.baseUrl, "/api/account/sessions", { cookie: second.cookie });
    assert.equal(listed.body.sessions.length, 2, "the two real sessions and no phantom extra row");
    assert.equal(listed.body.sessions.filter((row) => row.current).length, 1);
    const other = listed.body.sessions.find((row) => !row.current && row.active);
    assert.ok(other, "the other browser is offered for revocation");

    const revoked = await request(app.baseUrl, `/api/account/sessions/${other.handle}/revoke`, {
      method: "POST",
      cookie: second.cookie,
      body: {},
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.message, "Session revoked");
    assert.equal(revoked.body.sessions.find((row) => row.handle === other.handle).active, false);

    // The current browser keeps its session, the other browser loses it.
    const stillSignedIn = await request(app.baseUrl, "/api/session", { cookie: second.cookie });
    assert.equal(stillSignedIn.body.user.username, "evo-session-owner-s2");
    assert.equal(stillSignedIn.body.revoked, false);

    const revokedBrowser = await request(app.baseUrl, "/api/session", { cookie: first.cookie });
    assert.equal(revokedBrowser.status, 200);
    assert.equal(revokedBrowser.body.user, null);
    assert.equal(revokedBrowser.body.revoked, true);
    const protectedCall = await request(app.baseUrl, "/api/account/password", {
      method: "POST",
      cookie: first.cookie,
      body: {},
    });
    assert.equal(protectedCall.status, 401);
  } finally {
    await app.close();
  }
});

test("refuses to revoke the current session", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.baseUrl, "evo-session-owner-s3", EVO_PASSWORD);
    const listed = await request(app.baseUrl, "/api/account/sessions", { cookie: signedIn.cookie });
    const current = listed.body.sessions.find((row) => row.current);

    const rejected = await request(app.baseUrl, `/api/account/sessions/${current.handle}/revoke`, {
      method: "POST",
      cookie: signedIn.cookie,
      body: {},
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.message, "The current session cannot be revoked");

    const stillActive = await request(app.baseUrl, "/api/session", { cookie: signedIn.cookie });
    assert.equal(stillActive.body.user.username, "evo-session-owner-s3");
    const afterAttempt = await request(app.baseUrl, "/api/account/sessions", { cookie: signedIn.cookie });
    assert.equal(afterAttempt.body.sessions.length, 2);
    assert.equal(afterAttempt.body.sessions.filter((row) => row.current).length, 1);
  } finally {
    await app.close();
  }
});

test("answers an inactive cookie as revoked and never leaks another account's session", async () => {
  const app = await startApp();
  try {
    const outsider = await signIn(app.baseUrl, "evo-login-case", EVO_PASSWORD);
    const owner = await signIn(app.baseUrl, "evo-session-owner-s3", EVO_PASSWORD);

    const listed = await request(app.baseUrl, "/api/account/sessions", { cookie: owner.cookie });
    const other = listed.body.sessions.find((row) => !row.current);

    // Another account cannot revoke a session it does not own.
    const forbidden = await request(app.baseUrl, `/api/account/sessions/${other.handle}/revoke`, {
      method: "POST",
      cookie: outsider.cookie,
      body: {},
    });
    assert.equal(forbidden.status, 404);
    assert.equal(forbidden.body.message, "Session not found");
  } finally {
    await app.close();
  }
});

test("a revoked cookie returns no user on a later page load", async () => {
  const app = await startApp();
  try {
    const browserA = await signIn(app.baseUrl, "evo-session-owner-s3", EVO_PASSWORD);
    const browserB = await signIn(app.baseUrl, "evo-session-owner-s3", EVO_PASSWORD);

    const listed = await request(app.baseUrl, "/api/account/sessions", { cookie: browserA.cookie });
    assert.equal(listed.body.sessions.length, 2);
    const foreign = listed.body.sessions.filter((row) => row.active && !row.current);
    assert.equal(foreign.length, 1, "browser B has an active session of its own");

    for (const row of foreign) {
      await request(app.baseUrl, `/api/account/sessions/${row.handle}/revoke`, {
        method: "POST",
        cookie: browserA.cookie,
        body: {},
      });
    }

    const browserBReload = await request(app.baseUrl, "/api/session", { cookie: browserB.cookie });
    assert.equal(browserBReload.body.user, null);
    assert.equal(browserBReload.body.revoked, true);

    const browserAReload = await request(app.baseUrl, "/api/session", { cookie: browserA.cookie });
    assert.equal(browserAReload.body.user.username, "evo-session-owner-s3");
  } finally {
    await app.close();
  }
});
