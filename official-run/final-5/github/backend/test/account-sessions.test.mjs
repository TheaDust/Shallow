import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore, seedAccountId } from "../src/lib/auth-store.mjs";

const EVOLUTION_PASSWORD = "Evo-Password-987!";

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
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function post(baseUrl, path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
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

function signIn(baseUrl, identifier, password) {
  return post(baseUrl, "/api/auth/sign-in", { identifier, password });
}

test("registers an evolution username that uses single underscores", async () => {
  const app = await startApp();
  try {
    const registered = await post(app.baseUrl, "/api/auth/register", {
      username: "evo_user_01",
      email: "evo.register.s1@evolution.test",
      password: EVOLUTION_PASSWORD,
      confirmPassword: EVOLUTION_PASSWORD,
      agreeToTerms: true,
    });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.user.username, "evo_user_01");

    const signedIn = await signIn(app.baseUrl, "evo.register.s1@evolution.test", EVOLUTION_PASSWORD);
    assert.equal(signedIn.response.status, 200);
    assert.equal(signedIn.body.user.username, "evo_user_01");
  } finally {
    await app.close();
  }
});

test("rejects an uppercase username and any other separator misuse", async () => {
  const app = await startApp();
  try {
    for (const username of ["EvoUpper01", "evo__user", "evo_user_", "_evo_user", "evo--user"]) {
      const rejected = await post(app.baseUrl, "/api/auth/register", {
        username,
        email: `${username.replace(/[^a-z0-9]/g, "-").toLowerCase()}@evolution.test`,
        password: EVOLUTION_PASSWORD,
        confirmPassword: EVOLUTION_PASSWORD,
        agreeToTerms: true,
      });
      assert.equal(rejected.response.status, 400, username);
      assert.equal(rejected.body.fieldErrors.username, "Username format is invalid", username);
    }
  } finally {
    await app.close();
  }
});

test("pre-provisions the evolution seeds and signs in with their own password", async () => {
  const app = await startApp();
  try {
    const cases = [
      ["evo-register-existing", "evo.register.existing@evolution.test"],
      ["evo-login-case", "evo.login.case@evolution.test"],
      ["evo-session-owner", "evo.session.owner@evolution.test"],
      ["evo-session-owner-s2", "evo.session.owner.s2@evolution.test"],
      ["evo-session-owner-s3", "evo.session.owner.s3@evolution.test"],
    ];
    for (const [username, email] of cases) {
      const byName = await signIn(app.baseUrl, username, EVOLUTION_PASSWORD);
      assert.equal(byName.response.status, 200, username);
      assert.equal(byName.body.user.username, username);
      const byEmail = await signIn(app.baseUrl, email, EVOLUTION_PASSWORD);
      assert.equal(byEmail.response.status, 200, email);
    }
  } finally {
    await app.close();
  }
});

test("a duplicate username is reported while the email stays available", async () => {
  const app = await startApp();
  try {
    const duplicate = await post(app.baseUrl, "/api/auth/register", {
      username: "evo-register-existing",
      email: "evo.register.s3@evolution.test",
      password: EVOLUTION_PASSWORD,
      confirmPassword: EVOLUTION_PASSWORD,
      agreeToTerms: true,
    });
    assert.equal(duplicate.response.status, 400);
    assert.equal(duplicate.body.fieldErrors.username, "Username already exists");
    assert.equal(duplicate.body.fieldErrors.email, undefined);

    const fresh = await post(app.baseUrl, "/api/auth/register", {
      username: "evo-register-s3",
      email: "evo.register.s3@evolution.test",
      password: EVOLUTION_PASSWORD,
      confirmPassword: EVOLUTION_PASSWORD,
      agreeToTerms: true,
    });
    assert.equal(fresh.response.status, 201);
  } finally {
    await app.close();
  }
});

test("signs in with any casing of the email while the username stays exact", async () => {
  const app = await startApp();
  try {
    const upperEmail = await signIn(app.baseUrl, "EVO.LOGIN.CASE@EVOLUTION.TEST", EVOLUTION_PASSWORD);
    assert.equal(upperEmail.response.status, 200);
    assert.equal(upperEmail.body.user.username, "evo-login-case");

    const wrongCaseUsername = await signIn(app.baseUrl, "EVO-LOGIN-CASE", EVOLUTION_PASSWORD);
    assert.equal(wrongCaseUsername.response.status, 401);
    assert.equal(wrongCaseUsername.body.message, "Invalid credentials");
  } finally {
    await app.close();
  }
});

test("lists the account's active sessions with a device label and no secret", async () => {
  const app = await startApp();
  try {
    const first = await signIn(app.baseUrl, "evo-session-owner", EVOLUTION_PASSWORD);
    const second = await signIn(app.baseUrl, "evo.session.owner@evolution.test", EVOLUTION_PASSWORD);
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);

    const listed = await get(app.baseUrl, "/api/account/sessions", first.cookie);
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.sessions.length, 2);
    const current = listed.body.sessions.find((session) => session.current);
    assert.ok(current);
    assert.equal(typeof current.deviceLabel, "string");
    assert.ok(current.deviceLabel.length > 0);
    assert.equal(typeof current.lastActiveAt, "string");
    for (const session of listed.body.sessions) {
      assert.equal(session.credential, undefined);
      assert.equal(session.token, undefined);
      assert.notEqual(session.id, first.cookie);
    }
  } finally {
    await app.close();
  }
});

