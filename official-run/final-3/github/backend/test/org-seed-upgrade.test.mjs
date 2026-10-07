// Seed initialization of the organization store: a fresh data directory gets
// every predefined record, a directory holding records of an earlier version
// still receives the records this version adds without losing the stored ones,
// and repeating the initialization never duplicates a record.

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

async function startAppIn(dataDir) {
  const store = createAuthStore(dataDir);
  const orgStore = createOrgStore(dataDir);
  const handler = createRequestHandler({ store, orgStore, staticRoot: join(dataDir, "missing-dist") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function tempDir() {
  return mkdtemp(join(tmpdir(), "shallowcode-org-seed-"));
}

function collectCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function request(baseUrl, method, path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {}, cookie: collectCookie(response) };
}

async function storedState(dataDir) {
  return JSON.parse(await readFile(join(dataDir, "organizations.json"), "utf8"));
}

test("an empty data directory is seeded with every predefined organization record", async () => {
  const dataDir = await tempDir();
  const store = createOrgStore(dataDir);
  // The first read waits for the seed upgrade to be written.
  await store.getOrganization("acme-demo");

  const state = await storedState(dataDir);
  assert.deepEqual(
    state.organizations.map((organization) => organization.id),
    ["acme-demo", "evo-lab-02", "evo-audit-org"],
  );
  assert.equal(
    state.organizations.find((organization) => organization.id === "evo-lab-02").displayName,
    "Evo Lab Two",
  );
  const auditEvents = state.auditEvents.filter((event) => event.organizationId === "evo-audit-org");
  assert.ok(auditEvents.some((event) => event.action === "Member added"));
  assert.ok(auditEvents.some((event) => event.action === "Repository created"));

  // A second initialization against the same directory duplicates nothing.
  await createOrgStore(dataDir).getOrganization("acme-demo");
  const repeated = await storedState(dataDir);
  assert.deepEqual(repeated, state);
});

test("an older data directory keeps its records and receives the current seeds", async () => {
  const dataDir = await tempDir();
  await writeFile(
    join(dataDir, "organizations.json"),
    JSON.stringify({
      organizations: [
        { id: "acme-demo", displayName: "Legacy Acme" },
        { id: "legacy-org", displayName: "Legacy Org" },
      ],
      memberships: [{ organizationId: "legacy-org", accountId: "account-org-owner", role: "Owner" }],
      repositories: [
        {
          id: "repo-legacy",
          ownerType: "organization",
          ownerId: "legacy-org",
          name: "legacy-repo",
          visibility: "private",
          defaultBranch: "main",
        },
      ],
      branches: [{ id: "branch-repo-legacy-main", repositoryId: "repo-legacy", name: "main", headCommitId: null }],
    }),
    "utf8",
  );

  const app = await startAppIn(dataDir);
  try {
    const store = createOrgStore(dataDir);
    // The stored records and the user's display-name change are kept.
    assert.equal((await store.getOrganization("acme-demo")).displayName, "Legacy Acme");
    assert.equal((await store.getOrganization("legacy-org")).displayName, "Legacy Org");
    assert.ok(await store.getRepository({ organizationId: "legacy-org", name: "legacy-repo" }));
    assert.equal((await store.getMembership("legacy-org", "account-org-owner"))?.role, "Owner");

    // The records this version adds are merged in.
    assert.equal((await store.getOrganization("evo-audit-org")).displayName, "evo-audit-org");
    assert.equal((await store.getOrganization("evo-lab-02")).displayName, "Evo Lab Two");
    assert.equal((await store.getMembership("evo-audit-org", "account-evo-audit-owner"))?.role, "Owner");
    const events = await store.listAuditEvents("evo-audit-org");
    assert.ok(events.some((event) => event.action === "Member added"));
    assert.ok(events.some((event) => event.action === "Repository created"));

    // REQ-3-1 / REQ-3-5 (evolution): the searchable and the archivable
    // repositories are added with their stored archive flag.
    const catalog = await store.getRepositoryByOwner({
      ownerType: "account",
      ownerId: "account-evo-search-owner",
      name: "evo-search-catalog-s1",
    });
    assert.equal(catalog.visibility, "public");
    const archived = await store.getRepositoryByOwner({
      ownerType: "account",
      ownerId: "account-evo-archive-admin",
      name: "evo-archive-repository-s2",
    });
    assert.equal(archived.archived, true);
    const active = await store.getRepositoryByOwner({
      ownerType: "account",
      ownerId: "account-evo-archive-admin",
      name: "evo-archive-repository-s1",
    });
    assert.equal(active.archived, false);

    // REQ-4-3-1 / REQ-4-5 (evolution): the branch-switch and release
    // repositories are added with their own active branch and their seeded
    // release, on top of the stored records.
    const branchSwitch = await store.getRepositoryByOwner({
      ownerType: "account",
      ownerId: "account-evo-branch-switch-owner",
      name: "evo-branch-switch-s1",
    });
    assert.equal(branchSwitch.visibility, "public");
    assert.equal(branchSwitch.defaultBranch, "evo-main-s1");
    const branchList = await store.listRepositoryBranches(branchSwitch.id);
    assert.deepEqual(branchList.branches.map((branch) => branch.name), ["evo-main-s1", "evo-feature-s1"]);
    const release = await store.getRelease("repo-evo-release-s2", "evo-v0-1-s2");
    assert.equal(release.title, "Existing Evolution Release");
    assert.equal(release.targetBranch, "evo-main-s2");

    // REQ-5-5 (evolution): the public reaction repository with its three work
    // items and the pre-existing `+1` reaction the visitor scenario reads, on
    // top of the stored records.
    const reactionRepository = await store.getRepositoryByOwner({
      ownerType: "account",
      ownerId: "account-evo-reaction-author",
      name: "evo-reaction-repository-s1",
    });
    assert.equal(reactionRepository.visibility, "public");
    const reactionIssues = await store.listIssues(reactionRepository.id);
    assert.deepEqual(
      reactionIssues.map((issue) => issue.title),
      ["Evo reaction issue s1", "Evo reaction issue s2", "Evo reaction issue s3"],
    );
    const seededReaction = await store.getIssue(reactionRepository.id, 3);
    assert.deepEqual(seededReaction.reactions, [{ type: "+1", count: 1, viewerReacted: false }]);

    // They are reachable through the public entry points of the application.
    const visitor = await request(app.baseUrl, "GET", "/api/repositories?q=evolution-notebook");
    assert.deepEqual(
      visitor.body.repositories.map((repository) => repository.name),
      ["evo-search-notebook-s2"],
    );
    const published = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-release-owner/evo-release-repository-s2/releases/evo-v0-1-s2",
    );
    assert.equal(published.status, 200);
    assert.equal(published.body.release.title, "Existing Evolution Release");
    const switchBranches = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-branch-switch-owner/evo-branch-switch-s1/branches",
    );
    assert.deepEqual(
      switchBranches.body.branches.map((branch) => branch.name),
      ["evo-main-s1", "evo-feature-s1"],
    );
    const archivedOverview = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-archive-admin/evo-archive-repository-s2",
    );
    assert.equal(archivedOverview.status, 200);
    assert.equal(archivedOverview.body.repository.archived, true);
    const reactionIssuesView = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/evo-reaction-author/evo-reaction-repository-s1/issues/3",
    );
    assert.equal(reactionIssuesView.status, 200);
    assert.deepEqual(reactionIssuesView.body.reactions, [
      { type: "+1", count: 1, viewerReacted: false },
    ]);
    assert.equal(reactionIssuesView.body.canReact, false);

    // They are reachable through the public entry points of the application.
    const signedIn = await request(app.baseUrl, "POST", "/api/auth/sign-in", {
      identifier: "evo.audit.owner@evolution.test",
      password: "Evo-Password-987!",
    });
    assert.equal(signedIn.status, 200);
    const organizations = await request(app.baseUrl, "GET", "/api/organizations", undefined, signedIn.cookie);
    assert.ok(organizations.body.organizations.some((organization) => organization.id === "evo-audit-org"));
    const overview = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org",
      undefined,
      signedIn.cookie,
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.viewerRole, "Owner");
    const audit = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/audit-log",
      undefined,
      signedIn.cookie,
    );
    assert.equal(audit.status, 200);
    assert.ok(audit.body.events.length >= 2);

    // A repeated initialization neither duplicates the seeds nor rewrites the
    // stored records.
    const afterFirstStart = await storedState(dataDir);
    createOrgStore(dataDir);
    const afterSecondStart = await storedState(dataDir);
    assert.deepEqual(afterSecondStart, afterFirstStart);
  } finally {
    await app.close();
  }
});

