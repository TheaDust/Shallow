import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const SEED = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function signIn(app, identifier, password) {
  return call(app.baseUrl, "/api/session", {
    method: "POST",
    body: { identifier, password },
  });
}

function cookieOf(response) {
  return response.setCookie?.split(";")[0] ?? null;
}

test("the seeded account signs in with its username or its verified email", async () => {
  await withApp(async (app) => {
    for (const identifier of [SEED.username, SEED.email]) {
      const response = await signIn(app, identifier, SEED.password);
      assert.equal(response.status, 200);
      assert.equal(response.body.account.username, SEED.username);
      assert.equal(response.body.account.email, SEED.email);
      assert.equal(response.body.account.emailVerified, true);
      assert.ok(cookieOf(response));

      const session = await call(app.baseUrl, "/api/session", {
        cookie: cookieOf(response),
      });
      assert.equal(session.status, 200);
      assert.equal(session.body.account.username, SEED.username);
    }
  });
});

test("unknown account, wrong password and unknown email share one failure message", async () => {
  await withApp(async (app) => {
    const attempts = [
      { identifier: "nobody-here", password: SEED.password },
      { identifier: "nobody@example.test", password: "Whatever-123!" },
      { identifier: SEED.username, password: "Wrong-password-123!" },
    ];
    for (const attempt of attempts) {
      const response = await signIn(app, attempt.identifier, attempt.password);
      assert.equal(response.status, 401);
      assert.equal(response.body.error, "Invalid credentials");
      assert.equal(response.setCookie, null);
    }
    const anonymous = await call(app.baseUrl, "/api/session");
    assert.deepEqual(anonymous.body, { account: null });
  });
});

test("a session survives a server restart and ends after sign out", async () => {
  await withApp(async (app) => {
    const signedIn = await signIn(app, SEED.email, SEED.password);
    const cookie = cookieOf(signedIn);
    await app.restart();

    const restored = await call(app.baseUrl, "/api/session", { cookie });
    assert.equal(restored.body.account.username, SEED.username);

    const signedOut = await call(app.baseUrl, "/api/session", {
      method: "DELETE",
      cookie,
    });
    assert.equal(signedOut.status, 200);
    const after = await call(app.baseUrl, "/api/session", { cookie });
    assert.equal(after.body.account, null);
  });
});

test("registration stores a verified sign-in capable account without echoing the password", async () => {
  await withApp(async (app) => {
    const password = "Fresh-password-321!";
    const created = await call(app.baseUrl, "/api/register", {
      method: "POST",
      body: {
        username: "pw-user-1",
        email: "pw-user-1@example.test",
        password,
        confirmPassword: password,
        agreeToTerms: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.account.username, "pw-user-1");
    assert.equal(created.body.account.emailVerified, true);
    assert.ok(!created.text.includes(password));

    const signedIn = await signIn(app, "pw-user-1@example.test", password);
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.account.username, "pw-user-1");
  });
});

test("registration reports every invalid field in one response", async () => {
  await withApp(async (app) => {
    const response = await call(app.baseUrl, "/api/register", {
      method: "POST",
      body: {
        username: "-lead",
        email: "not-an-email",
        password: "short",
        confirmPassword: "different",
        agreeToTerms: false,
      },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fieldErrors, {
      username: "Username format is invalid",
      email: "Email format is invalid",
      password: "Password requirements are not satisfied",
      agreeToTerms: "Agree to terms is required",
    });
    const rejected = await signIn(app, "-lead", "short");
    assert.equal(rejected.status, 401);
  });
});

test("registration rejects a conflicting username or email without creating an account", async () => {
  await withApp(async (app) => {
    const duplicateUsername = await call(app.baseUrl, "/api/register", {
      method: "POST",
      body: {
        username: SEED.username,
        email: "brand-new@example.test",
        password: "Another-password-1!",
        confirmPassword: "Another-password-1!",
        agreeToTerms: true,
      },
    });
    assert.equal(duplicateUsername.status, 400);
    assert.equal(duplicateUsername.body.fieldErrors.username, "Username already exists");
    assert.equal(duplicateUsername.body.fieldErrors.email, undefined);

    const duplicateEmail = await call(app.baseUrl, "/api/register", {
      method: "POST",
      body: {
        username: "brand-new-user",
        email: SEED.email,
        password: "Another-password-1!",
        confirmPassword: "Another-password-1!",
        agreeToTerms: true,
      },
    });
    assert.equal(duplicateEmail.status, 400);
    assert.equal(duplicateEmail.body.fieldErrors.email, "Email already exists");

    const reused = await signIn(app, "brand-new-user", "Another-password-1!");
    assert.equal(reused.status, 401);
  });
});

test("registration rejects a mismatched confirmation but keeps the password rule silent", async () => {
  await withApp(async (app) => {
    const response = await call(app.baseUrl, "/api/register", {
      method: "POST",
      body: {
        username: "mismatch-user",
        email: "mismatch@example.test",
        password: "Valid-password-123!",
        confirmPassword: "different",
        agreeToTerms: true,
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.fieldErrors.confirmPassword, "Passwords do not match");
    assert.equal(response.body.fieldErrors.password, undefined);
    assert.equal(response.body.fieldErrors.username, undefined);
  });
});

test("password recovery only updates the account behind the fixed code", async () => {
  await withApp(async (app) => {
    const replacement = "Replacement-password-456!";
    const wrongCode = await call(app.baseUrl, "/api/password-reset", {
      method: "POST",
      body: {
        email: SEED.email,
        code: "000000",
        newPassword: replacement,
        confirmPassword: replacement,
      },
    });
    assert.equal(wrongCode.status, 400);
    assert.equal(wrongCode.body.fieldErrors.code, "Verification code is invalid");

    const unknownEmail = await call(app.baseUrl, "/api/password-reset", {
      method: "POST",
      body: {
        email: "unknown@example.test",
        code: "123456",
        newPassword: replacement,
        confirmPassword: replacement,
      },
    });
    assert.equal(unknownEmail.status, 400);
    assert.equal(unknownEmail.body.fieldErrors.email, "Account not found");

    const unchanged = await signIn(app, SEED.username, SEED.password);
    assert.equal(unchanged.status, 200);

    const reset = await call(app.baseUrl, "/api/password-reset", {
      method: "POST",
      body: {
        email: SEED.email,
        code: "123456",
        newPassword: replacement,
        confirmPassword: replacement,
      },
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.message, "Password updated");

    const oldPassword = await signIn(app, SEED.username, SEED.password);
    assert.equal(oldPassword.status, 401);
    const newPassword = await signIn(app, SEED.username, replacement);
    assert.equal(newPassword.status, 200);
  });
});

test("unknown routes answer with an error response and keep the server alive", async () => {
  await withApp(async (app) => {
    const missingApi = await call(app.baseUrl, "/api/does-not-exist");
    assert.equal(missingApi.status, 404);
    const missingAsset = await call(app.baseUrl, "/favicon.ico");
    assert.equal(missingAsset.status, 404);
    const health = await call(app.baseUrl, "/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { ok: true });
  });
});
