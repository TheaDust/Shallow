import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAccountsDomain } from "../src/domain/accounts.mjs";
import { createOrganizationsDomain } from "../src/domain/organizations.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function createDomains() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-repos-"));
  const store = createJsonStore(join(directory, "state.json"), {
    accounts: {},
    sessions: {},
    organizations: {},
    memberships: {},
    teams: {},
    teamMembers: {},
    repositories: {},
    grants: {},
    git: {},
  });
  const accounts = createAccountsDomain(store);
  const organizations = createOrganizationsDomain(store);
  await accounts.seedIfEmpty();
  await organizations.seedIfEmpty();
  return { directory, store, accounts, organizations };
}

test("creating a repository with initialization creates branch, README and commit atomically", async () => {
  const { organizations, store } = await createDomains();

  const result = await organizations.createRepository("alice-dev", {
    owner: "alice-dev",
    name: "my-project",
    description: "Repository created by Playwright",
    visibility: "private",
    initialize: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.repository.owner, "alice-dev");
  assert.equal(result.repository.name, "my-project");
  assert.equal(result.repository.description, "Repository created by Playwright");
  assert.equal(result.repository.visibility, "private");
  assert.equal(result.repository.defaultBranch, "main");

  const state = await store.read();
  const repo = state.repositories["alice-dev:my-project"];
  assert.equal(repo.ownerType, "user");
  assert.equal(repo.ownerId, "alice-dev");
  assert.equal(repo.visibility, "private");
  assert.equal(repo.defaultBranch, "main");
  assert.equal(repo.createdBy, "alice-dev");

  const git = state.git["alice-dev:my-project"];
  const commitId = git.branches.main;
  assert.equal(git.commits[commitId].message, "Initial commit");
  assert.equal(git.commits[commitId].author, "alice-dev");
  assert.equal(git.commits[commitId].parentId, null);
  assert.equal(git.files.main["README.md"].commitId, commitId);

  // The overview shows the Private marker and a README file link.
  const overview = await organizations.getRepository("alice-dev", "my-project", "alice-dev");
  assert.equal(overview.repository.visibility, "private");
  assert.ok(overview.repository.files.some((file) => file.name === "README.md"));

  // The repository appears in the target owner's repository list.
  const list = await organizations.listMyRepositories("alice-dev");
  assert.ok(list.some((repo) => `${repo.owner}/${repo.name}` === "alice-dev/my-project"));
});

test("creating a repository rejects empty, duplicate and malformed names and invalid visibility", async () => {
  const { organizations, store } = await createDomains();

  const empty = await organizations.createRepository("alice-dev", {
    owner: "alice-dev",
    name: "",
    visibility: "public",
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.errors.name, "Repository name is required");

  const malformed = await organizations.createRepository("alice-dev", {
    owner: "alice-dev",
    name: "-bad-name",
    visibility: "public",
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.errors.name, "Repository name format is invalid");

  const duplicate = await organizations.createRepository("alice-dev", {
    owner: "alice-dev",
    name: "acme-docs-fork",
    visibility: "public",
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.name, "Repository name already exists");

  const invalidVisibility = await organizations.createRepository("alice-dev", {
    owner: "alice-dev",
    name: "ok-name",
    visibility: "everyone",
  });
  assert.equal(invalidVisibility.ok, false);
  assert.equal(invalidVisibility.errors.visibility, "Visibility is invalid");

  // No partially created repository for any rejected input.
  const state = await store.read();
  assert.equal(state.repositories["alice-dev:-bad-name"], undefined);
  assert.equal(state.repositories["alice-dev:ok-name"], undefined);
  assert.equal(state.git["alice-dev:ok-name"], undefined);
});

test("repository creation enforces namespace permission on the server", async () => {
  const { organizations, store } = await createDomains();

  // An organization member without Owner permission cannot create there.
  const orgMember = await organizations.createRepository("bob-reviewer", {
    owner: "acme-demo",
    name: "bobs-repo",
    visibility: "public",
  });
  assert.equal(orgMember.ok, false);
  assert.equal(orgMember.forbidden, true);

  // Anonymous creation is forbidden.
  const anonymous = await organizations.createRepository(null, {
    owner: "alice-dev",
    name: "anon-repo",
    visibility: "public",
  });
  assert.equal(anonymous.forbidden, true);

  // An organization Owner can create in the organization namespace.
  const orgOwner = await organizations.createRepository("alice-dev", {
    owner: "acme-demo",
    name: "alice-org-repo",
    description: "",
    visibility: "public",
    initialize: true,
  });
  assert.equal(orgOwner.ok, true);
  const state = await store.read();
  assert.equal(state.repositories["acme-demo:alice-org-repo"].ownerType, "organization");
  assert.equal(state.repositories["acme-demo:alice-org-repo"].ownerId, "acme-demo");
  assert.equal(state.repositories["acme-demo:alice-org-repo"].createdBy, "alice-dev");

  const overview = await organizations.getRepository("acme-demo", "alice-org-repo", "alice-dev");
  assert.ok(overview.repository.files.some((file) => file.name === "README.md"));

  assert.equal(state.repositories["acme-demo:bobs-repo"], undefined);
  assert.equal(state.repositories["alice-dev:anon-repo"], undefined);
});

test("a repository created without initialization has no git records yet", async () => {
  const { organizations, store } = await createDomains();

  const result = await organizations.createRepository("alice-dev", {
    owner: "alice-dev",
    name: "bare-repo",
    description: "",
    visibility: "public",
  });
  assert.equal(result.ok, true);

  const state = await store.read();
  assert.equal(state.git["alice-dev:bare-repo"], undefined);
  const overview = await organizations.getRepository("alice-dev", "bare-repo", "alice-dev");
  assert.deepEqual(overview.repository.files, []);
});

test("repository search shows only repositories the user is authorized to view", async () => {
  const { organizations } = await createDomains();

  // Visitor: both public acme-docs repositories match, the private
  // secret-research stays hidden.
  const visitor = await organizations.searchRepositories("acme", null);
  assert.deepEqual(
    visitor.map((repo) => `${repo.owner}/${repo.name}`),
    ["acme-demo/acme-docs", "alice-dev/acme-docs"],
  );
  assert.ok(!visitor.some((repo) => repo.name === "secret-research"));

  // Searching the private name exposes no result link for the visitor.
  assert.deepEqual(await organizations.searchRepositories("secret-research", null), []);

  // Organization Owner sees every repository matching the query.
  const alice = await organizations.searchRepositories("acme", "alice-dev");
  assert.deepEqual(
    alice.map((repo) => `${repo.owner}/${repo.name}`).sort(),
    [
      "acme-demo/acme-docs",
      "acme-demo/acme-internal",
      "acme-demo/acme-private",
      "alice-dev/acme-docs",
      "alice-dev/acme-docs-fork",
    ],
  );

  // A collaborator with a direct Read grant sees the private repository by name.
  const bob = await organizations.searchRepositories("acme", "bob-reviewer");
  assert.deepEqual(
    bob.map((repo) => `${repo.owner}/${repo.name}`).sort(),
    ["acme-demo/acme-docs", "alice-dev/acme-docs"],
  );
  const bobPrivate = await organizations.searchRepositories("research", "bob-reviewer");
  assert.deepEqual(bobPrivate.map((repo) => `${repo.owner}/${repo.name}`), ["alice-dev/secret-research"]);

  // Signed-in users only see repositories they are authorized to view.
  const bobAcmePrivate = await organizations.searchRepositories("acme-private", "bob-reviewer");
  assert.deepEqual(bobAcmePrivate, []);

  // Search metadata includes description, visibility and update time.
  const docs = (await organizations.searchRepositories("acme-docs", null)).find(
    (repo) => repo.owner === "alice-dev",
  );
  assert.equal(docs.description, "Acme documentation");
  assert.equal(docs.visibility, "public");
  assert.equal(docs.defaultBranch, "main");
  assert.ok(docs.updatedAt);
});

test("repository overview includes the default-branch file list and fork source", async () => {
  const { organizations } = await createDomains();

  const overview = await organizations.getRepository("acme-demo", "acme-docs", null);
  assert.equal(overview.repository.defaultBranch, "main");
  assert.deepEqual(
    overview.repository.files.map((file) => `${file.name}:${file.type}`).sort(),
    ["README.md:file", "src:dir"],
  );
  assert.equal(overview.repository.forkSource, null);
  assert.equal(overview.myRole, null);

  // Private repository denies visitors and reports the fork relationship for owners.
  const denied = await organizations.getRepository("alice-dev", "secret-research", null);
  assert.deepEqual(denied, { denied: true });
  const asOwner = await organizations.getRepository("alice-dev", "secret-research", "alice-dev");
  assert.equal(asOwner.repository.files.some((file) => file.name === "README.md"), true);
  assert.equal(asOwner.myRole, "admin");

  const forkOverview = await organizations.getRepository("alice-dev", "acme-docs-fork", "alice-dev");
  assert.equal(forkOverview.repository.forkSource, null, "seed fork has no source link");
});

test("repository contents serve directory entries and file content per branch", async () => {
  const { organizations } = await createDomains();

  const root = await organizations.getRepositoryContents("acme-demo", "acme-docs", {}, null);
  assert.equal(root.ok, true);
  assert.equal(root.type, "dir");
  assert.equal(root.branch, "main");
  assert.equal(root.path, "/");
  assert.equal(root.commitCount, 2);
  assert.ok(root.entries.some((entry) => entry.name === "src" && entry.type === "dir"));

  const dir = await organizations.getRepositoryContents(
    "acme-demo",
    "acme-docs",
    { path: "src" },
    null,
  );
  assert.equal(dir.ok, true);
  assert.equal(dir.type, "dir");
  assert.deepEqual(dir.entries, [{ name: "search.ts", path: "src/search.ts", type: "file" }]);

  const blob = await organizations.getRepositoryContents(
    "acme-demo",
    "acme-docs",
    { path: "README.md" },
    null,
  );
  assert.equal(blob.ok, true);
  assert.equal(blob.type, "file");
  assert.equal(blob.name, "README.md");
  assert.match(blob.content, /search flow/);
  assert.equal(blob.commit.message, "Document search flow");

  // Missing file paths and unknown branches are not found.
  const missing = await organizations.getRepositoryContents(
    "acme-demo",
    "acme-docs",
    { path: "nope.md" },
    null,
  );
  assert.equal(missing.notFound, true);
  const unknownBranch = await organizations.getRepositoryContents(
    "acme-demo",
    "acme-docs",
    { branch: "missing" },
    null,
  );
  assert.equal(unknownBranch.notFound, true);

  // Private repository content is denied for the visitor.
  const privateBlob = await organizations.getRepositoryContents(
    "alice-dev",
    "secret-research",
    { path: "README.md" },
    null,
  );
  assert.equal(privateBlob.denied, true);
});

test("forking a repository copies history into the target namespace", async () => {
  const { organizations, store } = await createDomains();

  const result = await organizations.createFork("alice-dev", "alice-dev", "acme-docs", {
    targetOwner: "alice-dev",
    name: "acme-docs-personal",
    visibility: "public",
  });
  assert.equal(result.ok, true);
  assert.equal(result.repository.owner, "alice-dev");
  assert.equal(result.repository.name, "acme-docs-personal");
  assert.equal(result.repository.visibility, "public");

  const state = await store.read();
  const fork = state.repositories["alice-dev:acme-docs-personal"];
  assert.equal(fork.forkSourceId, "alice-dev:acme-docs");
  assert.equal(fork.defaultBranch, "main");
  assert.equal(state.git["alice-dev:acme-docs-personal"].branches.main, "c2");
  assert.equal(
    state.git["alice-dev:acme-docs-personal"].files.main["src/search.ts"].content,
    state.git["alice-dev:acme-docs"].files.main["src/search.ts"].content,
  );

  // The fork overview exposes the source link and the copied files.
  const overview = await organizations.getRepository("alice-dev", "acme-docs-personal", "alice-dev");
  assert.deepEqual(overview.repository.forkSource, { owner: "alice-dev", name: "acme-docs" });
  assert.ok(overview.repository.files.some((file) => file.name === "README.md"));

  // Independent history: a later fork change never touches the source.
  state.git["alice-dev:acme-docs-personal"].files.main["README.md"] = {
    content: "changed",
    commitId: "c9",
  };
  await store.update(() => state);
  const sourceContent = (
    await organizations.getRepositoryContents("alice-dev", "acme-docs", { path: "README.md" }, null)
  ).content;
  assert.match(sourceContent, /search flow/);
});

test("forking rejects conflicts, bad targets and private-source visibility", async () => {
  const { organizations, store } = await createDomains();

  const conflict = await organizations.createFork("alice-dev", "alice-dev", "acme-docs", {
    targetOwner: "alice-dev",
    name: "acme-docs-fork",
    visibility: "private",
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errors.name, "Repository name already exists");

  const missingName = await organizations.createFork("alice-dev", "alice-dev", "acme-docs", {
    targetOwner: "alice-dev",
    name: "",
    visibility: "public",
  });
  assert.equal(missingName.ok, false);
  assert.equal(missingName.errors.name, "Repository name is required");

  const malformed = await organizations.createFork("alice-dev", "alice-dev", "acme-docs", {
    targetOwner: "alice-dev",
    name: "-bad-name",
    visibility: "public",
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.errors.name, "Repository name format is invalid");

  // A member without creation permission in an organization cannot fork there.
  const orgTarget = await organizations.createFork("bob-reviewer", "alice-dev", "acme-docs", {
    targetOwner: "acme-demo",
    name: "bobs-fork",
    visibility: "public",
  });
  assert.equal(orgTarget.ok, false);
  assert.equal(orgTarget.forbidden, true);

  // An inaccessible source cannot be forked (visitor, and private source).
  const anonymous = await organizations.createFork(null, "alice-dev", "acme-docs", {
    targetOwner: "alice-dev",
    name: "anon-fork",
    visibility: "public",
  });
  assert.equal(anonymous.forbidden, true);
  const privateSource = await organizations.createFork("alice-dev", "alice-dev", "secret-research", {
    targetOwner: "alice-dev",
    name: "research-fork",
    visibility: "public",
  });
  assert.equal(privateSource.ok, false);
  assert.equal(privateSource.errors.visibility, "A private repository can only be forked as Private");

  // A private source may be forked as Private.
  const privateOk = await organizations.createFork("alice-dev", "alice-dev", "secret-research", {
    targetOwner: "alice-dev",
    name: "research-fork",
    visibility: "private",
  });
  assert.equal(privateOk.ok, true);
  assert.equal(privateOk.repository.visibility, "private");

  const state = await store.read();
  assert.equal(state.repositories["alice-dev:-bad-name"], undefined);
  assert.equal(state.repositories["alice-dev:anon-fork"], undefined);
  assert.equal(state.repositories["alice-dev:bobs-fork"], undefined);
});

test("visibility changes require admin and are enforced for later access", async () => {
  const { organizations } = await createDomains();

  // A non-Admin collaborator cannot change visibility.
  const bob = await organizations.setRepositoryVisibility(
    "bob-reviewer",
    "alice-dev",
    "secret-research",
    "public",
  );
  assert.equal(bob.ok, false);
  assert.equal(bob.forbidden, true);

  const invalid = await organizations.setRepositoryVisibility(
    "alice-dev",
    "alice-dev",
    "secret-research",
    "everyone",
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.visibility, "Visibility is invalid");

  // Admin (repository owner) changes the private repository to Public.
  const changed = await organizations.setRepositoryVisibility(
    "alice-dev",
    "alice-dev",
    "secret-research",
    "public",
  );
  assert.equal(changed.ok, true);
  assert.equal(changed.repository.visibility, "public");
  assert.equal(changed.myRole, "admin");

  // An unauthenticated visitor can now open the same address and search it.
  const visitor = await organizations.getRepository("alice-dev", "secret-research", null);
  assert.equal(visitor.repository.visibility, "public");
  assert.equal(visitor.repository.name, "secret-research");
  const search = await organizations.searchRepositories("secret", null);
  assert.ok(search.some((repo) => repo.name === "secret-research"));
  const contents = await organizations.getRepositoryContents(
    "alice-dev",
    "secret-research",
    { path: "README.md" },
    null,
  );
  assert.equal(contents.ok, true);
  assert.equal(contents.type, "file");

  // Admin can set it back to Private; then visitors are denied again.
  const back = await organizations.setRepositoryVisibility(
    "alice-dev",
    "alice-dev",
    "secret-research",
    "private",
  );
  assert.equal(back.ok, true);
  assert.deepEqual(await organizations.getRepository("alice-dev", "secret-research", null), { denied: true });
});

test("the signed-in repository list contains personal and accessible organization repositories", async () => {
  const { organizations } = await createDomains();

  const alice = await organizations.listMyRepositories("alice-dev");
  const names = alice.map((repo) => `${repo.owner}/${repo.name}`).sort();
  assert.deepEqual(names, [
    "acme-demo/acme-docs",
    "acme-demo/acme-internal",
    "acme-demo/acme-private",
    "alice-dev/acme-docs",
    "alice-dev/acme-docs-fork",
    "alice-dev/secret-research",
  ]);

  const bob = await organizations.listMyRepositories("bob-reviewer");
  assert.deepEqual(
    bob.map((repo) => `${repo.owner}/${repo.name}`).sort(),
    [
      "acme-demo/acme-docs",
      "alice-dev/acme-docs",
      "alice-dev/secret-research",
      "bob-reviewer/bob-notes",
    ],
  );

  assert.deepEqual(await organizations.listMyRepositories(null), []);
});
