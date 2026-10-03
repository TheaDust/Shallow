import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(sharedDataDir) {
  const dataDir = sharedDataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-visibility-")));
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
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
    sessionCookie: (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; "),
  };
}

async function signIn(base, identifier) {
  return call(base, "/api/session", { method: "POST", body: { identifier, password: "Valid-password-123!" } });
}

const REPOSITORY = "/api/repositories/acme-demo/visibility-demo";

test("an Admin persists a visibility change that later visitors and searches observe", async () => {
  const first = await startApp();
  const dataDir = first.dataDir;
  try {
    const anonymous = await call(first.base, REPOSITORY);
    assert.equal(anonymous.status, 403);

    const admin = await signIn(first.base, "visibility-admin");
    const before = await call(first.base, REPOSITORY, { cookie: admin.sessionCookie });
    assert.equal(before.body.repository.visibility, "private");
    assert.equal(before.body.repository.role, "admin");

    const changed = await call(first.base, `${REPOSITORY}/visibility`, {
      method: "POST",
      cookie: admin.sessionCookie,
      body: { visibility: "public" },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.repository.visibility, "public");
  } finally {
    await first.close();
  }

  const restarted = await startApp(dataDir);
  try {
    const anonymous = await call(restarted.base, REPOSITORY);
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.body.repository.visibility, "public");

    const searched = await call(restarted.base, "/api/search/repositories?q=visibility-demo");
    assert.deepEqual(searched.body.repositories.map((repository) => repository.name), ["visibility-demo"]);
  } finally {
    await restarted.close();
  }
});

test("a non-admin collaborator and an anonymous visitor are refused the change", async () => {
  const app = await startApp();
  try {
    const anonymous = await call(app.base, `${REPOSITORY}/visibility`, {
      method: "POST",
      body: { visibility: "public" },
    });
    assert.equal(anonymous.status, 401);

    const collaborator = await signIn(app.base, "collaborator");
    const readable = await call(app.base, REPOSITORY, { cookie: collaborator.sessionCookie });
    assert.equal(readable.status, 200);
    assert.equal(readable.body.repository.role, "write");

    const refused = await call(app.base, `${REPOSITORY}/visibility`, {
      method: "POST",
      cookie: collaborator.sessionCookie,
      body: { visibility: "public" },
    });
    assert.equal(refused.status, 403);

    const unchanged = await call(app.base, REPOSITORY, { cookie: collaborator.sessionCookie });
    assert.equal(unchanged.body.repository.visibility, "private");
  } finally {
    await app.close();
  }
});

test("an invalid visibility is rejected without touching the stored value", async () => {
  const app = await startApp();
  try {
    const admin = await signIn(app.base, "visibility-admin");
    const invalid = await call(app.base, `${REPOSITORY}/visibility`, {
      method: "POST",
      cookie: admin.sessionCookie,
      body: { visibility: "internal" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fields.visibility, "Visibility is invalid");

    const stored = await call(app.base, REPOSITORY, { cookie: admin.sessionCookie });
    assert.equal(stored.body.repository.visibility, "private");
  } finally {
    await app.close();
  }
});
