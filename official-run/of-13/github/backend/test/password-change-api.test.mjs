import assert from "node:assert/strict";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const SEED = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};
const SUCCESS_CANDIDATE = "New-password-456!";
const REQUIRED_CANDIDATE = "Required-password-789!";

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function signIn(app, identifier, password) {
  const response = await call(app.baseUrl, "/api/session", {
    method: "POST",
    body: { identifier, password },
  });
  return { response, cookie: response.setCookie?.split(";")[0] ?? null };
}

function changePassword(app, cookie, body) {
  return call(app.baseUrl, "/api/password", { method: "POST", cookie, body });
}

test("an unauthenticated request cannot change any password", async () => {
  await withApp(async (app) => {
    const anonymous = await changePassword(app, null, {
      currentPassword: SEED.password,
      newPassword: SUCCESS_CANDIDATE,
      confirmPassword: SUCCESS_CANDIDATE,
    });
    assert.equal(anonymous.status, 401);

    const stillValid = await signIn(app, SEED.username, SEED.password);
    assert.equal(stillValid.response.status, 200);
    const candidateRejected = await signIn(app, SEED.username, SUCCESS_CANDIDATE);
    assert.equal(candidateRejected.response.status, 401);
  });
});

test("a missing current password reports the required message without changing credentials", async () => {
  await withApp(async (app) => {
    const { cookie } = await signIn(app, SEED.email, SEED.password);
    const response = await changePassword(app, cookie, {
      currentPassword: "",
      newPassword: REQUIRED_CANDIDATE,
      confirmPassword: REQUIRED_CANDIDATE,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fieldErrors, {
      currentPassword: "Current password is required",
    });

    const oldPassword = await signIn(app, SEED.username, SEED.password);
    assert.equal(oldPassword.response.status, 200);
    const candidate = await signIn(app, SEED.username, REQUIRED_CANDIDATE);
    assert.equal(candidate.response.status, 401);
  });
});

test("an incorrect current password, a noncompliant password or a mismatched confirmation are reported per field", async () => {
  await withApp(async (app) => {
    const { cookie } = await signIn(app, SEED.username, SEED.password);

    const wrongCurrent = await changePassword(app, cookie, {
      currentPassword: "Wrong-password-123!",
      newPassword: SUCCESS_CANDIDATE,
      confirmPassword: SUCCESS_CANDIDATE,
    });
    assert.equal(wrongCurrent.status, 400);
    assert.equal(wrongCurrent.body.fieldErrors.currentPassword, "Current password is incorrect");

    const weak = await changePassword(app, cookie, {
      currentPassword: SEED.password,
      newPassword: "short",
      confirmPassword: "short",
    });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.fieldErrors.newPassword, "Password requirements are not satisfied");

    const mismatch = await changePassword(app, cookie, {
      currentPassword: SEED.password,
      newPassword: SUCCESS_CANDIDATE,
      confirmPassword: "does-not-match",
    });
    assert.equal(mismatch.status, 400);
    assert.equal(
      mismatch.body.fieldErrors.confirmPassword,
      "Password confirmation does not match",
    );

    const oldPassword = await signIn(app, SEED.username, SEED.password);
    assert.equal(oldPassword.response.status, 200);
    const candidate = await signIn(app, SEED.username, SUCCESS_CANDIDATE);
    assert.equal(candidate.response.status, 401);
  });
});

test("a successful change applies the new password to the same account and survives a restart", async () => {
  await withApp(async (app) => {
    const { cookie } = await signIn(app, SEED.email, SEED.password);
    const response = await changePassword(app, cookie, {
      currentPassword: SEED.password,
      newPassword: SUCCESS_CANDIDATE,
      confirmPassword: SUCCESS_CANDIDATE,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.message, "Password updated");
    assert.ok(!response.text.includes(SUCCESS_CANDIDATE));

    // The current session keeps working and the account menu still resolves.
    const session = await call(app.baseUrl, "/api/session", { cookie });
    assert.equal(session.body.account.username, SEED.username);

    await app.restart();

    const oldPassword = await signIn(app, SEED.username, SEED.password);
    assert.equal(oldPassword.response.status, 401);
    const newPassword = await signIn(app, SEED.username, SUCCESS_CANDIDATE);
    assert.equal(newPassword.response.status, 200);
    assert.equal(newPassword.response.body.account.username, SEED.username);
  });
});

test("changing one account password leaves other accounts untouched", async () => {
  await withApp(async (app) => {
    const created = await call(app.baseUrl, "/api/register", {
      method: "POST",
      body: {
        username: "second-user",
        email: "second-user@example.test",
        password: "Second-password-321!",
        confirmPassword: "Second-password-321!",
        agreeToTerms: true,
      },
    });
    assert.equal(created.status, 201);

    const { cookie } = await signIn(app, SEED.email, SEED.password);
    const response = await changePassword(app, cookie, {
      currentPassword: SEED.password,
      newPassword: SUCCESS_CANDIDATE,
      confirmPassword: SUCCESS_CANDIDATE,
    });
    assert.equal(response.status, 200);

    const untouched = await signIn(app, "second-user", "Second-password-321!");
    assert.equal(untouched.response.status, 200);
  });
});
