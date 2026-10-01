import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore, createSeedData } from "../src/domain/store.mjs";

/**
 * REQ-6-1: a branch protection rule is bound to one exact branch name, stores
 * the two selectable requirements, blocks direct writes to that branch and is
 * applied while merging; the Checks area stores the `test` status of the pull
 * request's current compare commit for a repository Admin.
 */

let app;
let dataDir;

function startApp(directory) {
  const store = createAppStore(directory);
  const handler = createRequestHandler({ store, staticRoot: join(directory, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
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
          const text = await response.text();
          return {
            status: response.status,
            cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
            body: text ? JSON.parse(text) : null,
          };
        },
        async signIn(identifier, password) {
          const response = await this.request("/api/sessions", {
            method: "POST",
            body: { identifier, password },
          });
          return response.cookie;
        },
      });
    });
  });
}

async function storedRepository(name = "acme-docs") {
  let document;
  try {
    document = JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    document = createSeedData();
  }
  return document.repositories.find((repository) => repository.name === name);
}

async function storedPullRequests() {
  let document;
  try {
    document = JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    document = createSeedData();
  }
  return document.pullRequests;
}

const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");
const carolCookie = () => app.signIn("carol-maintainer", "Valid-password-123!");

const PROTECTION_URL = "/api/repositories/alice-dev/acme-docs/protection-rules";
const PULL_URL = "/api/repositories/alice-dev/acme-docs/pulls/1";

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-code-protection-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

