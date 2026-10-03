import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(sharedDataDir) {
  const dataDir = sharedDataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-creation-")));
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

async function stateOf(dataDir) {
  return JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
}

/** The stored repositories of one account namespace. */
async function personalRepositories(dataDir, username) {
  const state = await stateOf(dataDir);
  const account = state.accounts.find((candidate) => candidate.username === username);
  return state.repositories.filter(
    (repository) => repository.ownerType === "account" && repository.ownerId === account.id,
  );
}

test("resolves a document written before personal namespaces existed", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-legacy-"));
  // An earlier stage stored only `organizationId`; the owner fields must resolve
  // from it and be rewritten on the next start.
  await writeFile(
    join(dataDir, "state.json"),
    JSON.stringify({
      accounts: [],
      sessions: [],
      organizations: [{ id: "org-legacy", slug: "legacy-org", displayName: "Legacy Org" }],
      memberships: [],
      teams: [],
      teamMembers: [],
      repositories: [
        {
          id: "repo-legacy",
          organizationId: "org-legacy",
          name: "legacy-repo",
          description: "",
          visibility: "public",
          defaultBranch: "main",
        },
      ],
      repositoryGrants: [],
    }),
  );

  const app = await startApp(dataDir);
  try {
    const overview = await call(app.base, "/api/repositories/legacy-org/legacy-repo");
    assert.equal(overview.status, 200);
    assert.equal(overview.body.repository.owner.login, "legacy-org");
    assert.equal(overview.body.repository.owner.displayName, "Legacy Org");

    const stored = await stateOf(dataDir);
    const repository = stored.repositories.find((candidate) => candidate.id === "repo-legacy");
    assert.equal(repository.ownerType, "organization");
    assert.equal(repository.ownerId, "org-legacy");
  } finally {
    await app.close();
  }
});

test("an initialized private repository stores its README, initial commit and owner and survives reload", async () => {
  const first = await startApp();
  const dataDir = first.dataDir;
  try {
    const owner = await signIn(first.base, "repo-owner");
    const created = await call(first.base, "/api/repositories", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: {
        owner: "",
        name: "playwright-demo",
        description: "Repository created by Playwright",
        visibility: "private",
        initialize: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.repository.name, "playwright-demo");
    assert.equal(created.body.repository.visibility, "private");
    assert.equal(created.body.repository.defaultBranch, "main");
    assert.equal(created.body.repository.owner.type, "account");
    assert.equal(created.body.repository.owner.login, "repo-owner");
    assert.equal(created.body.repository.readmePath, "README.md");

    // The overview the browser would open answers with the stored repository.
    const overview = await call(first.base, "/api/repositories/repo-owner/playwright-demo", {
      cookie: owner.sessionCookie,
    });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.repository.description, "Repository created by Playwright");
    assert.equal(overview.body.repository.role, "admin");

    const readme = await call(first.base, "/api/repositories/repo-owner/playwright-demo/blob/main/README.md", {
      cookie: owner.sessionCookie,
    });
    assert.equal(readme.status, 200);
    assert.equal(readme.body.path, "README.md");
    assert.match(readme.body.content, /playwright-demo/);

    // Initialization wrote exactly one commit on the default branch.
    const state = await stateOf(dataDir);
    const repository = state.repositories.find((candidate) => candidate.name === "playwright-demo");
    const commits = state.commits.filter((commit) => commit.repositoryId === repository.id);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].branch, "main");
    assert.equal(commits[0].parentCommitId, null);
    assert.equal(commits[0].authorName, "repo-owner");

    // The new repository is part of its owner's repository list.
    const listed = await call(first.base, "/api/repositories", { cookie: owner.sessionCookie });
    assert.ok(listed.body.repositories.some((candidate) => candidate.name === "playwright-demo" && candidate.owner.login === "repo-owner"));
  } finally {
    await first.close();
  }

  const restarted = await startApp(dataDir);
  try {
    const overview = await call(restarted.base, "/api/repositories/repo-owner/playwright-demo");
    assert.equal(overview.status, 403, "a private repository of another owner stays closed to visitors");

    const owner = await signIn(restarted.base, "repo-owner");
    const reopened = await call(restarted.base, "/api/repositories/repo-owner/playwright-demo", {
      cookie: owner.sessionCookie,
    });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.repository.visibility, "private");
    assert.equal(reopened.body.repository.readmePath, "README.md");
    assert.equal(reopened.body.repository.description, "Repository created by Playwright");
  } finally {
    await restarted.close();
  }
});

