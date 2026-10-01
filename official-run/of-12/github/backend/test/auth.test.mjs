import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore } from "../src/domain/store.mjs";
import {
  isValidEmail,
  isValidPassword,
  isValidUsername,
} from "../src/domain/validation.mjs";

let app;
let dataDir;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-auth-"));
  const store = createAppStore(dataDir);
  const staticRoot = join(dataDir, "static");
  const handler = createRequestHandler({ store, staticRoot });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  app = {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    server,
    async request(path, { method = "GET", body, cookie } = {}) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get("set-cookie") ?? "";
      const text = await response.text();
      return {
        status: response.status,
        cookie: setCookie.split(";")[0],
        body: text ? JSON.parse(text) : null,
      };
    },
  };
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

async function signIn(identifier, password) {
  return app.request("/api/sessions", { method: "POST", body: { identifier, password } });
}

describe("REQ-1-1-1 registration", () => {
  it("reports every violated field at once without creating an account", async () => {
    const response = await app.request("/api/accounts", {
      method: "POST",
      body: {
        username: "-bad-name",
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
    assert.ok(response.body.fields.confirmPassword);

    const attempt = await signIn("-bad-name", "short");
    assert.equal(attempt.status, 401);
  });

  it("rejects a duplicate username but keeps a distinct email usable", async () => {
    const response = await app.request("/api/accounts", {
      method: "POST",
      body: {
        username: "alice-dev",
        email: "alice.second@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.fields.username, "Username already exists");
    assert.equal(response.body.fields.email, undefined);
  });

  it("registers a unique account, marks the email verified and permits sign in", async () => {
    const body = {
      username: "pw-user-901",
      email: "pw-user-901@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    };
    const created = await app.request("/api/accounts", { method: "POST", body });
    assert.equal(created.status, 201);
    assert.equal(created.body.account.username, "pw-user-901");

    const duplicate = await app.request("/api/accounts", {
      method: "POST",
      body: { ...body, username: "pw-user-902" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fields.email, "Email already exists");

    const session = await signIn("pw-user-901@example.test", "Valid-password-123!");
    assert.equal(session.status, 200);
    assert.equal(session.body.user.username, "pw-user-901");
  });

  it("validates the username, email and password rules", () => {
    assert.ok(isValidUsername("a"));
    assert.ok(isValidUsername(`u${"a".repeat(38)}`));
    assert.ok(!isValidUsername(`u${"a".repeat(39)}`));
    assert.ok(!isValidUsername("-lead"));
    assert.ok(!isValidUsername("trail-"));
    assert.ok(!isValidUsername("double--hyphen"));
    assert.ok(!isValidUsername("Upper"));
    assert.ok(!isValidUsername("with space"));

    assert.ok(isValidEmail("  alice.dev@example.test  "));
    assert.ok(!isValidEmail("not-an-email"));
    assert.ok(!isValidEmail("a@b"));
    assert.ok(!isValidEmail("a@.com"));
    assert.ok(!isValidEmail("a@@b.com"));
    assert.ok(!isValidEmail(`${"a".repeat(250)}@example.test`));

    assert.ok(isValidPassword("Valid-password-123!"));
    assert.ok(!isValidPassword("short"));
    assert.ok(!isValidPassword("alllowercase123!"));
    assert.ok(!isValidPassword("ALLUPPERCASE123!"));
    assert.ok(!isValidPassword("NoDigits-here!!"));
    assert.ok(!isValidPassword("NoSpecial123456"));
    assert.ok(!isValidPassword("With space-12345!"));
    assert.ok(isValidPassword("Aa1!".padEnd(128, "b")));
    assert.ok(!isValidPassword("Aa1!".padEnd(129, "b")));
  });
});

describe("REQ-1-1-2 sign in and sessions", () => {
  it("uses the seeded account and returns a generic failure for bad credentials", async () => {
    const wrongPassword = await signIn("alice-dev", "Wrong-password-123!");
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.body.error, "Invalid credentials");

    const unknown = await signIn("nobody-here", "Valid-password-123!");
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, "Invalid credentials");

    const missingUser = await signIn("nobody-here", "Wrong-password-123!");
    assert.deepEqual(missingUser.body, unknown.body);

    const ok = await signIn("alice.dev@example.test", "Valid-password-123!");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.username, "alice-dev");
    assert.match(ok.cookie, /^sid=/);
  });

  it("keeps the session across requests and drops it after sign out", async () => {
    const session = await signIn("alice-dev", "Valid-password-123!");
    const anonymous = await app.request("/api/session");
    assert.equal(anonymous.body.user, null);

    const current = await app.request("/api/session", { cookie: session.cookie });
    assert.equal(current.body.user.username, "alice-dev");

    const signedOut = await app.request("/api/session", { method: "DELETE", cookie: session.cookie });
    assert.equal(signedOut.status, 200);
    assert.equal(signedOut.cookie, "sid=");

    const after = await app.request("/api/session", { cookie: session.cookie });
    assert.equal(after.body.user, null);
  });

  it("answers unknown api routes with an error instead of failing", async () => {
    const response = await app.request("/api/does-not-exist");
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "Not found");
    const asset = await app.request("/missing-asset.js");
    assert.equal(asset.status, 404);
  });
});

describe("REQ-1-1-3 recovery helpers used by the account-access page", () => {
  it("returns the fixed local code for registered and unknown addresses alike", async () => {
    const registered = await app.request("/api/password-recovery/requests", {
      method: "POST",
      body: { email: "alice.dev@example.test" },
    });
    const unknown = await app.request("/api/password-recovery/requests", {
      method: "POST",
      body: { email: "nobody@example.test" },
    });
    assert.equal(registered.body.code, "123456");
    assert.equal(unknown.body.code, "123456");
  });

  it("rejects a wrong code and keeps the old password usable", async () => {
    const failed = await app.request("/api/password-recovery/completions", {
      method: "POST",
      body: {
        email: "alice.dev@example.test",
        code: "000000",
        password: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });
    assert.equal(failed.status, 400);
    assert.equal(failed.body.fields.code, "Verification code is invalid");

    const stillWorks = await signIn("alice-dev", "Valid-password-123!");
    assert.equal(stillWorks.status, 200);
  });

  it("updates the password only for a compliant request", async () => {
    const missingAccount = await app.request("/api/password-recovery/completions", {
      method: "POST",
      body: {
        email: "nobody@example.test",
        code: "123456",
        password: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });
    assert.equal(missingAccount.status, 400);

    const updated = await app.request("/api/password-recovery/completions", {
      method: "POST",
      body: {
        email: "alice.dev@example.test",
        code: "123456",
        password: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });
    assert.equal(updated.status, 200);

    const oldPassword = await signIn("alice-dev", "Valid-password-123!");
    assert.equal(oldPassword.status, 401);
    const newPassword = await signIn("alice-dev", "Replacement-password-456!");
    assert.equal(newPassword.status, 200);
  });
});
