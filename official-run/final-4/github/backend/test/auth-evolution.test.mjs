import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-auth-evolution-"));
  const store = createAuthStore(dataDir);
  const handler = createRequestHandler({ store, staticRoot: join(dataDir, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
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

function collectCookie(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

function registerBody(overrides = {}) {
  return {
    username: "evo_user_01",
    email: "evo.register.s1@evolution.test",
    password: "Evo-Password-987!",
    confirmPassword: "Evo-Password-987!",
    agreeToTerms: true,
    ...overrides,
  };
}

test("registers an underscore username and signs in with the email afterwards", async () => {
  const app = await startApp();
  try {
    const registered = await post(app.baseUrl, "/api/auth/register", registerBody());
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.user.username, "evo_user_01");

    const signedIn = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "evo.register.s1@evolution.test",
      password: "Evo-Password-987!",
    });
    assert.equal(signedIn.response.status, 200);
    assert.equal(signedIn.body.user.username, "evo_user_01");

    const session = await fetch(`${app.baseUrl}/api/session`, {
      headers: { cookie: signedIn.cookie },
    });
    assert.equal((await session.json()).user.username, "evo_user_01");
  } finally {
    await app.close();
  }
});

test("rejects uppercase, doubled and edge separators in a username", async () => {
  const app = await startApp();
  try {
    const invalid = ["EvoUpper01", "evo--user", "evo__user", "_leading", "trailing_", "-leading"];
    for (const [index, username] of invalid.entries()) {
      const response = await post(
        app.baseUrl,
        "/api/auth/register",
        registerBody({ username, email: `format-check-${index}@evolution.test` }),
      );
      assert.equal(response.response.status, 400, username);
      assert.equal(response.body.fieldErrors.username, "Username format is invalid", username);
    }
  } finally {
    await app.close();
  }
});

test("rejects the pre-provisioned username with the unused email", async () => {
  const app = await startApp();
  try {
    const response = await post(
      app.baseUrl,
      "/api/auth/register",
      registerBody({ username: "evo-register-existing", email: "evo.register.s3@evolution.test" }),
    );
    assert.equal(response.response.status, 400);
    assert.deepEqual(response.body.fieldErrors, { username: "Username already exists" });

    const withSeedPassword = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "evo.register.existing@evolution.test",
      password: "Evo-Password-987!",
    });
    assert.equal(withSeedPassword.response.status, 200);
    assert.equal(withSeedPassword.body.user.username, "evo-register-existing");
  } finally {
    await app.close();
  }
});

test("signs in an existing account with any casing of its email", async () => {
  const app = await startApp();
  try {
    const exact = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "evo-login-case",
      password: "Evo-Password-987!",
    });
    assert.equal(exact.response.status, 200);
    assert.equal(exact.body.user.username, "evo-login-case");

    const upper = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "EVO.LOGIN.CASE@EVOLUTION.TEST",
      password: "Evo-Password-987!",
    });
    assert.equal(upper.response.status, 200);
    assert.equal(upper.body.user.username, "evo-login-case");

    const wrongPassword = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "evo.login.case@evolution.test",
      password: "Evo-Password-987!-incorrect",
    });
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(wrongPassword.body.message, "Invalid credentials");
    assert.equal(wrongPassword.cookie, "");
  } finally {
    await app.close();
  }
});

test("keeps username lookup exact while the email ignores case", async () => {
  const app = await startApp();
  try {
    const response = await post(app.baseUrl, "/api/auth/sign-in", {
      identifier: "EVO-LOGIN-CASE",
      password: "Evo-Password-987!",
    });
    assert.equal(response.response.status, 401);
    assert.equal(response.body.message, "Invalid credentials");
  } finally {
    await app.close();
  }
});