test("revokes another session without ending the current one", async () => {
  const app = await startApp();
  try {
    const first = await signIn(app.baseUrl, "evo-session-owner-s2", EVOLUTION_PASSWORD);
    const second = await signIn(app.baseUrl, "evo-session-owner-s2", EVOLUTION_PASSWORD);

    const listed = await get(app.baseUrl, "/api/account/sessions", first.cookie);
    const other = listed.body.sessions.find((session) => !session.current);

    const revoked = await post(
      app.baseUrl,
      `/api/account/sessions/${encodeURIComponent(other.id)}/revoke`,
      {},
      first.cookie,
    );
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.sessions.length, 1);
    assert.equal(revoked.body.sessions[0].current, true);

    // The current browser keeps working.
    const stillSignedIn = await get(app.baseUrl, "/api/session", first.cookie);
    assert.equal(stillSignedIn.body.user.username, "evo-session-owner-s2");

    // The revoked browser is signed out for every protected read.
    const revokedUser = await get(app.baseUrl, "/api/session", second.cookie);
    assert.equal(revokedUser.body.user, null);
    const revokedList = await get(app.baseUrl, "/api/account/sessions", second.cookie);
    assert.equal(revokedList.response.status, 401);

    // Reloading the sessions page shows the updated list.
    const reloaded = await get(app.baseUrl, "/api/account/sessions", first.cookie);
    assert.equal(reloaded.body.sessions.length, 1);
  } finally {
    await app.close();
  }
});

test("refuses to revoke the current session and unknown sessions", async () => {
  const app = await startApp();
  try {
    const first = await signIn(app.baseUrl, "evo-session-owner-s3", EVOLUTION_PASSWORD);
    await signIn(app.baseUrl, "evo-session-owner-s3", EVOLUTION_PASSWORD);
    const listed = await get(app.baseUrl, "/api/account/sessions", first.cookie);
    const current = listed.body.sessions.find((session) => session.current);

    const currentAttempt = await post(
      app.baseUrl,
      `/api/account/sessions/${encodeURIComponent(current.id)}/revoke`,
      {},
      first.cookie,
    );
    assert.equal(currentAttempt.response.status, 400);

    const unknown = await post(app.baseUrl, "/api/account/sessions/does-not-exist/revoke", {}, first.cookie);
    assert.equal(unknown.response.status, 404);

    // A foreign account's session is indistinguishable from an unknown one.
    const other = await signIn(app.baseUrl, "evo-session-owner", EVOLUTION_PASSWORD);
    const foreignList = await get(app.baseUrl, "/api/account/sessions", other.cookie);
    const foreignId = foreignList.body.sessions[0].id;
    const foreignAttempt = await post(
      app.baseUrl,
      `/api/account/sessions/${encodeURIComponent(foreignId)}/revoke`,
      {},
      first.cookie,
    );
    assert.equal(foreignAttempt.response.status, 404);
    assert.equal((await get(app.baseUrl, "/api/session", other.cookie)).body.user.username, "evo-session-owner");
  } finally {
    await app.close();
  }
});

test("upgrades an existing store by adding missing seeds and preserving old records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-upgrade-"));
  const authPath = join(dataDir, "auth.json");
  // An older store: one seeded account, one user-registered account and a session.
  await writeFile(
    authPath,
    JSON.stringify({
      accounts: [
        {
          id: seedAccountId("alice-dev"),
          username: "alice-dev",
          email: "alice.dev@example.test",
          emailVerified: true,
          available: true,
          credential: { salt: "old", hash: "old" },
          createdAt: new Date(0).toISOString(),
        },
        {
          id: "account-user-made",
          username: "user-made",
          email: "user-made@example.test",
          emailVerified: true,
          available: true,
          credential: { salt: "old", hash: "old" },
          createdAt: new Date(0).toISOString(),
        },
      ],
      sessions: { old: { id: "old", accountId: "account-user-made", active: true, createdAt: new Date(0).toISOString() } },
    }),
    "utf8",
  );

  const store = createAuthStore(dataDir);
  // Reading the store triggers the upgrade.
  await store.conflictFor({ username: "evo-session-owner", email: "x@y.test" });

  const upgraded = JSON.parse(await readFile(authPath, "utf8"));
  const usernames = upgraded.accounts.map((account) => account.username);
  assert.ok(usernames.includes("user-made"));
  assert.ok(usernames.includes("evo-session-owner"));
  assert.ok(usernames.includes("evo-login-case"));
  assert.equal(usernames.filter((name) => name === "alice-dev").length, 1);
  // The old session survives the migration.
  assert.ok(upgraded.sessions.old);

  // A second start is idempotent: no duplicated seed and the user record kept.
  const restarted = createAuthStore(dataDir);
  await restarted.conflictFor({ username: "alice-dev", email: "alice.dev@example.test" });
  const again = JSON.parse(await readFile(authPath, "utf8"));
  const againNames = again.accounts.map((account) => account.username);
  assert.equal(againNames.filter((name) => name === "evo-session-owner").length, 1);
  assert.equal(again.accounts.length, upgraded.accounts.length);
  assert.ok(againNames.includes("user-made"));
});
