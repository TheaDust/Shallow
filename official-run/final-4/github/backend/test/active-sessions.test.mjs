import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore, describeDevice, seedAccountId } from "../src/lib/auth-store.mjs";

const CHROME_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";

async function startApp(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-sessions-")));
  const store = createAuthStore(dir);
  const handler = createRequestHandler({ store, staticRoot: join(dir, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir: dir,
    store,
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

async function call(baseUrl, path, { method = "GET", body, cookie, userAgent } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(userAgent ? { "user-agent": userAgent } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : {}, cookie: collectCookie(response) };
}

async function signIn(baseUrl, identifier, password, userAgent) {
  const result = await call(baseUrl, "/api/auth/sign-in", {
    method: "POST",
    body: { identifier, password },
    userAgent,
  });
  assert.equal(result.response.status, 200);
  return result.cookie;
}

test("lists the current session and the other active sessions without a secret", async () => {
  const app = await startApp();
  try {
    const first = await signIn(
      app.baseUrl,
      "evo-session-owner",
      "Evo-Password-987!",
      CHROME_LINUX,
    );
    const second = await signIn(
      app.baseUrl,
      "evo.session.owner@evolution.test",
      "Evo-Password-987!",
      FIREFOX_WINDOWS,
    );

    const listed = await call(app.baseUrl, "/api/account/sessions", {
      cookie: first,
      userAgent: CHROME_LINUX,
    });
    assert.equal(listed.response.status, 200);
    const rows = listed.body.sessions;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].current, true);
    assert.equal(rows[0].device, "Chrome on Linux");
    assert.equal(rows[1].current, false);
    assert.equal(rows[1].device, "Firefox on Windows");
    for (const row of rows) {
      assert.equal(typeof row.lastActiveAt, "string");
      assert.equal(Object.hasOwn(row, "secret"), false);
      // The secret session id is the cookie value; it never travels as a row id.
      assert.notEqual(row.id, first.split("=").slice(1).join("="));
      assert.notEqual(row.id, second.split("=").slice(1).join("="));
    }

    // The same list seen from the other browser marks that browser as current.
    const otherView = await call(app.baseUrl, "/api/account/sessions", { cookie: second });
    assert.equal(otherView.body.sessions[0].current, true);
    assert.equal(otherView.body.sessions[0].device, "Firefox on Windows");
  } finally {
    await app.close();
  }
});

test("revokes another browser session while the current one stays active", async () => {
  const app = await startApp();
  try {
    const currentCookie = await signIn(app.baseUrl, "evo-session-owner-s2", "Evo-Password-987!", CHROME_LINUX);
    const otherCookie = await signIn(
      app.baseUrl,
      "evo-session-owner-s2",
      "Evo-Password-987!",
      FIREFOX_WINDOWS,
    );

    const before = await call(app.baseUrl, "/api/account/sessions", { cookie: currentCookie });
    const otherRow = before.body.sessions.find((row) => !row.current);
    assert.ok(otherRow, "the other session is listed");

    const revoked = await call(app.baseUrl, `/api/account/sessions/${otherRow.id}/revoke`, {
      method: "POST",
      body: {},
      cookie: currentCookie,
    });
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.message, "Session revoked");

    // The revoked browser cannot use its session any more, and the server marks
    // it as revoked so the app returns it to the sign-in page (REQ-1-4).
    const revokedSession = await call(app.baseUrl, "/api/session", { cookie: otherCookie });
    assert.equal(revokedSession.body.user, null);
    assert.equal(revokedSession.body.revoked, true);
    const revokedList = await call(app.baseUrl, "/api/account/sessions", { cookie: otherCookie });
    assert.equal(revokedList.response.status, 401);

    // A browser with no session (or an unknown cookie) stays on the public
    // visitor entry instead of being sent to the sign-in page.
    assert.equal((await call(app.baseUrl, "/api/session")).body.revoked, false);
    assert.equal(
      (await call(app.baseUrl, "/api/session", { cookie: "shallow_session=not-a-session" })).body
        .revoked,
      false,
    );

    // The current browser still resolves and now lists only itself.
    const after = await call(app.baseUrl, "/api/account/sessions", { cookie: currentCookie });
    assert.equal(after.response.status, 200);
    assert.equal((await call(app.baseUrl, "/api/session", { cookie: currentCookie })).body.user.username, "evo-session-owner-s2");
    assert.equal(after.body.sessions.length, 1);
    assert.equal(after.body.sessions[0].current, true);
  } finally {
    await app.close();
  }
});

test("a signed-in browser is never reported as revoked", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-session-owner-s3", "Evo-Password-987!", CHROME_LINUX);
    const session = await call(app.baseUrl, "/api/session", { cookie });
    assert.equal(session.body.user.username, "evo-session-owner-s3");
    assert.equal(session.body.revoked, false);

    // A sign-out ends the session and clears the cookie, so the browser keeps
    // the public visitor entry rather than a revoked marker.
    const signedOut = await call(app.baseUrl, "/api/auth/sign-out", {
      method: "POST",
      body: {},
      cookie,
    });
    assert.equal(signedOut.response.status, 200);
    assert.match(signedOut.cookie, /^shallow_session=$/);
    assert.equal((await call(app.baseUrl, "/api/session")).body.revoked, false);
  } finally {
    await app.close();
  }
});

