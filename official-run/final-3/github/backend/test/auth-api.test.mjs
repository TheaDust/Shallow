import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-auth-"));
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

function collectCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

test("registers a new account, then signs in with that account", async () => {
  const app = await startApp();
  try {
    const username = "fresh-demo";
    const email = "fresh.demo@example.test";
    const registered = await post(app.baseUrl, "/api/auth/register", {
      username,
      email,
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.user.username, username);

    const signedIn = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: email,
      password: "Valid-password-123!",
    });
    assert.equal(signedIn.response.status, 200);
    assert.equal(signedIn.body.user.username, username);

    const session = await fetch(`${app.baseUrl}/api/session`, {
      headers: { cookie: signedIn.cookie },
    });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).user.username, username);
  } finally {
    await app.close();
  }
});

test("rejects a duplicate username while keeping every other field usable", async () => {
  const app = await startApp();
  try {
    const response = await post(app.baseUrl, "/api/auth/register", {
      username: "alice-dev",
      email: "different.alice@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.body.fieldErrors.username, "Username already exists");
  } finally {
    await app.close();
  }
});

test("reports all invalid registration fields together", async () => {
  const app = await startApp();
  try {
    const response = await post(app.baseUrl, "/api/auth/register", {
      username: "-invalid-demo",
      email: "not-an-email",
      password: "short",
      confirmPassword: "different",
      agreeToTerms: false,
    });
    assert.equal(response.response.status, 400);
    assert.deepEqual(response.body.fieldErrors, {
      username: "Username format is invalid",
      email: "Email format is invalid",
      password: "Password requirements are not satisfied",
      confirmPassword: "Password confirmation does not match",
      terms: "Agree to terms is required",
    });
  } finally {
    await app.close();
  }
});

test("returns the same generic failure for an unknown account and a bad password", async () => {
  const app = await startApp();
  try {
    const unknown = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "unknown@example.test",
      password: "Valid-password-123!",
    });
    assert.equal(unknown.response.status, 401);
    assert.equal(unknown.body.message, "Invalid credentials");
    assert.equal(unknown.cookie, "");

    const wrongPassword = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "alice-dev",
      password: "Valid-password-123!-wrong",
    });
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(wrongPassword.body.message, "Invalid credentials");
  } finally {
    await app.close();
  }
});

test("recovery rejects a wrong code and accepts the fixed code", async () => {
  const app = await startApp();
  try {
    const requested = await post(app.baseUrl, "/api/auth/password-reset/request", {
      email: "unknown@example.test",
    });
    assert.equal(requested.response.status, 200);
    assert.equal(requested.body.code, "123456");

    const wrong = await post(app.baseUrl, "/api/auth/password-reset", {
      email: "recovery-invalid-code@example.test",
      code: "000000",
      newPassword: "Replacement-password-456!",
      confirmPassword: "Replacement-password-456!",
    });
    assert.equal(wrong.response.status, 400);
    assert.equal(wrong.body.fieldErrors.code, "Verification code is invalid");

    const original = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "recovery-invalid-code@example.test",
      password: "Valid-password-123!",
    });
    assert.equal(original.response.status, 200);

    const applied = await post(app.baseUrl, "/api/auth/password-reset", {
      email: "recovery-success@example.test",
      code: "123456",
      newPassword: "Replacement-password-456!",
      confirmPassword: "Replacement-password-456!",
    });
    assert.equal(applied.response.status, 200);
    assert.equal(applied.body.message, "Password updated");

    const newPassword = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "recovery-success@example.test",
      password: "Replacement-password-456!",
    });
    assert.equal(newPassword.response.status, 200);
    assert.equal(newPassword.body.user.username, "recovery-success");

    const oldPassword = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "recovery-success@example.test",
      password: "Valid-password-123!",
    });
    assert.equal(oldPassword.response.status, 401);
  } finally {
    await app.close();
  }
});

test("unknown api paths and missing static assets answer 404 without crashing", async () => {
  const app = await startApp();
  try {
    const health = await fetch(`${app.baseUrl}/health`);
    assert.equal(health.status, 200);

    const unknownApi = await fetch(`${app.baseUrl}/api/does-not-exist`);
    assert.equal(unknownApi.status, 404);

    const favicon = await fetch(`${app.baseUrl}/favicon.ico`);
    assert.equal(favicon.status, 404);
  } finally {
    await app.close();
  }
});

test("registers an account whose username holds a single underscore", async () => {
  const app = await startApp();
  try {
    const registered = await post(app.baseUrl, "/api/auth/register", {
      username: "evo_user_01",
      email: "evo.register.s1@evolution.test",
      password: "Evo-Password-987!",
      confirmPassword: "Evo-Password-987!",
      agreeToTerms: true,
    });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.user.username, "evo_user_01");

    const signedIn = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "evo.register.s1@evolution.test",
      password: "Evo-Password-987!",
    });
    assert.equal(signedIn.response.status, 200);
    assert.equal(signedIn.body.user.username, "evo_user_01");
  } finally {
    await app.close();
  }
});

test("rejects an uppercase username and repeated separators without creating an account", async () => {
  const app = await startApp();
  try {
    const candidates = ["EvoUpper01", "evo--user", "evo__user", "_evo_user", "evo_user_"];
    for (const [index, username] of candidates.entries()) {
      const email = `evo.register.invalid${index}@evolution.test`;
      const response = await post(app.baseUrl, "/api/auth/register", {
        username,
        email,
        password: "Evo-Password-987!",
        confirmPassword: "Evo-Password-987!",
        agreeToTerms: true,
      });
      assert.equal(response.response.status, 400, username);
      assert.equal(response.body.fieldErrors.username, "Username format is invalid", username);

      const signIn = await post(app.baseUrl, "/api/auth/sign-in", { identifier: email, password: "Evo-Password-987!" });
      assert.equal(signIn.response.status, 401, `${username} must not create an account`);
    }
  } finally {
    await app.close();
  }
});

test("rejects the seeded duplicate username while the unused email stays free", async () => {
  const app = await startApp();
  try {
    const response = await post(app.baseUrl, "/api/auth/register", {
      username: "evo-register-existing",
      email: "evo.register.s3@evolution.test",
      password: "Evo-Password-987!",
      confirmPassword: "Evo-Password-987!",
      agreeToTerms: true,
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.body.fieldErrors.username, "Username already exists");
    assert.equal(response.body.fieldErrors.email, undefined);

    const unusedEmail = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "evo.register.s3@evolution.test",
      password: "Evo-Password-987!",
    });
    assert.equal(unusedEmail.response.status, 401);

    const seeded = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "evo-register-existing",
      password: "Evo-Password-987!",
    });
    assert.equal(seeded.response.status, 200);
    assert.equal(seeded.body.user.username, "evo-register-existing");
  } finally {
    await app.close();
  }
});

test("signs in with any casing of the seeded email while the username lookup stays exact", async () => {
  const app = await startApp();
  try {
    const upper = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "EVO.LOGIN.CASE@EVOLUTION.TEST",
      password: "Evo-Password-987!",
    });
    assert.equal(upper.response.status, 200);
    assert.equal(upper.body.user.username, "evo-login-case");

    const exact = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "evo-login-case",
      password: "Evo-Password-987!",
    });
    assert.equal(exact.response.status, 200);
    assert.equal(exact.body.user.username, "evo-login-case");

    const wrongCase = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "EVO-LOGIN-CASE",
      password: "Evo-Password-987!",
    });
    assert.equal(wrongCase.response.status, 401);
    assert.equal(wrongCase.body.message, "Invalid credentials");
  } finally {
    await app.close();
  }
});