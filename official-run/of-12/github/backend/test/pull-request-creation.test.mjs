import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore, createSeedData } from "../src/domain/store.mjs";

/**
 * REQ-6-2: the Pull requests page of a repository lists the persisted pull
 * requests of that repository and can filter them, a valid branch comparison is
 * read-only context, and creating a pull request — Open or Draft — stores the
 * complete record in one atomic write. Every refusal leaves no partial record,
 * and a draft becomes Open through the ready-for-review transition.
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

async function storedDocument() {
  try {
    return JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return createSeedData();
  }
}

async function storedPullRequests() {
  return (await storedDocument()).pullRequests;
}

const PULLS = "/api/repositories/alice-dev/acme-docs/pulls";
const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const signInAs = (username) => app.signIn(username, "Valid-password-123!");

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-code-pulls-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

describe("REQ-6-2-1 list and filter repository pull requests", () => {
  it("serves the seeded rows of the repository to a visitor without a session", async () => {
    const response = await app.request(PULLS);
    assert.equal(response.status, 200);
    assert.equal(response.body.viewerRole, null);
    assert.equal(response.body.canCreatePullRequest, false);
    assert.deepEqual(
      response.body.pullRequests.map((row) => ({
        number: row.number,
        title: row.title,
        author: row.author,
        status: row.status,
        baseBranch: row.baseBranch,
        compareBranch: row.compareBranch,
      })),
      [
        {
          number: 1,
          title: "Improve onboarding",
          author: "alice-dev",
          status: "open",
          baseBranch: "main",
          compareBranch: "onboarding-docs",
        },
        {
          number: 2,
          title: "Fix search",
          author: "alice-dev",
          status: "closed",
          baseBranch: "main",
          compareBranch: "feature-search",
        },
        {
          number: 3,
          title: "Draft onboarding update",
          author: "alice-dev",
          status: "draft",
          baseBranch: "main",
          compareBranch: "draft-feature",
        },
        // REQ-6-3: the Open pull requests of the review workspace seeds.
        {
          number: 4,
          title: "Add onboarding notes for the release",
          author: "alice-dev",
          status: "open",
          baseBranch: "release",
          compareBranch: "onboarding-docs",
        },
        {
          number: 5,
          title: "Add draft notes for the release",
          author: "alice-dev",
          status: "open",
          baseBranch: "release",
          compareBranch: "draft-feature",
        },
      ],
    );
    // Every row carries the derived review status the list page filters by.
    assert.deepEqual(
      response.body.pullRequests.map((row) => row.reviewStatus),
      ["review_required", "review_required", "review_required", "review_required", "review_required"],
    );
  });

  it("offers the creation entry only to a caller with write permission", async () => {
    const guest = await app.request(PULLS);
    assert.equal(guest.body.canCreatePullRequest, false);

    const carol = await app.request(PULLS, { cookie: await signInAs("carol-maintainer") });
    assert.equal(carol.body.canCreatePullRequest, true);

    const alice = await app.request(PULLS, { cookie: await signInAs("alice-dev") });
    assert.equal(alice.body.canCreatePullRequest, true);
  });

  it("reads the rows of one repository only and never writes while filtering", async () => {
    const before = JSON.stringify(await storedDocument());
    const other = await app.request("/api/repositories/acme-demo/acme-web/pulls");
    assert.equal(other.status, 200);
    assert.deepEqual(other.body.pullRequests, []);
    await app.request(PULLS);
    assert.equal(JSON.stringify(await storedDocument()), before);

    // A private repository the visitor may not read answers without content.
    const privateList = await app.request("/api/repositories/alice-dev/secret-research/pulls");
    assert.equal(privateList.status, 403);
  });
});

describe("REQ-6-2-2 compare branches before opening a pull request", () => {
  it("reads the commits, changed files and summary of the two branch heads", async () => {
    const response = await app.request(
      "/api/repositories/alice-dev/acme-docs/compare?base=main&compare=feature-search",
    );
    assert.equal(response.status, 200);
    assert.ok(response.body.files.some((file) => file.path === "src/search.ts"));
    assert.ok(response.body.summary.filesChanged >= 1);
  });

  it("reports no changed file when both sides are the same branch", async () => {
    const response = await app.request(
      "/api/repositories/alice-dev/acme-docs/compare?base=main&compare=main",
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.files, []);
    assert.equal(response.body.summary.filesChanged, 0);
  });

  it("does not store a pull request, a commit or a branch change while comparing", async () => {
    const before = JSON.stringify(await storedDocument());
    await app.request("/api/repositories/alice-dev/acme-docs/compare?base=main&compare=feature-search");
    await app.request("/api/repositories/alice-dev/acme-docs/compare?base=main&compare=draft-feature");
    assert.equal(JSON.stringify(await storedDocument()), before);
  });
});

describe("REQ-6-2-3 create a pull request from comparison results", () => {
  it("refuses a visitor and an account without creation permission", async () => {
    const anonymous = await app.request(PULLS, {
      method: "POST",
      body: { title: "Anonymous attempt", base: "main", compare: "feature-search" },
    });
    assert.equal(anonymous.status, 401);

    const outsider = await app.request(PULLS, {
      method: "POST",
      cookie: await signInAs("dana-observer"),
      body: { title: "Read only attempt", base: "main", compare: "feature-search" },
    });
    assert.equal(outsider.status, 403);
    assert.deepEqual(
      (await storedPullRequests())
        .filter((pullRequest) => pullRequest.repositoryId === "repository-alice-dev-acme-docs")
        .map((pullRequest) => pullRequest.number),
      [1, 2, 3, 4, 5],
    );
  });

  it("creates the open pull request with every stored field and no review of its own", async () => {
    const cookie = await aliceCookie();
    const created = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: {
        title: "  Document the search flow  ",
        description: "Explain the search flow on the onboarding page.",
        base: "main",
        compare: "feature-search",
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.pullRequest.number, 6);
    assert.equal(created.body.pullRequest.title, "Document the search flow");
    assert.equal(created.body.pullRequest.description, "Explain the search flow on the onboarding page.");
    assert.equal(created.body.pullRequest.status, "open");
    assert.equal(created.body.pullRequest.author, "alice-dev");
    assert.equal(created.body.pullRequest.baseBranch, "main");
    assert.equal(created.body.pullRequest.compareBranch, "feature-search");
    assert.match(created.body.pullRequest.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(created.body.pullRequest.timeline.map((event) => event.text), ["opened this pull request"]);
    assert.equal(created.body.pullRequest.permissions.canCreate, true);

    const stored = (await storedPullRequests()).find((pullRequest) => pullRequest.number === 6);
    assert.equal(stored.baseCommitId, "9c3e5b1-acme-docs-document-search-flow");
    assert.equal(stored.compareCommitId, "d7b2a08-acme-docs-branch-notes");

    // The new pull request is readable from the list and from its own address.
    const list = await app.request(PULLS);
    assert.ok(list.body.pullRequests.some((row) => row.number === 6 && row.title === "Document the search flow"));
    const detail = await app.request(`${PULLS}/6`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.pullRequest.title, "Document the search flow");

    // Reopening the store keeps the created record.
    const reopened = await startApp(dataDir);
    try {
      const again = await reopened.request(`${PULLS}/6`);
      assert.equal(again.status, 200);
      assert.equal(again.body.pullRequest.status, "open");
      assert.equal(again.body.pullRequest.title, "Document the search flow");
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("rejects a second proposal for the same pair and stores nothing", async () => {
    const cookie = await aliceCookie();
    const before = await storedPullRequests();
    const duplicate = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: { title: "Improve onboarding again", base: "main", compare: "feature-search" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.fields.compare, "A pull request for these branches already exists");
    assert.equal((await storedPullRequests()).length, before.length);
  });

  it("rejects the same branch, an unknown branch and a pair without differences", async () => {
    const cookie = await aliceCookie();
    const before = await storedPullRequests();

    const same = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: { title: "Same branch", base: "main", compare: "main" },
    });
    assert.equal(same.status, 400);
    assert.equal(same.body.fields.compare, "Choose two different branches");

    const unknown = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: { title: "Unknown branch", base: "main", compare: "no-such-branch" },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fields.compare, "Branch not found");

    // `release` points at the same commit as `main`, so the pair has no
    // comparable change at all.
    const unchanged = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: { title: "No changes", base: "main", compare: "release" },
    });
    assert.equal(unchanged.status, 400);
    assert.equal(unchanged.body.fields.compare, "There are no changes between these branches");

    assert.deepEqual(await storedPullRequests(), before);
  });

  it("rejects a blank, overlong or overlong-description proposal without a record", async () => {
    const cookie = await aliceCookie();
    const before = await storedPullRequests();

    const blank = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: { title: "   ", base: "main", compare: "draft-feature" },
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.fields.title, "Title is required");

    const longTitle = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: { title: "t".repeat(257), base: "main", compare: "draft-feature" },
    });
    assert.equal(longTitle.status, 400);
    assert.equal(longTitle.body.fields.title, "Title must be 256 characters or fewer");

    const longDescription = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: {
        title: "Long description",
        description: "d".repeat(65537),
        base: "main",
        compare: "draft-feature",
      },
    });
    assert.equal(longDescription.status, 400);
    assert.equal(longDescription.body.fields.description, "Description must be 65536 characters or fewer");

    assert.deepEqual(await storedPullRequests(), before);
  });
});

describe("REQ-6-2-4 create a draft pull request and mark it ready for review", () => {
  it("creates a draft that cannot be merged and survives a reload", async () => {
    const cookie = await aliceCookie();
    // `feature-search` ← `main` differs from the pair of the pull request
    // created above and carries no Open or Draft pull request, so it is a valid
    // creation context of this isolated store.
    const created = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: {
        title: "Draft the search notes",
        description: "",
        base: "feature-search",
        compare: "main",
        draft: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.pullRequest.status, "draft");
    assert.equal(created.body.pullRequest.merge.mergeable, false);
    assert.deepEqual(created.body.pullRequest.merge.blockers.map((blocker) => blocker.code), ["draft"]);
    assert.equal(created.body.pullRequest.permissions.canMarkReady, true);
    const number = created.body.pullRequest.number;

    const merged = await app.request(`${PULLS}/${number}/merge`, { method: "POST", cookie });
    assert.equal(merged.status, 400);
    assert.equal((await storedPullRequests()).find((pullRequest) => pullRequest.number === number).status, "draft");

    // The plain creation of the same pair is refused while the draft exists.
    const duplicate = await app.request(PULLS, {
      method: "POST",
      cookie,
      body: { title: "Same pair as draft", base: "feature-search", compare: "main" },
    });
    assert.equal(duplicate.status, 400);
  });

  it("moves the ready-for-review seed pull request from Draft to Open for its author", async () => {
    const before = (await storedPullRequests()).find((pullRequest) => pullRequest.number === 3);
    const cookie = await aliceCookie();
    const ready = await app.request(`${PULLS}/3/ready`, { method: "POST", cookie });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.pullRequest.number, 3);
    assert.equal(ready.body.pullRequest.status, "open");
    assert.equal(ready.body.pullRequest.title, before.title);
    assert.equal(ready.body.pullRequest.baseBranch, "main");
    assert.equal(ready.body.pullRequest.compareBranch, "draft-feature");

    const stored = (await storedPullRequests()).find((pullRequest) => pullRequest.number === 3);
    assert.equal(stored.status, "open");
    assert.equal(stored.compareCommitId, before.compareCommitId);
    assert.equal(stored.title, before.title);
    assert.ok(stored.timeline.some((event) => event.type === "ready_for_review"));
    assert.match(
      stored.timeline.find((event) => event.type === "ready_for_review").text,
      /Ready for review/,
    );

    // Reopening the stored document keeps the new status.
    const reopened = await startApp(dataDir);
    try {
      const again = await reopened.request(`${PULLS}/3`);
      assert.equal(again.body.pullRequest.status, "open");
      assert.equal(again.body.pullRequest.title, "Draft onboarding update");
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("refuses ready-for-review by a foreign account and on a pull request that is not a draft", async () => {
    const bob = await app.request(`${PULLS}/1/ready`, {
      method: "POST",
      cookie: await signInAs("bob-reviewer"),
    });
    assert.equal(bob.status, 403);

    const anonymous = await app.request(`${PULLS}/1/ready`, { method: "POST" });
    assert.equal(anonymous.status, 401);

    // Pull request 1 is Open, so a maintainer cannot mark it ready again.
    const carol = await app.request(`${PULLS}/1/ready`, {
      method: "POST",
      cookie: await signInAs("carol-maintainer"),
    });
    assert.equal(carol.status, 400);
    assert.equal((await storedPullRequests()).find((pullRequest) => pullRequest.number === 1).status, "open");
  });
});