test("a file of the previous seed generation receives the reaction seeds only once", async () => {
  const dataDir = await tempDir();
  // A file written by the previous seed generation: it holds the records and the
  // user change of that version but none of the reaction seeds.
  await writeFile(
    join(dataDir, "organizations.json"),
    JSON.stringify({
      seedGeneration: 4,
      organizations: [{ id: "acme-demo", displayName: "Legacy Acme" }],
      repositories: [
        {
          id: "repo-legacy",
          ownerType: "organization",
          ownerId: "acme-demo",
          name: "legacy-repo",
          visibility: "public",
          defaultBranch: "main",
        },
      ],
      issues: [
        {
          id: "issue-legacy-1",
          repositoryId: "repo-legacy",
          number: 1,
          title: "Legacy issue",
          description: "",
          status: "open",
          authorName: "org-owner",
          labelIds: [],
          assigneeIds: [],
          milestoneId: null,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );

  const store = createOrgStore(dataDir);
  // The stored records and the user's display-name change stay. The legacy file
  // carries no `issueReactions` collection at all, so the merge has to create it.
  assert.equal((await store.getOrganization("acme-demo")).displayName, "Legacy Acme");
  assert.equal((await store.getIssue("repo-legacy", 1)).issue.title, "Legacy issue");
  const reactionRepository = await store.getRepositoryByOwner({
    ownerType: "account",
    ownerId: "account-evo-reaction-author",
    name: "evo-reaction-repository-s1",
  });
  assert.equal(reactionRepository.visibility, "public");
  const seeded = await store.getIssue(reactionRepository.id, 3);
  assert.deepEqual(seeded.reactions, [{ type: "+1", count: 1, viewerReacted: false }]);

  // Both the upgrade and a repeated start are idempotent.
  const state = await storedState(dataDir);
  assert.equal(state.seedGeneration, 5);
  assert.equal(state.issueReactions.length, 1);
  assert.equal(
    state.issues.filter((issue) => issue.repositoryId === reactionRepository.id).length,
    3,
  );
  await createOrgStore(dataDir).getOrganization("acme-demo");
  assert.deepEqual(await storedState(dataDir), state);
});

test("a user removal is not resurrected by the next start", async () => {
  const dataDir = await tempDir();
  const app = await startAppIn(dataDir);
  try {
    const owner = await request(app.baseUrl, "POST", "/api/auth/sign-in", {
      identifier: "evo-audit-owner",
      password: "Evo-Password-987!",
    });
    assert.equal(owner.status, 200);
    const removed = await request(
      app.baseUrl,
      "DELETE",
      "/api/organizations/evo-audit-org/people/evo-audit-viewer",
      undefined,
      owner.cookie,
    );
    assert.equal(removed.status, 200);

    const restarted = createOrgStore(dataDir);
    assert.equal(await restarted.getMembership("evo-audit-org", "account-evo-audit-viewer"), null);
    const people = await request(
      app.baseUrl,
      "GET",
      "/api/organizations/evo-audit-org/people",
      undefined,
      owner.cookie,
    );
    assert.equal(people.body.members.some((member) => member.username === "evo-audit-viewer"), false);
  } finally {
    await app.close();
  }
});
