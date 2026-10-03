import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(sharedDataDir) {
  const dataDir = sharedDataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-auth-")));
  const app = await createApp({ dataDir });
  const server = createServer((request, response) => {
    void app.handle(request, response);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    dataDir,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((done) => server.close(done));
    },
  };
}

async function call(base, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text.length > 0 ? JSON.parse(text) : null;
  const setCookie = response.headers.getSetCookie?.() ?? [];
  return {
    status: response.status,
    body: payload,
    sessionCookie: setCookie.map((entry) => entry.split(";")[0]).join("; "),
  };
}

async function signIn(base, identifier, password) {
  return call(base, "/api/session", { method: "POST", body: { identifier, password } });
}

test("pre-provisioned accounts sign in with their seeded credentials", async () => {
  const app = await startApp();
  try {
    for (const [username, email] of [
      ["alice-dev", "alice.dev@example.test"],
      ["recovery-visibility", "recovery-visibility@example.test"],
      ["recovery-invalid-code", "recovery-invalid-code@example.test"],
      ["recovery-success", "recovery-success@example.test"],
    ]) {
      const byUsername = await signIn(app.base, username, "Valid-password-123!");
      assert.equal(byUsername.status, 200, `expected ${username} to sign in`);
      assert.equal(byUsername.body.account.username, username);
      assert.equal(byUsername.body.account.emailVerified, true);

      const byEmail = await signIn(app.base, email, "Valid-password-123!");
      assert.equal(byEmail.status, 200, `expected ${email} to sign in`);
      assert.equal(byEmail.body.account.username, username);
    }
  } finally {
    await app.close();
  }
});

test("registers an account that can immediately sign in", async () => {
  const app = await startApp();
  try {
    const created = await call(app.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "nora-demo",
        email: "nora.demo@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.account.username, "nora-demo");
    assert.equal(created.body.account.emailVerified, true);

    const signedIn = await signIn(app.base, "nora.demo@example.test", "Valid-password-123!");
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.account.username, "nora-demo");

    const session = await call(app.base, "/api/session", { cookie: signedIn.sessionCookie });
    assert.equal(session.body.account.username, "nora-demo");
  } finally {
    await app.close();
  }
});

test("rejects invalid registration input with itemized field messages", async () => {
  const app = await startApp();
  try {
    const response = await call(app.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "-invalid-demo",
        email: "not-an-email",
        password: "short",
        confirmPassword: "different",
        agreeToTerms: false,
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.fields.username, "Username format is invalid");
    assert.equal(response.body.fields.email, "Email format is invalid");
    assert.equal(response.body.fields.password, "Password requirements are not satisfied");
    assert.equal(response.body.fields.terms, "Agree to terms is required");

    const nothingCreated = await signIn(app.base, "-invalid-demo", "short");
    assert.equal(nothingCreated.status, 401);
  } finally {
    await app.close();
  }
});

test("reports each invalid registration field on its own", async () => {
  const app = await startApp();
  try {
    const invalidUsername = await call(app.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "-invalid-demo",
        email: "invalid.username@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(invalidUsername.status, 400);
    assert.deepEqual(Object.keys(invalidUsername.body.fields), ["username"]);
    assert.equal(invalidUsername.body.fields.username, "Username format is invalid");

    const invalidEmail = await call(app.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "invalid-email-demo",
        email: "not-an-email",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(invalidEmail.status, 400);
    assert.deepEqual(Object.keys(invalidEmail.body.fields), ["email"]);
    assert.equal(invalidEmail.body.fields.email, "Email format is invalid");

    const mismatch = await call(app.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "mismatch-demo",
        email: "mismatch.demo@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!-different",
        agreeToTerms: true,
      },
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.fields.confirmPassword, "Password confirmation does not match");
  } finally {
    await app.close();
  }
});

test("refuses duplicate usernames and duplicate emails", async () => {
  const app = await startApp();
  try {
    const duplicateUsername = await call(app.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "alice-dev",
        email: "unused.address@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(duplicateUsername.status, 400);
    assert.equal(duplicateUsername.body.fields.username, "Username already exists");

    const duplicateEmail = await call(app.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "alice-dev-copy",
        email: "alice.dev@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(duplicateEmail.status, 400);
    assert.equal(duplicateEmail.body.fields.email, "Email already exists");

    const stillWorks = await signIn(app.base, "alice-dev", "Valid-password-123!");
    assert.equal(stillWorks.status, 200);
  } finally {
    await app.close();
  }
});

test("sign-in failures share one generic message and create no session", async () => {
  const app = await startApp();
  try {
    const unknown = await signIn(app.base, "unknown@example.test", "Valid-password-123!");
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, "Invalid credentials");
    assert.equal(unknown.sessionCookie, "");

    const wrongPassword = await signIn(app.base, "alice-dev", "Valid-password-123!-wrong");
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.body.error, "Invalid credentials");
    assert.equal(wrongPassword.sessionCookie, "");

    const anonymous = await call(app.base, "/api/session");
    assert.equal(anonymous.body.account, null);
  } finally {
    await app.close();
  }
});

test("a successful session survives reloads until sign-out invalidates it", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "alice-dev", "Valid-password-123!");
    assert.equal(signedIn.status, 200);
    const cookie = signedIn.sessionCookie;
    assert.match(cookie, /^shallowcode_session=/);

    const reload = await call(app.base, "/api/session", { cookie });
    assert.equal(reload.body.account.username, "alice-dev");

    const signedOut = await call(app.base, "/api/session", { method: "DELETE", cookie });
    assert.equal(signedOut.status, 200);
    assert.match(signedOut.sessionCookie, /^shallowcode_session=$/);

    const afterSignOut = await call(app.base, "/api/session", { cookie });
    assert.equal(afterSignOut.body.account, null);
  } finally {
    await app.close();
  }
});

