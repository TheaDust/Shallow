import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(sharedDataDir) {
  const dataDir = sharedDataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-access-")));
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

test("an Admin grants a team Write access that persists across restart", async () => {
  const first = await startApp();
  const dataDir = first.dataDir;
  try {
    const admin = await signIn(first.base, "repo-admin");

    const before = await call(first.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: admin.sessionCookie });
    assert.equal(before.status, 200);
    assert.ok(!before.body.access.some((entry) => entry.subjectName === "frontend-team"));
    assert.ok(before.body.candidates.teams.includes("frontend-team"));

    const granted = await call(first.base, "/api/repositories/acme-demo/acme-docs/access", {
      method: "POST",
      cookie: admin.sessionCookie,
      body: { subjectType: "team", name: "frontend-team", role: "write" },
    });
    assert.equal(granted.status, 200);
    const row = granted.body.access.find((entry) => entry.subjectName === "frontend-team");
    assert.equal(row.role, "write");
    assert.equal(row.subjectType, "team");

    const reloaded = await call(first.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: admin.sessionCookie });
    assert.equal(reloaded.body.access.filter((entry) => entry.subjectName === "frontend-team").length, 1);

    const invalid = await call(first.base, "/api/repositories/acme-demo/acme-docs/access", {
      method: "POST",
      cookie: admin.sessionCookie,
      body: { subjectType: "team", name: "frontend-team", role: "owner" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fields.role, "Role is invalid");

    const unknownTeam = await call(first.base, "/api/repositories/acme-demo/acme-docs/access", {
      method: "POST",
      cookie: admin.sessionCookie,
      body: { subjectType: "team", name: "missing-team", role: "write" },
    });
    assert.equal(unknownTeam.status, 400);
    assert.equal(unknownTeam.body.fields.name, "Team not found");
  } finally {
    await first.close();
  }

  const second = await startApp(dataDir);
  try {
    const admin = await signIn(second.base, "repo-admin");
    const access = await call(second.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: admin.sessionCookie });
    const rows = access.body.access.filter((entry) => entry.subjectName === "frontend-team");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "write");
  } finally {
    await second.close();
  }
});

test("changing a role updates the existing grant and never duplicates it", async () => {
  const first = await startApp();
  const dataDir = first.dataDir;
  try {
    const admin = await signIn(first.base, "repo-admin");
    const before = await call(first.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: admin.sessionCookie });
    const rows = before.body.access.filter((entry) => entry.subjectName === "access-role-team");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "write");

    const updated = await call(first.base, `/api/repositories/acme-demo/acme-docs/access/${rows[0].id}`, {
      method: "PATCH",
      cookie: admin.sessionCookie,
      body: { role: "read" },
    });
    assert.equal(updated.status, 200);
    const after = updated.body.access.filter((entry) => entry.subjectName === "access-role-team");
    assert.equal(after.length, 1);
    assert.equal(after[0].role, "read");
    assert.equal(after[0].id, rows[0].id);

    const reloaded = await call(first.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: admin.sessionCookie });
    const persisted = reloaded.body.access.filter((entry) => entry.subjectName === "access-role-team");
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].role, "read");
  } finally {
    await first.close();
  }

  const second = await startApp(dataDir);
  try {
    const admin = await signIn(second.base, "repo-admin");
    const access = await call(second.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: admin.sessionCookie });
    const rows = access.body.access.filter((entry) => entry.subjectName === "access-role-team");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "read");
  } finally {
    await second.close();
  }
});

test("team access grants reach the team members on a private repository", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.base, "org-owner");
    const reviewer = await signIn(app.base, "bob-reviewer");

    assert.equal(
      (await call(app.base, "/api/repositories/acme-demo/secret-research", { cookie: reviewer.sessionCookie })).status,
      403,
    );

    const granted = await call(app.base, "/api/repositories/acme-demo/secret-research/access", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { subjectType: "team", name: "frontend-team", role: "read" },
    });
    assert.equal(granted.status, 200);

    await call(app.base, "/api/organizations/acme-demo/teams/frontend-team/members", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { username: "bob-reviewer" },
    });

    assert.equal(
      (await call(app.base, "/api/repositories/acme-demo/secret-research", { cookie: reviewer.sessionCookie })).status,
      200,
    );

    await call(app.base, "/api/organizations/acme-demo/teams/frontend-team/members/bob-reviewer", {
      method: "DELETE",
      cookie: owner.sessionCookie,
    });
    assert.equal(
      (await call(app.base, "/api/repositories/acme-demo/secret-research", { cookie: reviewer.sessionCookie })).status,
      403,
    );
  } finally {
    await app.close();
  }
});

test("only an Admin may read or change repository access", async () => {
  const app = await startApp();
  try {
    const member = await signIn(app.base, "org-member");

    assert.equal(
      (await call(app.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: member.sessionCookie })).status,
      403,
    );
    const grant = await call(app.base, "/api/repositories/acme-demo/acme-docs/access", {
      method: "POST",
      cookie: member.sessionCookie,
      body: { subjectType: "team", name: "frontend-team", role: "write" },
    });
    assert.equal(grant.status, 403);

    const admin = await signIn(app.base, "repo-admin");
    const access = await call(app.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: admin.sessionCookie });
    const row = access.body.access.find((entry) => entry.subjectName === "access-role-team");
    const update = await call(app.base, `/api/repositories/acme-demo/acme-docs/access/${row.id}`, {
      method: "PATCH",
      cookie: member.sessionCookie,
      body: { role: "admin" },
    });
    assert.equal(update.status, 403);

    const unchanged = await call(app.base, "/api/repositories/acme-demo/acme-docs/access", { cookie: admin.sessionCookie });
    assert.equal(unchanged.body.access.find((entry) => entry.subjectName === "access-role-team").role, "write");

    assert.equal((await call(app.base, "/api/repositories/acme-demo/acme-docs/access")).status, 401);
  } finally {
    await app.close();
  }
});

test("the signed-in workspace lists every repository the account may read", async () => {
  const app = await startApp();
  try {
    assert.equal((await call(app.base, "/api/repositories")).status, 401);

    // A repository Admin without an organization membership still reaches the
    // repository through a direct grant; the public repository is readable too.
    const admin = await signIn(app.base, "repo-admin");
    const adminRepositories = await call(app.base, "/api/repositories", { cookie: admin.sessionCookie });
    assert.equal(adminRepositories.status, 200);
    assert.deepEqual(adminRepositories.body.repositories.map((repository) => repository.name), ["acme-docs"]);
    assert.equal(adminRepositories.body.repositories[0].organization.slug, "acme-demo");
    assert.equal(adminRepositories.body.repositories[0].organization.displayName, "Acme Demo");
    assert.equal(adminRepositories.body.repositories[0].role, "admin");

    // An organization Owner reads both repositories of the organization.
    const owner = await signIn(app.base, "org-owner");
    const ownerRepositories = await call(app.base, "/api/repositories", { cookie: owner.sessionCookie });
    assert.deepEqual(
      ownerRepositories.body.repositories.map((repository) => repository.name),
      ["acme-docs", "secret-research"],
    );

    // A plain member without a grant never sees the private repository.
    const member = await signIn(app.base, "org-member");
    const memberRepositories = await call(app.base, "/api/repositories", { cookie: member.sessionCookie });
    assert.deepEqual(memberRepositories.body.repositories.map((repository) => repository.name), ["acme-docs"]);
  } finally {
    await app.close();
  }
});
