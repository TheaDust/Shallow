import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore, createSeedData } from "../src/domain/store.mjs";

const SEEDED_ACCOUNT_COUNT = createSeedData().accounts.length;

const ALICE = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

let harness;

async function startHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallow-password-"));
  const store = createAppStore(dataDir);
  const handler = createRequestHandler({ store, staticRoot: join(dataDir, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    server,
    baseUrl,
    async request(path, { method = "GET", body, cookie } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return {
        status: response.status,
        cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
        body: text ? JSON.parse(text) : null,
      };
    },
    async signIn(identifier, password) {
      return this.request("/api/sessions", { method: "POST", body: { identifier, password } });
    },
    async readData() {
      return JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
    },
  };
}

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await new Promise((resolve) => harness.server.close(resolve));
  await rm(harness.dataDir, { recursive: true, force: true });
});

describe("REQ-1-3 change account password", () => {
  it("requires an authenticated session", async () => {
    const anonymous = await harness.request("/api/account/password", {
      method: "POST",
      body: {
        currentPassword: ALICE.password,
        newPassword: "New-password-456!",
        confirmPassword: "New-password-456!",
      },
    });
    assert.equal(anonymous.status, 401);

    const stillOld = await harness.signIn(ALICE.username, ALICE.password);
    assert.equal(stillOld.status, 200);
  });

  it("reports a missing current password and applies nothing", async () => {
    const session = await harness.signIn(ALICE.username, ALICE.password);
    const response = await harness.request("/api/account/password", {
      method: "POST",
      cookie: session.cookie,
      body: {
        currentPassword: "",
        newPassword: "Required-password-789!",
        confirmPassword: "Required-password-789!",
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.fields.currentPassword, "Current password is required");

    const oldPassword = await harness.signIn(ALICE.username, ALICE.password);
    assert.equal(oldPassword.status, 200);
    const candidate = await harness.signIn(ALICE.username, "Required-password-789!");
    assert.equal(candidate.status, 401);
  });

  it("rejects a wrong current password or a mismatching confirmation", async () => {
    const session = await harness.signIn(ALICE.username, ALICE.password);

    const wrongCurrent = await harness.request("/api/account/password", {
      method: "POST",
      cookie: session.cookie,
      body: {
        currentPassword: "Wrong-password-000!",
        newPassword: "New-password-456!",
        confirmPassword: "New-password-456!",
      },
    });
    assert.equal(wrongCurrent.status, 400);
    assert.equal(wrongCurrent.body.fields.currentPassword, "Current password is incorrect");

    const mismatch = await harness.request("/api/account/password", {
      method: "POST",
      cookie: session.cookie,
      body: {
        currentPassword: ALICE.password,
        newPassword: "New-password-456!",
        confirmPassword: "does-not-match",
      },
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.fields.confirmPassword, "Password confirmation does not match");

    const noncompliant = await harness.request("/api/account/password", {
      method: "POST",
      cookie: session.cookie,
      body: {
        currentPassword: ALICE.password,
        newPassword: "short",
        confirmPassword: "short",
      },
    });
    assert.equal(noncompliant.status, 400);
    assert.equal(noncompliant.body.fields.newPassword, "Password requirements are not satisfied");

    const oldPassword = await harness.signIn(ALICE.username, ALICE.password);
    assert.equal(oldPassword.status, 200);
    const candidate = await harness.signIn(ALICE.username, "New-password-456!");
    assert.equal(candidate.status, 401);
  });

  it("updates only the current account and applies the new password immediately", async () => {
    const created = await harness.request("/api/accounts", {
      method: "POST",
      body: {
        username: "bob-dev",
        email: "bob.dev@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      },
    });
    assert.equal(created.status, 201);

    const session = await harness.signIn(ALICE.username, ALICE.password);
    const changed = await harness.request("/api/account/password", {
      method: "POST",
      cookie: session.cookie,
      body: {
        currentPassword: ALICE.password,
        newPassword: "New-password-456!",
        confirmPassword: "New-password-456!",
      },
    });
    assert.equal(changed.status, 200);

    const oldPassword = await harness.signIn(ALICE.username, ALICE.password);
    assert.equal(oldPassword.status, 401);
    const newPassword = await harness.signIn(ALICE.username, "New-password-456!");
    assert.equal(newPassword.status, 200);
    assert.equal(newPassword.body.user.username, ALICE.username);

    // The other account keeps its own credentials and the session stays usable.
    const otherAccount = await harness.signIn("bob-dev", "Valid-password-123!");
    assert.equal(otherAccount.status, 200);
    const current = await harness.request("/api/session", { cookie: session.cookie });
    assert.equal(current.body.user.username, ALICE.username);
  });
});

describe("REQ-1-1-3 recovery keeps accounts and sessions consistent", () => {
  it("leaves the account untouched for an unknown email and creates no extra account", async () => {
    const unknown = await harness.request("/api/password-recovery/completions", {
      method: "POST",
      body: {
        email: "nobody@example.test",
        code: "123456",
        password: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });
    assert.equal(unknown.status, 400);
    assert.ok(unknown.body.fields.email);

    const oldPassword = await harness.signIn(ALICE.username, ALICE.password);
    assert.equal(oldPassword.status, 200);
    const candidate = await harness.signIn(ALICE.username, "Replacement-password-456!");
    assert.equal(candidate.status, 401);

    const data = await harness.readData();
    assert.equal(data.accounts.length, SEEDED_ACCOUNT_COUNT);
    assert.equal(data.accounts.some((account) => account.email === "nobody@example.test"), false);
  });

  it("reports the wrong code without writing and applies a compliant reset", async () => {
    const wrongCode = await harness.request("/api/password-recovery/completions", {
      method: "POST",
      body: {
        email: ALICE.email,
        code: "000000",
        password: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });
    assert.equal(wrongCode.status, 400);
    assert.equal(wrongCode.body.fields.code, "Verification code is invalid");

    const mismatched = await harness.request("/api/password-recovery/completions", {
      method: "POST",
      body: {
        email: ALICE.email,
        code: "123456",
        password: "Replacement-password-456!",
        confirmPassword: "different-password-456!",
      },
    });
    assert.equal(mismatched.status, 400);
    assert.ok(mismatched.body.fields.confirmPassword);

    const oldPassword = await harness.signIn(ALICE.username, ALICE.password);
    assert.equal(oldPassword.status, 200);

    const reset = await harness.request("/api/password-recovery/completions", {
      method: "POST",
      body: {
        email: ALICE.email,
        code: "123456",
        password: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });
    assert.equal(reset.status, 200);

    assert.equal((await harness.signIn(ALICE.username, ALICE.password)).status, 401);
    assert.equal((await harness.signIn(ALICE.email, "Replacement-password-456!")).status, 200);
    assert.equal((await harness.readData()).accounts.length, SEEDED_ACCOUNT_COUNT);
  });

  it("ends sessions opened with the replaced password", async () => {
    const session = await harness.signIn(ALICE.username, ALICE.password);
    assert.equal((await harness.request("/api/session", { cookie: session.cookie })).body.user.username, ALICE.username);

    const reset = await harness.request("/api/password-recovery/completions", {
      method: "POST",
      body: {
        email: ALICE.email,
        code: "123456",
        password: "Replacement-password-456!",
        confirmPassword: "Replacement-password-456!",
      },
    });
    assert.equal(reset.status, 200);

    const afterReset = await harness.request("/api/session", { cookie: session.cookie });
    assert.equal(afterReset.body.user, null);
  });
});
