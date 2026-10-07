import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-password-"));
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

async function signIn(baseUrl, identifier, password) {
  const result = await post(baseUrl, "/api/auth/sign-in", { identifier, password });
  return { ...result, status: result.response.status };
}

test("seeds every password-change account with the shared initial password", async () => {
  const app = await startApp();
  try {
    for (const username of ["password-change-success", "password-change-invalid", "password-change-required"]) {
      const signedIn = await signIn(app.baseUrl, username, "Valid-password-123!");
      assert.equal(signedIn.status, 200, `${username} should sign in with the seeded password`);
      assert.equal(signedIn.body.user.username, username);
    }
    const emailSignIn = await signIn(app.baseUrl, "password-change-success@example.test", "Valid-password-123!");
    assert.equal(emailSignIn.status, 200);
  } finally {
    await app.close();
  }
});

test("updates the password of the signed-in account and rejects the old one", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.baseUrl, "password-change-success", "Valid-password-123!");
    const changed = await post(
      app.baseUrl,
      "/api/account/password",
      {
        currentPassword: "Valid-password-123!",
        newPassword: "New-password-456!",
        confirmPassword: "New-password-456!",
      },
      signedIn.cookie,
    );
    assert.equal(changed.response.status, 200);
    assert.equal(changed.body.message, "Password updated");

    const withNew = await signIn(app.baseUrl, "password-change-success@example.test", "New-password-456!");
    assert.equal(withNew.status, 200);
    assert.equal(withNew.body.user.username, "password-change-success");

    const withOld = await signIn(app.baseUrl, "password-change-success@example.test", "Valid-password-123!");
    assert.equal(withOld.status, 401);
    assert.equal(withOld.body.message, "Invalid credentials");

    // The other seeded accounts are untouched.
    const other = await signIn(app.baseUrl, "password-change-invalid@example.test", "Valid-password-123!");
    assert.equal(other.status, 200);

    // The change survives a restart against the same data directory.
    const restartedStore = createAuthStore(app.dataDir);
    assert.equal(
      (await restartedStore.authenticate("password-change-success@example.test", "New-password-456!"))?.username,
      "password-change-success",
    );
    assert.equal(await restartedStore.authenticate("password-change-success@example.test", "Valid-password-123!"), null);
  } finally {
    await app.close();
  }
});

test("an incorrect current password is reported and leaves the credentials usable", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.baseUrl, "password-change-invalid", "Valid-password-123!");
    const changed = await post(
      app.baseUrl,
      "/api/account/password",
      {
        currentPassword: "Valid-password-123!-wrong",
        newPassword: "Another-valid-password-123!",
        confirmPassword: "does-not-match",
      },
      signedIn.cookie,
    );
    assert.equal(changed.response.status, 400);
    assert.deepEqual(changed.body.fieldErrors, { currentPassword: "Current password is incorrect" });

    const original = await signIn(app.baseUrl, "password-change-invalid@example.test", "Valid-password-123!");
    assert.equal(original.status, 200);
    const rejected = await signIn(app.baseUrl, "password-change-invalid@example.test", "Another-valid-password-123!");
    assert.equal(rejected.status, 401);
  } finally {
    await app.close();
  }
});

test("a missing current password is reported before any other password rule", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.baseUrl, "password-change-required", "Valid-password-123!");
    const changed = await post(
      app.baseUrl,
      "/api/account/password",
      { currentPassword: "", newPassword: "Required-password-789!", confirmPassword: "Required-password-789!" },
      signedIn.cookie,
    );
    assert.equal(changed.response.status, 400);
    assert.deepEqual(changed.body.fieldErrors, { currentPassword: "Current password is required" });

    const original = await signIn(app.baseUrl, "password-change-required@example.test", "Valid-password-123!");
    assert.equal(original.status, 200);
    assert.equal(original.body.user.username, "password-change-required");
  } finally {
    await app.close();
  }
});

test("reports a noncompliant new password and a mismatched confirmation together", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.baseUrl, "password-change-success", "Valid-password-123!");
    const changed = await post(
      app.baseUrl,
      "/api/account/password",
      { currentPassword: "Valid-password-123!", newPassword: "short", confirmPassword: "other" },
      signedIn.cookie,
    );
    assert.equal(changed.response.status, 400);
    assert.deepEqual(changed.body.fieldErrors, {
      newPassword: "Password requirements are not satisfied",
      confirmPassword: "Password confirmation does not match",
    });
    const original = await signIn(app.baseUrl, "password-change-success@example.test", "Valid-password-123!");
    assert.equal(original.status, 200);
  } finally {
    await app.close();
  }
});

test("refuses to change a password without a session", async () => {
  const app = await startApp();
  try {
    const changed = await post(app.baseUrl, "/api/account/password", {
      currentPassword: "Valid-password-123!",
      newPassword: "New-password-456!",
      confirmPassword: "New-password-456!",
    });
    assert.equal(changed.response.status, 401);
    const original = await signIn(app.baseUrl, "alice-dev", "Valid-password-123!");
    assert.equal(original.status, 200);
  } finally {
    await app.close();
  }
});

test("a signed-out session can no longer change the password", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.baseUrl, "alice-dev", "Valid-password-123!");
    const signedOut = await post(app.baseUrl, "/api/auth/sign-out", {}, signedIn.cookie);
    assert.equal(signedOut.response.status, 200);

    const changed = await post(
      app.baseUrl,
      "/api/account/password",
      { currentPassword: "Valid-password-123!", newPassword: "New-password-456!", confirmPassword: "New-password-456!" },
      signedIn.cookie,
    );
    assert.equal(changed.response.status, 401);
    const original = await signIn(app.baseUrl, "alice.dev@example.test", "Valid-password-123!");
    assert.equal(original.status, 200);
  } finally {
    await app.close();
  }
});