describe("REQ-6-1 branch protection rules", () => {
  it("starts without a rule for main and lists the seeded pull requests", async () => {
    const overview = await app.request("/api/repositories/alice-dev/acme-docs");
    assert.equal(overview.status, 200);
    assert.deepEqual(overview.body.repository.protectionRules, []);
    assert.equal(overview.body.repository.canManageBranchProtection, false);

    const list = await app.request("/api/repositories/alice-dev/acme-docs/pulls");
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.pullRequests.map((row) => [
        row.number,
        row.title,
        row.author,
        row.status,
        row.baseBranch,
        row.compareBranch,
      ]),
      [
        [1, "Improve onboarding", "alice-dev", "open", "main", "onboarding-docs"],
        [2, "Fix search", "alice-dev", "closed", "main", "feature-search"],
        [3, "Draft onboarding update", "alice-dev", "draft", "main", "draft-feature"],
        // REQ-6-3: the Open pull requests of the review workspace seeds.
        [4, "Add onboarding notes for the release", "alice-dev", "open", "release", "onboarding-docs"],
        [5, "Add draft notes for the release", "alice-dev", "open", "release", "draft-feature"],
      ],
    );

    const detail = await app.request(PULL_URL);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.pullRequest.check.name, "test");
    assert.equal(detail.body.pullRequest.check.status, "pending");
    assert.equal(detail.body.pullRequest.check.commitId, "c5d8f41-acme-docs-onboarding-notes");
  });

  it("lets the Admin create a rule for one exact branch name and keeps it after a reload", async () => {
    const cookie = await aliceCookie();
    const created = await app.request(PROTECTION_URL, {
      method: "POST",
      cookie,
      body: { pattern: "main", requireApproval: true, requireStatusCheck: true },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(
      created.body.repository.protectionRules.map((rule) => [rule.pattern, rule.requireApproval, rule.requireStatusCheck]),
      [["main", true, true]],
    );

    // The Admin may manage the rules; a readable non-Admin account may not.
    const asAdmin = await app.request("/api/repositories/alice-dev/acme-docs", { cookie });
    assert.equal(asAdmin.body.repository.canManageBranchProtection, true);
    assert.equal(asAdmin.body.repository.protectionRules[0].pattern, "main");

    const reloaded = await app.request(PROTECTION_URL);
    assert.equal(reloaded.status, 200);
    assert.deepEqual(
      reloaded.body.protectionRules.map((rule) => [rule.pattern, rule.requireApproval, rule.requireStatusCheck]),
      [["main", true, true]],
    );
  });

  it("refuses a non-Admin save and leaves the stored rule unchanged", async () => {
    const anonymous = await app.request(PROTECTION_URL, {
      method: "POST",
      body: { pattern: "main", requireApproval: false, requireStatusCheck: false },
    });
    assert.equal(anonymous.status, 401);

    const cookie = await bobCookie();
    const refused = await app.request(PROTECTION_URL, {
      method: "POST",
      cookie,
      body: { pattern: "main", requireApproval: false, requireStatusCheck: false },
    });
    assert.equal(refused.status, 403);

    const repository = await storedRepository();
    assert.equal(repository.protectionRules.length, 1);
    assert.equal(repository.protectionRules[0].requireApproval, true);
    assert.equal(repository.protectionRules[0].requireStatusCheck, true);
  });

  it("updates the existing rule of the same branch name instead of adding a second one", async () => {
    const cookie = await aliceCookie();
    const saved = await app.request(PROTECTION_URL, {
      method: "POST",
      cookie,
      body: { pattern: "main", requireApproval: true, requireStatusCheck: false },
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(
      saved.body.repository.protectionRules.map((rule) => [rule.pattern, rule.requireApproval, rule.requireStatusCheck]),
      [["main", true, false]],
    );

    // Restore both requirements for the checks of the merge state below.
    await app.request(PROTECTION_URL, {
      method: "POST",
      cookie,
      body: { pattern: "main", requireApproval: true, requireStatusCheck: true },
    });
  });

  it("blocks a direct file change on the protected branch and keeps the branch unchanged", async () => {
    const cookie = await aliceCookie();
    const before = await storedRepository();
    const beforeHead = before.branches.find((branch) => branch.name === "main").headId;

    const refused = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: { branch: "main", path: "bypass.md", content: "bypass", message: "Try to bypass", create: true },
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.fields.branch, "This branch is protected");

    const after = await storedRepository();
    assert.equal(after.branches.find((branch) => branch.name === "main").headId, beforeHead);
    assert.equal(after.commits.length, before.commits.length);

    // A branch without a rule of its own still accepts a file change; `release`
    // is used so the compare branch of the seeded pull requests is untouched.
    const allowed = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: { branch: "release", path: "notes.md", content: "notes", message: "Add notes", create: true },
    });
    assert.equal(allowed.status, 201);
  });

  it("stores the test status of the current compare commit for the Admin only", async () => {
    const current = await app.request(PULL_URL);
    const currentCommitId = current.body.pullRequest.currentCompareCommitId;
    assert.equal(currentCommitId, "c5d8f41-acme-docs-onboarding-notes");

    const bob = await bobCookie();
    const refused = await app.request(`${PULL_URL}/checks`, {
      method: "POST",
      cookie: bob,
      body: { name: "test", status: "success" },
    });
    assert.equal(refused.status, 403);

    const cookie = await aliceCookie();
    const saved = await app.request(`${PULL_URL}/checks`, {
      method: "POST",
      cookie,
      body: { name: "test", status: "success" },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.pullRequest.check.status, "success");
    assert.equal(saved.body.pullRequest.check.setBy, "alice-dev");
    assert.ok(saved.body.pullRequest.check.setAt);

    const reloaded = await app.request(PULL_URL);
    assert.equal(reloaded.body.pullRequest.check.status, "success");
    assert.equal(reloaded.body.pullRequest.check.commitId, currentCommitId);
    assert.equal(reloaded.body.pullRequest.check.setBy, "alice-dev");

    const stored = (await storedPullRequests()).find((pullRequest) => pullRequest.number === 1);
    assert.equal(stored.checks.length, 1);
    assert.equal(stored.checks[0].commitId, currentCommitId);
    assert.equal(stored.checks[0].status, "success");
  });

  it("shows the pull request as unmergeable while the rule is not satisfied", async () => {
    const cookie = await aliceCookie();
    const detail = await app.request(PULL_URL, { cookie });
    assert.equal(detail.body.pullRequest.merge.mergeable, false);
    assert.deepEqual(
      detail.body.pullRequest.merge.blockers.map((blocker) => blocker.code),
      ["approval"],
    );

    const merged = await app.request(`${PULL_URL}/merge`, { method: "POST", cookie });
    assert.equal(merged.status, 400);
    const stored = (await storedPullRequests()).find((pullRequest) => pullRequest.number === 1);
    assert.equal(stored.status, "open");
  });

  it("refuses a merge by an account without merge permission", async () => {
    const bob = await bobCookie();
    const refused = await app.request(`${PULL_URL}/merge`, { method: "POST", cookie: bob });
    assert.equal(refused.status, 403);

    // `carol-maintainer` holds Maintain, so she may merge once the rule allows.
    const carol = await carolCookie();
    const blocked = await app.request(`${PULL_URL}/merge`, { method: "POST", cookie: carol });
    assert.equal(blocked.status, 400);
  });

  it("starts a new compare commit pending and keeps the older result for its own commit", async () => {
    const cookie = await aliceCookie();
    const pushed = await app.request("/api/repositories/alice-dev/acme-docs/contents", {
      method: "POST",
      cookie,
      body: {
        branch: "onboarding-docs",
        path: "src/search.ts",
        content: "export const SEARCH_FLOW_LABEL = \"Search flow\";\n",
        message: "Shorten the search helper",
        create: false,
      },
    });
    assert.equal(pushed.status, 201);
    const newCommitId = pushed.body.commit.id;

    const detail = await app.request(PULL_URL, { cookie });
    assert.equal(detail.body.pullRequest.currentCompareCommitId, newCommitId);
    assert.equal(detail.body.pullRequest.check.commitId, newCommitId);
    assert.equal(detail.body.pullRequest.check.status, "pending");
    assert.equal(detail.body.pullRequest.check.setBy, null);

    const stored = (await storedPullRequests()).find((pullRequest) => pullRequest.number === 1);
    assert.deepEqual(
      stored.checks.map((check) => [check.commitId, check.status]),
      [["c5d8f41-acme-docs-onboarding-notes", "success"]],
    );
  });
});