test("password recovery shows the fixed code for known and unknown addresses", async () => {
  const app = await startApp();
  try {
    const known = await call(app.base, "/api/password/forgot", {
      method: "POST",
      body: { email: "recovery-visibility@example.test" },
    });
    assert.equal(known.status, 200);
    assert.equal(known.body.verificationCode, "123456");

    const unknown = await call(app.base, "/api/password/forgot", {
      method: "POST",
      body: { email: "unknown@example.test" },
    });
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body, { email: "unknown@example.test", verificationCode: "123456" });
  } finally {
    await app.close();
  }
});

test("a wrong verification code keeps the original password usable", async () => {
  const app = await startApp();
  try {
    const rejected = await call(app.base, "/api/password/reset", {
      method: "POST",
      body: {
        email: "recovery-invalid-code@example.test",
        code: "000000",
        newPassword: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fields.code, "Verification code is invalid");

    const originalPassword = await signIn(app.base, "recovery-invalid-code@example.test", "Valid-password-123!");
    assert.equal(originalPassword.status, 200);
    assert.equal(originalPassword.body.account.username, "recovery-invalid-code");

    const replacement = await signIn(app.base, "recovery-invalid-code@example.test", "Replacement-password-456!");
    assert.equal(replacement.status, 401);
  } finally {
    await app.close();
  }
});

test("a correct verification code updates the account password", async () => {
  const app = await startApp();
  try {
    const reset = await call(app.base, "/api/password/reset", {
      method: "POST",
      body: {
        email: "recovery-success@example.test",
        code: "123456",
        newPassword: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.message, "Password updated");

    const newPassword = await signIn(app.base, "recovery-success@example.test", "Replacement-password-456!");
    assert.equal(newPassword.status, 200);
    assert.equal(newPassword.body.account.username, "recovery-success");

    const oldPassword = await signIn(app.base, "recovery-success@example.test", "Valid-password-123!");
    assert.equal(oldPassword.status, 401);
  } finally {
    await app.close();
  }
});

test("a password reset immediately invalidates existing sessions", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "recovery-success", "Valid-password-123!");
    const cookie = signedIn.sessionCookie;
    assert.equal((await call(app.base, "/api/session", { cookie })).body.account.username, "recovery-success");

    await call(app.base, "/api/password/reset", {
      method: "POST",
      body: {
        email: "recovery-success@example.test",
        code: "123456",
        newPassword: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });

    assert.equal((await call(app.base, "/api/session", { cookie })).body.account, null);
  } finally {
    await app.close();
  }
});

test("a non-compliant new password is rejected without touching the account", async () => {
  const app = await startApp();
  try {
    const rejected = await call(app.base, "/api/password/reset", {
      method: "POST",
      body: {
        email: "recovery-success@example.test",
        code: "123456",
        newPassword: "short",
        confirmPassword: "short",
      },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fields.password, "Password requirements are not satisfied");

    const original = await signIn(app.base, "recovery-success", "Valid-password-123!");
    assert.equal(original.status, 200);
  } finally {
    await app.close();
  }
});

test("username, email and password rules match the requirement", async () => {
  const app = await startApp();
  const attempt = (username) => call(app.base, "/api/accounts", {
    method: "POST",
    body: {
      username,
      email: `${username}-mail@example.test`,
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    },
  });
  try {
    const cases = [
      ["a".repeat(39), 201],
      ["a".repeat(40), 400],
      ["-leading", 400],
      ["trailing-", 400],
      ["double--hyphen", 400],
      ["Upper-Case", 400],
      ["under_score", 400],
      ["dot.name", 400],
      ["", 400],
    ];
    for (const [username, expected] of cases) {
      const response = await attempt(username);
      assert.equal(response.status, expected, `username ${JSON.stringify(username)}`);
    }

    const emailCases = [
      [`${"a".repeat(240)}@example.test`, 201],
      [`${"a".repeat(244)}@example.test`, 400],
      ["user@example", 400],
      ["user@example.", 400],
      ["user@@example.test", 400],
      ["user@.test", 400],
      ["user.example.test", 400],
    ];
    let index = 0;
    for (const [email, expected] of emailCases) {
      index += 1;
      const response = await call(app.base, "/api/accounts", {
        method: "POST",
        body: {
          username: `email-case-${index}`,
          email,
          password: "Valid-password-123!",
          confirmPassword: "Valid-password-123!",
          agreeToTerms: true,
        },
      });
      assert.equal(response.status, expected, `email ${JSON.stringify(email)}`);
    }

    const passwordCases = [
      ["Valid-pass-12", 201],
      ["Valid-pas1!", 400],
      ["valid-password-123!", 400],
      ["VALID-PASSWORD-123!", 400],
      ["Valid-password-abc!", 400],
      ["ValidPassword123", 400],
      ["Valid-password 123!", 400],
      [`${'A'.repeat(125)}1!a`, 201],
      [`${'A'.repeat(126)}1!a`, 400],
      ["Valid-password-!23", 201],
    ];
    index = 0;
    for (const [password, expected] of passwordCases) {
      index += 1;
      const response = await call(app.base, "/api/accounts", {
        method: "POST",
        body: {
          username: `password-case-${index}`,
          email: `password-case-${index}@example.test`,
          password,
          confirmPassword: password,
          agreeToTerms: true,
        },
      });
      assert.equal(response.status, expected, `password ${JSON.stringify(password)}`);
    }

    const withWhitespace = await call(app.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "  trimmed-user  ",
        email: "  trimmed@example.test  ",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(withWhitespace.status, 201);
    assert.equal(withWhitespace.body.account.username, "trimmed-user");
    assert.equal(withWhitespace.body.account.email, "trimmed@example.test");
  } finally {
    await app.close();
  }
});

test("registration input is never echoed as a password", async () => {
  const app = await startApp();
  try {
    const response = await call(app.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "alice-dev",
        email: "alice.dev@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(JSON.stringify(response.body).includes("Valid-password-123!"), false);
  } finally {
    await app.close();
  }
});

test("seeded accounts and user registrations survive a restart", async () => {
  const first = await startApp();
  const dataDir = first.dataDir;
  try {
    const created = await call(first.base, "/api/accounts", {
      method: "POST",
      body: {
        username: "persisted-user",
        email: "persisted@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(created.status, 201);
  } finally {
    await first.close();
  }

  const second = await startApp(dataDir);
  try {
    const seeded = await signIn(second.base, "alice-dev", "Valid-password-123!");
    assert.equal(seeded.status, 200);

    const persisted = await signIn(second.base, "persisted-user", "Valid-password-123!");
    assert.equal(persisted.status, 200);
  } finally {
    await second.close();
  }
});

test("changes the signed-in account password and applies it to later sign-ins", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "password-change-success", "Valid-password-123!");
    assert.equal(signedIn.status, 200);

    const changed = await call(app.base, "/api/password/change", {
      method: "POST",
      cookie: signedIn.sessionCookie,
      body: {
        currentPassword: "Valid-password-123!",
        newPassword: "New-password-456!",
        confirmPassword: "New-password-456!",
      },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.message, "Password updated");
    assert.equal(JSON.stringify(changed.body).includes("New-password-456!"), false);

    const withNew = await signIn(app.base, "password-change-success@example.test", "New-password-456!");
    assert.equal(withNew.status, 200);
    assert.equal(withNew.body.account.username, "password-change-success");

    const withOld = await signIn(app.base, "password-change-success@example.test", "Valid-password-123!");
    assert.equal(withOld.status, 401);

    // A different account keeps its own password.
    const other = await signIn(app.base, "password-change-invalid", "Valid-password-123!");
    assert.equal(other.status, 200);
  } finally {
    await app.close();
  }
});

test("a successful password change ends the current session", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "password-change-success", "Valid-password-123!");
    const cookie = signedIn.sessionCookie;
    assert.equal((await call(app.base, "/api/session", { cookie })).body.account.username, "password-change-success");

    await call(app.base, "/api/password/change", {
      method: "POST",
      cookie,
      body: {
        currentPassword: "Valid-password-123!",
        newPassword: "New-password-456!",
        confirmPassword: "New-password-456!",
      },
    });

    assert.equal((await call(app.base, "/api/session", { cookie })).body.account, null);
  } finally {
    await app.close();
  }
});

test("refuses an incorrect current password and precedence keeps the old password usable", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "password-change-invalid", "Valid-password-123!");
    const cookie = signedIn.sessionCookie;

    const rejected = await call(app.base, "/api/password/change", {
      method: "POST",
      cookie,
      body: {
        currentPassword: "Valid-password-123!-wrong",
        newPassword: "Another-valid-password-123!",
        confirmPassword: "does-not-match",
      },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fields.currentPassword, "Current password is incorrect");
    assert.deepEqual(Object.keys(rejected.body.fields), ["currentPassword"]);

    assert.equal((await signIn(app.base, "password-change-invalid@example.test", "Valid-password-123!")).status, 200);
    assert.equal((await signIn(app.base, "password-change-invalid@example.test", "Another-valid-password-123!")).status, 401);
    assert.equal((await call(app.base, "/api/session", { cookie })).body.account.username, "password-change-invalid");
  } finally {
    await app.close();
  }
});

test("requires the current password and reports it in its own field", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "password-change-required", "Valid-password-123!");
    const cookie = signedIn.sessionCookie;

    const rejected = await call(app.base, "/api/password/change", {
      method: "POST",
      cookie,
      body: {
        currentPassword: "",
        newPassword: "Required-password-789!",
        confirmPassword: "Required-password-789!",
      },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fields.currentPassword, "Current password is required");

    assert.equal((await signIn(app.base, "password-change-required@example.test", "Valid-password-123!")).status, 200);
    assert.equal((await signIn(app.base, "password-change-required@example.test", "Required-password-789!")).status, 401);
  } finally {
    await app.close();
  }
});