test("rejects an empty and a duplicate repository name without creating a repository", async () => {
  const app = await startApp();
  try {
    const owner = await signIn(app.base, "repo-owner");
    const empty = await call(app.base, "/api/repositories", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { owner: "repo-owner", name: "  ", visibility: "public" },
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.fields.name, "Repository name is required");

    const duplicate = await call(app.base, "/api/repositories", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { owner: "repo-owner", name: "acme-docs", visibility: "private", initialize: true },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fields.name, "Repository name already exists");

    const invalid = await call(app.base, "/api/repositories", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { owner: "repo-owner", name: "not a name", visibility: "public" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fields.name, "Repository name format is invalid");

    // Only the pre-provisioned `acme-docs` of that namespace exists; the
    // duplicate-free name is still unused.
    const stored = await personalRepositories(app.dataDir, "repo-owner");
    assert.deepEqual(stored.map((repository) => repository.name).sort(), ["acme-docs"]);
  } finally {
    await app.close();
  }
});

test("creates in an organization namespace only for its Owner and refuses anonymous requests", async () => {
  const app = await startApp();
  try {
    const anonymous = await call(app.base, "/api/repositories", {
      method: "POST",
      body: { name: "anonymous-repo", visibility: "public" },
    });
    assert.equal(anonymous.status, 401);

    // `fork-user` may not create inside `repo-owner-org`.
    const outsider = await signIn(app.base, "fork-user");
    const refused = await call(app.base, "/api/repositories", {
      method: "POST",
      cookie: outsider.sessionCookie,
      body: { owner: "repo-owner-org", name: "shared-repo", visibility: "public" },
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "You do not have permission to create repositories for this owner");

    const owner = await signIn(app.base, "repo-owner");
    const created = await call(app.base, "/api/repositories", {
      method: "POST",
      cookie: owner.sessionCookie,
      body: { owner: "repo-owner-org", name: "shared-repo", visibility: "public", initialize: true },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.repository.owner.type, "organization");
    assert.equal(created.body.repository.owner.login, "repo-owner-org");

    const organization = await call(app.base, "/api/organizations/repo-owner-org/repositories", {
      cookie: owner.sessionCookie,
    });
    assert.deepEqual(organization.body.repositories.map((repository) => repository.name), ["shared-repo"]);

    const state = await stateOf(app.dataDir);
    assert.equal(state.repositories.filter((repository) => repository.name === "shared-repo").length, 1);
  } finally {
    await app.close();
  }
});

test("forks a readable repository with its history, records the source and stays independent", async () => {
  const first = await startApp();
  const dataDir = first.dataDir;
  try {
    const user = await signIn(first.base, "fork-user");
    const forked = await call(first.base, "/api/repositories/acme-demo/acme-docs/fork", {
      method: "POST",
      cookie: user.sessionCookie,
      body: { owner: "", name: "acme-docs-copy", visibility: "public" },
    });
    assert.equal(forked.status, 201);
    assert.equal(forked.body.repository.name, "acme-docs-copy");
    assert.equal(forked.body.repository.owner.login, "fork-user");
    assert.equal(forked.body.repository.forkedFrom.name, "acme-docs");
    assert.equal(forked.body.repository.forkedFrom.owner.login, "acme-demo");

    const state = await stateOf(dataDir);
    const source = state.repositories.find((repository) => repository.name === "acme-docs" && repository.ownerType === "organization");
    const fork = state.repositories.find((repository) => repository.name === "acme-docs-copy");
    assert.equal(fork.forkedFromRepositoryId, source.id);

    const sourceCommits = state.commits.filter((commit) => commit.repositoryId === source.id);
    const forkCommits = state.commits.filter((commit) => commit.repositoryId === fork.id);
    assert.ok(sourceCommits.length > 0, "the seeded source has a history to copy");
    assert.equal(forkCommits.length, sourceCommits.length);
    assert.deepEqual(forkCommits.map((commit) => commit.message), sourceCommits.map((commit) => commit.message));
    assert.ok(forkCommits.every((commit) => !sourceCommits.some((candidate) => candidate.id === commit.id)), "commit copies are independent records");
    assert.deepEqual(
      forkCommits.map((commit) => (commit.changes ?? []).map((change) => change.path)),
      sourceCommits.map((commit) => (commit.changes ?? []).map((change) => change.path)),
      "the copied commits carry their own change lists",
    );

    const sourceFiles = state.files.filter((file) => file.repositoryId === source.id);
    const forkFiles = state.files.filter((file) => file.repositoryId === fork.id);
    assert.ok(sourceFiles.length > 0, "the seeded source has a snapshot to copy");
    assert.deepEqual(forkFiles.map((file) => file.path), sourceFiles.map((file) => file.path));
    assert.ok(forkFiles.every((file) => !sourceFiles.some((candidate) => candidate.id === file.id)), "file copies are independent records");

    // The copied default branch is browsable from the fork.
    const content = await call(first.base, "/api/repositories/fork-user/acme-docs-copy/blob/main/src/README.md", {
      cookie: user.sessionCookie,
    });
    assert.equal(content.status, 200);
    assert.equal(content.body.content, "Document search flow");

    // The source history is untouched by the fork.
    const after = await stateOf(dataDir);
    assert.equal(
      after.commits.filter((commit) => commit.repositoryId === source.id).length,
      sourceCommits.length,
    );
    assert.equal(
      after.files.filter((file) => file.repositoryId === source.id).length,
      sourceFiles.length,
    );
  } finally {
    await first.close();
  }

  const restarted = await startApp(dataDir);
  try {
    const overview = await call(restarted.base, "/api/repositories/fork-user/acme-docs-copy");
    assert.equal(overview.status, 200);
    assert.equal(overview.body.repository.forkedFrom.name, "acme-docs");
    assert.equal(overview.body.repository.forkedFrom.owner.login, "acme-demo");

    const repositories = await call(restarted.base, "/api/repositories/fork-user/acme-docs-copy");
    assert.equal(repositories.status, 200);
  } finally {
    await restarted.close();
  }
});

test("refuses a conflicting fork name, an unreadable source and a namespace without permission", async () => {
  const app = await startApp();
  try {
    const anonymous = await call(app.base, "/api/repositories/acme-demo/acme-docs/fork", {
      method: "POST",
      body: { name: "anonymous-fork" },
    });
    assert.equal(anonymous.status, 401);

    const user = await signIn(app.base, "fork-user");
    const conflict = await call(app.base, "/api/repositories/acme-demo/acme-docs/fork", {
      method: "POST",
      cookie: user.sessionCookie,
      body: { owner: "fork-user", name: "acme-docs-fork" },
    });
    assert.equal(conflict.status, 400);
    assert.equal(conflict.body.fields.name, "Repository name already exists");

    const unreadable = await call(app.base, "/api/repositories/acme-demo/secret-research/fork", {
      method: "POST",
      cookie: user.sessionCookie,
      body: { name: "secret-copy" },
    });
    assert.equal(unreadable.status, 403);

    const foreign = await call(app.base, "/api/repositories/acme-demo/acme-docs/fork", {
      method: "POST",
      cookie: user.sessionCookie,
      body: { owner: "acme-demo", name: "org-copy" },
    });
    assert.equal(foreign.status, 403);

    const state = await stateOf(app.dataDir);
    for (const name of ["anonymous-fork", "secret-copy", "org-copy"]) {
      assert.equal(state.repositories.filter((repository) => repository.name === name).length, 0);
    }
  } finally {
    await app.close();
  }
});

test("keeps a private source private and answers a missing file with 404", async () => {
  const app = await startApp();
  try {
    const admin = await signIn(app.base, "visibility-admin");
    const forked = await call(app.base, "/api/repositories/acme-demo/visibility-demo/fork", {
      method: "POST",
      cookie: admin.sessionCookie,
      body: { owner: "", name: "visibility-demo-copy", visibility: "public" },
    });
    assert.equal(forked.status, 201);
    assert.equal(forked.body.repository.visibility, "private");

    const missing = await call(app.base, "/api/repositories/visibility-admin/visibility-demo-copy/blob/main/README.md", {
      cookie: admin.sessionCookie,
    });
    assert.equal(missing.status, 404);

    const anonymous = await call(app.base, "/api/repositories/visibility-admin/visibility-demo-copy");
    assert.equal(anonymous.status, 403);
  } finally {
    await app.close();
  }
});
