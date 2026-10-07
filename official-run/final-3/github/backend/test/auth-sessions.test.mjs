import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore, seedAccountId } from "../src/lib/auth-store.mjs";

const CHROME_LINUX = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36";
const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0";
const EVOLUTION_PASSWORD = "Evo-Password-987!";

async function startApp(dataDir) {
  const directory = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-sessions-")));
  const store = createAuthStore(directory);
  const handler = createRequestHandler({ store, staticRoot: join(directory, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir: directory,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function collectCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function request(baseUrl, path, { method = "GET", body, cookie, userAgent } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(userAgent ? { "user-agent": userAgent } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
    cookie: collectCookie(response),
  };
}

async function signIn(baseUrl, identifier, userAgent) {
  return request(baseUrl, "/api/auth/sign-in", {
    method: "POST",
    body: { identifier, password: EVOLUTION_PASSWORD },
    userAgent,
  });
}

test("lists the current session with its device and last activity, then revokes the other browser", async () => {
  const app = await startApp();
  try {
    const first = await signIn(app.baseUrl, "evo.session.owner@evolution.test", CHROME_LINUX);
    assert.equal(first.status, 200);
    assert.equal(first.body.user.username, "evo-session-owner");
    const sessionSecret = first.cookie.split("=").slice(1).join("=");

    const current = await request(app.baseUrl, "/api/account/sessions", { cookie: first.cookie });
    assert.equal(current.status, 200);
    assert.equal(current.body.sessions.length, 1);
    const only = current.body.sessions[0];
    assert.equal(only.current, true);
    assert.equal(only.revoked, false);
    assert.equal(only.device, "Chrome on Linux");
    assert.equal(typeof only.lastActiveAt, "string");
    assert.equal(JSON.stringify(current.body).includes(sessionSecret), false);

    const second = await signIn(app.baseUrl, "evo.session.owner@evolution.test", FIREFOX_MAC);
    assert.equal(second.status, 200);
    assert.notEqual(second.cookie, first.cookie);

    const both = await request(app.baseUrl, "/api/account/sessions", { cookie: first.cookie });
    assert.equal(both.body.sessions.length, 2);
    assert.equal(both.body.sessions[0].current, true);
    const other = both.body.sessions.find((session) => !session.current);
    assert.equal(other.device, "Firefox on macOS");

    const revoked = await request(app.baseUrl, `/api/account/sessions/${encodeURIComponent(other.key)}/revoke`, {
      method: "POST",
      body: {},
      cookie: first.cookie,
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.message, "Session revoked");
    const revokedRow = revoked.body.sessions.find((session) => session.key === other.key);
    assert.equal(revokedRow.revoked, true);
    assert.equal(revoked.body.sessions.find((session) => session.current).revoked, false);

    // The revoked browser loses the protected session; the current one keeps it.
    const revokedSession = await request(app.baseUrl, "/api/session", { cookie: second.cookie });
    assert.equal(revokedSession.status, 200);
    assert.equal(revokedSession.body.user, null);
    const revokedSessionsView = await request(app.baseUrl, "/api/account/sessions", { cookie: second.cookie });
    assert.equal(revokedSessionsView.status, 401);

    const currentSession = await request(app.baseUrl, "/api/session", { cookie: first.cookie });
    assert.equal(currentSession.body.user.username, "evo-session-owner");

    // Reloading the page shows the updated list, not the revoked session as active.
    const afterReload = await request(app.baseUrl, "/api/account/sessions", { cookie: first.cookie });
    assert.equal(afterReload.body.sessions.find((session) => session.key === other.key).revoked, true);
    assert.equal(afterReload.body.sessions.filter((session) => !session.revoked).length, 1);
  } finally {
    await app.close();
  }
});

test("never revokes the current session and keeps signed-out sessions out of the list", async () => {
  const app = await startApp();
  try {
    const first = await signIn(app.baseUrl, "evo.session.owner.s2@evolution.test", CHROME_LINUX);
    const second = await signIn(app.baseUrl, "evo.session.owner.s2@evolution.test", FIREFOX_MAC);

    const listed = await request(app.baseUrl, "/api/account/sessions", { cookie: first.cookie });
    const currentKey = listed.body.sessions.find((session) => session.current).key;
    const refused = await request(app.baseUrl, `/api/account/sessions/${encodeURIComponent(currentKey)}/revoke`, {
      method: "POST",
      body: {},
      cookie: first.cookie,
    });
    assert.equal(refused.status, 400);

    const signedOut = await request(app.baseUrl, "/api/auth/sign-out", { method: "POST", body: {}, cookie: second.cookie });
    assert.equal(signedOut.status, 200);
    const afterSignOut = await request(app.baseUrl, "/api/account/sessions", { cookie: first.cookie });
    assert.equal(afterSignOut.body.sessions.length, 1);
    assert.equal(afterSignOut.body.sessions[0].current, true);
  } finally {
    await app.close();
  }
});

test("revoking one browser leaves the other signed in", async () => {
  const app = await startApp();
  try {
    const first = await signIn(app.baseUrl, "evo.session.owner.s3@evolution.test", CHROME_LINUX);
    const second = await signIn(app.baseUrl, "evo.session.owner.s3@evolution.test", FIREFOX_MAC);

    const listed = await request(app.baseUrl, "/api/account/sessions", { cookie: first.cookie });
    const other = listed.body.sessions.find((session) => !session.current);
    await request(app.baseUrl, `/api/account/sessions/${encodeURIComponent(other.key)}/revoke`, {
      method: "POST",
      body: {},
      cookie: first.cookie,
    });

    const revoked = await request(app.baseUrl, "/api/session", { cookie: second.cookie });
    assert.equal(revoked.body.user, null);
    // The revoked browser still carries its inactive cookie, so the frontend
    // can tell it apart from a fresh visitor and send it to the sign-in page.
    assert.equal(revoked.body.revoked, true);
    const visitor = await request(app.baseUrl, "/api/session");
    assert.equal(visitor.body.user, null);
    assert.equal(visitor.body.revoked, false);
    const survivor = await request(app.baseUrl, "/api/session", { cookie: first.cookie });
    assert.equal(survivor.body.user.username, "evo-session-owner-s3");
    assert.equal(survivor.body.revoked, false);
  } finally {
    await app.close();
  }
});

test("upgrades an existing auth file with the missing seeds and stays idempotent", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-upgrade-"));
  const legacyState = {
    accounts: [
      {
        id: "account-alice-dev",
        username: "alice-dev",
        email: "alice.changed@example.test",
        emailVerified: true,
        available: true,
        credential: { salt: "00", hash: "00" },
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "account-legacy-user",
        username: "legacy-user",
        email: "legacy.user@example.test",
        emailVerified: true,
        available: true,
        credential: { salt: "00", hash: "00" },
        createdAt: "2024-01-02T00:00:00.000Z",
      },
    ],
    sessions: {},
  };
  await writeFile(join(dataDir, "auth.json"), `${JSON.stringify(legacyState, null, 2)}\n`, "utf8");

  const firstStore = createAuthStore(dataDir);
  const seeded = await firstStore.findAccountsByIds([
    seedAccountId("evo-login-case"),
    seedAccountId("evo-session-owner"),
    seedAccountId("alice-dev"),
    "account-legacy-user",
  ]);
  assert.deepEqual(
    seeded.map((account) => account.username).sort(),
    ["alice-dev", "evo-login-case", "evo-session-owner", "legacy-user"],
  );
  assert.equal(seeded.find((account) => account.username === "alice-dev").email, "alice.changed@example.test");

  const firstFile = JSON.parse(await readFile(join(dataDir, "auth.json"), "utf8"));
  const usernames = firstFile.accounts.map((account) => account.username);
  assert.equal(new Set(usernames).size, usernames.length);
  assert.equal(usernames.includes("legacy-user"), true);

  // A second start (same data dir) adds nothing again.
  const secondStore = createAuthStore(dataDir);
  await secondStore.findAccountsByIds(["account-legacy-user"]);
  const secondFile = JSON.parse(await readFile(join(dataDir, "auth.json"), "utf8"));
  assert.deepEqual(secondFile.accounts.map((account) => account.id).sort(), firstFile.accounts.map((account) => account.id).sort());
});