test("rejects a non-compliant new password and a mismatched confirmation", async () => {
  const app = await startApp();
  try {
    const signedIn = await signIn(app.base, "password-change-success", "Valid-password-123!");
    const cookie = signedIn.sessionCookie;

    const weak = await call(app.base, "/api/password/change", {
      method: "POST",
      cookie,
      body: { currentPassword: "Valid-password-123!", newPassword: "short", confirmPassword: "short" },
    });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.fields.newPassword, "Password requirements are not satisfied");

    const mismatch = await call(app.base, "/api/password/change", {
      method: "POST",
      cookie,
      body: {
        currentPassword: "Valid-password-123!",
        newPassword: "Another-valid-password-123!",
        confirmPassword: "does-not-match",
      },
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.fields.confirmPassword, "Password confirmation does not match");

    assert.equal((await signIn(app.base, "password-change-success", "Valid-password-123!")).status, 200);
  } finally {
    await app.close();
  }
});

test("refuses to change a password without a session", async () => {
  const app = await startApp();
  try {
    const rejected = await call(app.base, "/api/password/change", {
      method: "POST",
      body: {
        currentPassword: "Valid-password-123!",
        newPassword: "New-password-456!",
        confirmPassword: "New-password-456!",
      },
    });
    assert.equal(rejected.status, 401);
    assert.equal((await signIn(app.base, "password-change-success", "Valid-password-123!")).status, 200);
  } finally {
    await app.close();
  }
});

test("health checks and unknown paths behave like the platform contract", async () => {
  const app = await startApp();
  try {
    assert.equal((await call(app.base, "/health")).body.ok, true);
    assert.equal((await call(app.base, "/api/health")).body.ok, true);
    assert.equal((await call(app.base, "/api/unknown")).status, 404);
    assert.equal((await call(app.base, "/favicon.ico")).status, 404);
    assert.equal((await call(app.base, "/does-not-exist.js")).status, 404);
    assert.equal((await call(app.base, "/api/session", { method: "PUT" })).status, 404);
    assert.equal((await call(app.base, "/api/accounts", { method: "POST", body: undefined })).status, 400);
  } finally {
    await app.close();
  }
});