test("refuses to revoke the current session and sessions of another account", async () => {
  const app = await startApp();
  try {
    const cookie = await signIn(app.baseUrl, "evo-session-owner-s3", "Evo-Password-987!", CHROME_LINUX);
    const listed = await call(app.baseUrl, "/api/account/sessions", { cookie });
    const currentRow = listed.body.sessions[0];

    const self = await call(app.baseUrl, `/api/account/sessions/${currentRow.id}/revoke`, {
      method: "POST",
      body: {},
      cookie,
    });
    assert.equal(self.response.status, 400);

    const missing = await call(app.baseUrl, "/api/account/sessions/does-not-exist/revoke", {
      method: "POST",
      body: {},
      cookie,
    });
    assert.equal(missing.response.status, 404);

    const anonymous = await call(app.baseUrl, "/api/account/sessions");
    assert.equal(anonymous.response.status, 401);
    assert.equal(
      (await call(app.baseUrl, `/api/account/sessions/${currentRow.id}/revoke`, { method: "POST", body: {} }))
        .response.status,
      401,
    );
  } finally {
    await app.close();
  }
});

test("upgrades an inherited store, keeping records and adding only what is missing", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-auth-upgrade-"));
  const legacyFile = join(dataDir, "auth.json");
  const keepMe = {
    id: "account-legacy-user",
    username: "legacy-user",
    email: "legacy.user@example.test",
    emailVerified: true,
    available: true,
    credential: { salt: "00", hash: "00" },
    createdAt: "2023-01-01T00:00:00.000Z",
  };
  const renamedSeed = {
    // A same-named account that the visitor registered itself: the preset
    // object must not be added a second time.
    id: "account-registered-by-user",
    username: "evo-login-case",
    email: "custom.evo@example.test",
    emailVerified: true,
    available: true,
    credential: { salt: "11", hash: "11" },
    createdAt: "2023-02-02T00:00:00.000Z",
  };
  await writeFile(
    legacyFile,
    JSON.stringify({
      accounts: [keepMe, renamedSeed],
      sessions: { "session-legacy": { id: "session-legacy", accountId: keepMe.id, active: true, createdAt: "2023-03-03T00:00:00.000Z" } },
    }),
    "utf8",
  );

  const store = createAuthStore(dataDir);
  await store.ensureSeeded();
  const afterFirst = JSON.parse(await readFile(legacyFile, "utf8"));

  assert.ok(afterFirst.accounts.some((entry) => entry.id === "account-legacy-user"));
  assert.equal(afterFirst.accounts.filter((entry) => entry.username === "evo-login-case").length, 1);
  assert.ok(afterFirst.accounts.some((entry) => entry.id === seedAccountId("evo-register-existing")));
  assert.ok(afterFirst.accounts.some((entry) => entry.id === seedAccountId("evo-session-owner-s3")));
  assert.equal(afterFirst.sessions["session-legacy"].active, true);
  assert.equal(typeof afterFirst.sessions["session-legacy"].publicId, "string");
  assert.equal(afterFirst.sessions["session-legacy"].device, "Unknown device");

  const countAfterFirst = afterFirst.accounts.length;
  await store.ensureSeeded();
  const afterSecond = JSON.parse(await readFile(legacyFile, "utf8"));
  assert.equal(afterSecond.accounts.length, countAfterFirst);
  assert.equal(afterSecond.sessions["session-legacy"].publicId, afterFirst.sessions["session-legacy"].publicId);
});

test("an upgraded store serves the new preset accounts through the API", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-auth-upgrade-api-"));
  await writeFile(
    join(dataDir, "auth.json"),
    JSON.stringify({ accounts: [], sessions: {} }),
    "utf8",
  );
  const app = await startApp(dataDir);
  try {
    const cookie = await signIn(app.baseUrl, "EVO.REGISTER.EXISTING@EVOLUTION.TEST", "Evo-Password-987!", CHROME_LINUX);
    const listed = await call(app.baseUrl, "/api/account/sessions", { cookie });
    assert.equal(listed.body.sessions.length, 1);
    assert.equal(listed.body.sessions[0].device, "Chrome on Linux");
  } finally {
    await app.close();
  }
});

test("device labels stay readable for unknown browsers", () => {
  assert.equal(describeDevice(""), "Unknown device");
  assert.equal(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"), "Safari on macOS");
  assert.equal(describeDevice("Mozilla/5.0 (Linux; Android 13) Chrome/119.0.0.0"), "Chrome on Android");
  assert.equal(describeDevice("curl/8.0"), "Unknown browser on Unknown OS");
});
