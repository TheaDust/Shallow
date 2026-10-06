import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { deviceLabel, UNKNOWN_DEVICE } from "../src/lib/session-device.mjs";

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
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
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

async function post(baseUrl, path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : {}, cookie: collectCookie(response) };
}

async function get(baseUrl, path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : {} };
}

async function openBrowser(app, identifier, password = EVO_PASSWORD) {
  const signedIn = await post(app.baseUrl, "/api/auth/sign-in", { identifier, password });
  assert.equal(signedIn.response.status, 200);
  assert.notEqual(signedIn.cookie, "");
  return signedIn.cookie;
}

test("a browser session is listed with its device and last active time, never its secret", async () => {
  const app = await startApp();
  try {
    const cookie = await openBrowser(app, "evo.session.owner@evolution.test");
    const listed = await get(app.baseUrl, "/api/account/sessions", cookie);
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.sessions.length, 1);

    const [session] = listed.body.sessions;
    assert.equal(session.current, true);
    assert.equal(session.active, true);
    assert.equal(typeof session.id, "string");
    assert.ok(session.id.length > 0);
    assert.equal(typeof session.device, "string");
    assert.ok(session.device.length > 0);
    assert.ok(!Number.isNaN(Date.parse(session.lastActive)));

    // The cookie value is the session secret and must never be returned.
    const secret = cookie.split("=").slice(1).join("=");
    assert.ok(!JSON.stringify(listed.body).includes(secret));
    assert.ok(!JSON.stringify(listed.body).includes("credential"));
  } finally {
    await app.close();
  }
});

test("another active browser session is revoked and keeps the current one usable", async () => {
  const app = await startApp();
  try {
    const other = await openBrowser(app, "evo.session.owner.s2@evolution.test");
    const current = await openBrowser(app, "evo.session.owner.s2@evolution.test");

    const before = await get(app.baseUrl, "/api/account/sessions", current);
    assert.equal(before.body.sessions.length, 2);
    const otherRow = before.body.sessions.find((session) => !session.current);
    assert.ok(otherRow);
    const currentRow = before.body.sessions.find((session) => session.current);
    assert.equal(currentRow.device.length > 0, true);

    const revoked = await post(
      app.baseUrl,
      `/api/account/sessions/${encodeURIComponent(otherRow.id)}/revoke`,
      {},
      current,
    );
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.message, "Session revoked");

    // The revoked browser is told the session is gone instead of being a visitor.
    const revokedSession = await get(app.baseUrl, "/api/session", other);
    assert.equal(revokedSession.body.user, null);
    assert.equal(revokedSession.body.revoked, true);

    const revokedProtected = await get(app.baseUrl, "/api/account/sessions", other);
    assert.equal(revokedProtected.response.status, 401);

    // The current session keeps working and sees the updated list.
    const stillThere = await get(app.baseUrl, "/api/session", current);
    assert.equal(stillThere.body.user.username, "evo-session-owner-s2");
    assert.equal(stillThere.body.revoked, false);

    const after = await get(app.baseUrl, "/api/account/sessions", current);
    assert.equal(after.body.sessions.length, 2);
    const revokedRow = after.body.sessions.find((session) => session.id === otherRow.id);
    assert.equal(revokedRow.active, false);
    assert.equal(after.body.sessions.filter((session) => session.active).length, 1);
  } finally {
    await app.close();
  }
});

test("only own sessions can be revoked and listing needs a session", async () => {
  const app = await startApp();
  try {
    const anonymous = await get(app.baseUrl, "/api/account/sessions");
    assert.equal(anonymous.response.status, 401);

    const owner = await openBrowser(app, "evo.session.owner.s3@evolution.test");
    const stranger = await openBrowser(app, "evo.session.owner@evolution.test");
    const strangerList = await get(app.baseUrl, "/api/account/sessions", stranger);
    const strangerRow = strangerList.body.sessions[0];

    const foreign = await post(
      app.baseUrl,
      `/api/account/sessions/${encodeURIComponent(strangerRow.id)}/revoke`,
      {},
      owner,
    );
    assert.equal(foreign.response.status, 404);

    const missing = await post(
      app.baseUrl,
      "/api/account/sessions/does-not-exist/revoke",
      {},
      owner,
    );
    assert.equal(missing.response.status, 404);

    const owned = await get(app.baseUrl, "/api/account/sessions", owner);
    assert.equal(owned.body.sessions.length, 1);
    assert.equal(owned.body.sessions[0].active, true);
  } finally {
    await app.close();
  }
});

test("device labels name the browser and its platform", () => {
  assert.equal(
    deviceLabel("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"),
    "Chrome on Linux",
  );
  assert.equal(
    deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"),
    "Safari on macOS",
  );
  assert.equal(
    deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0"),
    "Firefox on Windows",
  );
  assert.equal(deviceLabel(""), UNKNOWN_DEVICE);
});
