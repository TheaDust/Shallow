import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore, createSeedData } from "../src/domain/store.mjs";

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
        store,
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

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "shallow-code-history-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");

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

describe("REQ-4-2-1 view repository commit history", () => {
  it("serves the branch history newest first with the seed message and author", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs/commits");
    assert.equal(response.status, 200);
    assert.equal(response.body.branch, "main");
    assert.equal(response.body.path, "");
    assert.deepEqual(response.body.branches, ["main", "feature-search", "release", "onboarding-docs", "draft-feature"]);
    assert.deepEqual(
      response.body.commits.map((commit) => commit.message),
      ["Document search flow", "Initial commit"],
    );
    const [newest] = response.body.commits;
    assert.equal(newest.author, "alice-dev");
    assert.equal(newest.id, "9c3e5b1-acme-docs-document-search-flow");
    assert.equal(newest.parentId, "4a1f7c2-acme-docs-initial");
    assert.match(newest.createdAt, /^2024-06-01T/);
    assert.deepEqual(
      newest.files.map((file) => `${file.change}:${file.path}`),
      ["modified:README.md", "modified:docs/intro.md", "added:src/search.ts"],
    );
    // The Code page reads the branch file list next to the history.
    assert.deepEqual(response.body.files, ["CONTRIBUTING.md", "docs/intro.md", "README.md", "src/search.ts"]);
  });

  it("scopes the history of a file path to the commits that modified it", async () => {
    const readme = await app.request("/api/repositories/alice-dev/acme-docs/commits?path=README.md");
    assert.equal(readme.status, 200);
    assert.equal(readme.body.path, "README.md");
    assert.deepEqual(
      readme.body.commits.map((commit) => commit.message),
      ["Document search flow", "Initial commit"],
    );

    // `CONTRIBUTING.md` was only written by the first commit on this branch, so
    // the later commit must not appear in its history.
    const contributing = await app.request("/api/repositories/alice-dev/acme-docs/commits?path=CONTRIBUTING.md");
    assert.equal(contributing.status, 200);
    assert.deepEqual(contributing.body.commits.map((commit) => commit.message), ["Initial commit"]);

    const unknown = await app.request("/api/repositories/alice-dev/acme-docs/commits?path=no-such-file.md");
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body.commits, []);

    // The other branch starts from the `main` head, adds `main-only.md` and
    // keeps its own history on top of the shared commits.
    const branch = await app.request("/api/repositories/alice-dev/acme-docs/commits?branch=feature-search");
    assert.equal(branch.status, 200);
    assert.deepEqual(
      branch.body.commits.map((commit) => commit.message),
      ["Add branch-only notes", "Document search flow", "Initial commit"],
    );
    assert.deepEqual(
      branch.body.files,
      ["CONTRIBUTING.md", "docs/intro.md", "main-only.md", "README.md", "src/search.ts"],
    );

    assert.equal(
      (await app.request("/api/repositories/alice-dev/acme-docs/commits?branch=no-such-branch")).status,
      404,
    );
  });

  it("keeps the history stable after the store is reopened", async () => {
    const reopened = await startApp(dataDir);
    try {
      const response = await reopened.request("/api/repositories/alice-dev/acme-docs/commits?path=README.md");
      assert.deepEqual(
        response.body.commits.map((commit) => commit.message),
        ["Document search flow", "Initial commit"],
      );
    } finally {
      await new Promise((resolve) => reopened.server.close(resolve));
    }
  });

  it("reports the commit count of the branch next to the file list", async () => {
    const contents = await app.request("/api/repositories/alice-dev/acme-docs/contents");
    assert.equal(contents.status, 200);
    assert.equal(contents.body.commitCount, 2);
    const branchContents = await app.request("/api/repositories/alice-dev/acme-docs/contents?branch=feature-search");
    assert.equal(branchContents.body.commitCount, 3);
  });

  it("hides the history of a private repository from a visitor", async () => {
    const visitor = await app.request("/api/repositories/alice-dev/secret-research/commits");
    assert.equal(visitor.status, 403);
    // Its owner and an authorized collaborator do read it.
    assert.equal(
      (await app.request("/api/repositories/alice-dev/secret-research/commits", { cookie: await aliceCookie() })).status,
      200,
    );
    assert.equal(
      (await app.request("/api/repositories/alice-dev/secret-research/commits", { cookie: await bobCookie() })).status,
      200,
    );
  });
});

describe("REQ-4-2-2 inspect commit and revision differences", () => {
  it("compares a commit with its parent and lists only changed files", async () => {
    const response = await app.request(
      "/api/repositories/alice-dev/acme-docs/commits/9c3e5b1-acme-docs-document-search-flow",
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.branch, "main");
    assert.equal(response.body.commit.message, "Document search flow");
    assert.equal(response.body.base.ref, "4a1f7c2-acme-docs-initial");
    assert.equal(response.body.compare.ref, "9c3e5b1-acme-docs-document-search-flow");
    assert.equal(response.body.summary.filesChanged, 3);
    assert.ok(response.body.summary.additions > 0);
    assert.deepEqual(
      response.body.files.map((file) => `${file.change}:${file.path}`),
      ["modified:README.md", "modified:docs/intro.md", "added:src/search.ts"],
    );
    // An unchanged file never appears in a comparison.
    assert.equal(response.body.files.some((file) => file.path === "CONTRIBUTING.md"), false);
    const added = response.body.files.find((file) => file.path === "src/search.ts");
    assert.equal(added.additions, added.lines.filter((line) => line.type === "added").length);
    assert.equal(added.deletions, 0);
    assert.ok(added.lines.every((line) => line.type === "added"));
    const modified = response.body.files.find((file) => file.path === "README.md");
    // The seed change both adds and deletes lines of `README.md`.
    assert.ok(modified.lines.some((line) => line.type === "added"));
    assert.ok(modified.lines.some((line) => line.type === "removed"));
    assert.ok(modified.additions > 0);
    assert.ok(modified.deletions > 0);
    assert.ok(response.body.summary.deletions > 0);

    assert.equal((await app.request("/api/repositories/alice-dev/acme-docs/commits/no-such-commit")).status, 404);
  });

  it("compares two revisions and refuses an unknown revision without a diff", async () => {
    const revision = "4a1f7c2-acme-docs-initial";
    const response = await app.request(
      `/api/repositories/alice-dev/acme-docs/compare?base=${revision}&compare=9c3e5b1-acme-docs-document-search-flow`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.base.ref, revision);
    assert.equal(response.body.compare.ref, "9c3e5b1-acme-docs-document-search-flow");
    assert.equal(response.body.summary.filesChanged, 3);

    // A branch name is a revision too, and the default-branch-first order of
    // the comparison pages is derived from the stored branches.
    // The other branch starts from the `main` head, adds `main-only.md` and
    // drops one line of `src/search.ts`, so the comparison lists exactly those
    // two changed paths.
    const branches = await app.request("/api/repositories/alice-dev/acme-docs/compare?base=main&compare=feature-search");
    assert.equal(branches.status, 200);
    assert.equal(branches.body.base.type, "branch");
    assert.deepEqual(
      branches.body.files.map((file) => file.path),
      ["main-only.md", "src/search.ts"],
    );
    assert.deepEqual(branches.body.summary, { filesChanged: 2, additions: 3, deletions: 1 });

    const unknown = await app.request("/api/repositories/alice-dev/acme-docs/compare?base=nope&compare=main");
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, "Unknown revision");
    assert.equal(unknown.body.files, undefined);

    const incomplete = await app.request("/api/repositories/alice-dev/acme-docs/compare?base=main");
    assert.equal(incomplete.status, 400);
    assert.ok(incomplete.body.fields.compare);
  });

  it("lists the selectable revisions of the repository", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs/revisions");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.branches, ["main", "feature-search", "release", "onboarding-docs", "draft-feature"]);
    const branches = response.body.revisions.filter((entry) => entry.type === "branch").map((entry) => entry.value);
    assert.deepEqual(branches, ["main", "feature-search", "release", "onboarding-docs", "draft-feature"]);
    const commits = response.body.revisions.filter((entry) => entry.type === "commit");
    assert.equal(commits.length, 5);
    // The newest stored commit comes first and its label carries its message.
    assert.ok(commits[0].label.includes("Start the onboarding draft"));
    assert.ok(commits.some((entry) => entry.label.includes("Document search flow")));
    assert.ok(commits.some((entry) => entry.label.includes("Add branch-only notes")));
  });

  it("does not write anything while comparing", async () => {
    const before = JSON.stringify(await storedRepository());
    await app.request("/api/repositories/alice-dev/acme-docs/compare?base=main&compare=9c3e5b1-acme-docs-document-search-flow");
    await app.request("/api/repositories/alice-dev/acme-docs/commits/9c3e5b1-acme-docs-document-search-flow");
    await app.request("/api/repositories/alice-dev/acme-docs/revisions");
    assert.equal(JSON.stringify(await storedRepository()), before);
  });

  it("refuses the comparison of a private repository for a visitor", async () => {
    const response = await app.request("/api/repositories/alice-dev/secret-research/compare?base=main&compare=main");
    assert.equal(response.status, 403);
    assert.equal(response.body.files, undefined);
  });
});

describe("REQ-4-2-3 search code within a repository", () => {
  it("returns the matching files, snippets and branch of the repository", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs/code-search?q=search%20flow");
    assert.equal(response.status, 200);
    assert.equal(response.body.repository.fullName, "alice-dev/acme-docs");
    assert.deepEqual(
      response.body.results.map((result) => `${result.branch}:${result.path}`),
      ["main:README.md", "main:src/search.ts"],
    );
    const readme = response.body.results.find((result) => result.path === "README.md");
    assert.equal(readme.name, "README.md");
    assert.ok(readme.snippet.includes("search flow"));
    assert.ok(readme.lines[0].number > 0);
    assert.ok(readme.lines[0].text.includes("search flow"));
    assert.ok(response.body.languages.includes("Markdown"));
  });

  it("filters by path and language and keeps an empty result for an absent term", async () => {
    const underSrc = await app.request("/api/repositories/alice-dev/acme-docs/code-search?q=search%20flow&path=src/");
    assert.deepEqual(underSrc.body.results.map((result) => result.path), ["src/search.ts"]);

    const markdown = await app.request(
      "/api/repositories/alice-dev/acme-docs/code-search?q=search%20flow&language=Markdown",
    );
    assert.deepEqual(markdown.body.results.map((result) => result.path), ["README.md"]);

    const absent = await app.request("/api/repositories/alice-dev/acme-docs/code-search?q=no-such-token");
    assert.equal(absent.status, 200);
    assert.equal(absent.body.query, "no-such-token");
    assert.deepEqual(absent.body.results, []);

    const empty = await app.request("/api/repositories/alice-dev/acme-docs/code-search?q=");
    assert.deepEqual(empty.body.results, []);
  });

  it("never leaks another repository's content and never writes", async () => {
    const before = JSON.stringify(await storedRepository());
    const response = await app.request("/api/repositories/alice-dev/acme-docs/code-search?q=must%20not%20leak");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.results, []);

    // The private repository holds the term, and an unauthorized visitor
    // cannot read it at all.
    const denied = await app.request("/api/repositories/alice-dev/secret-research/code-search?q=search%20flow");
    assert.equal(denied.status, 403);
    const authorized = await app.request("/api/repositories/alice-dev/secret-research/code-search?q=search%20flow", {
      cookie: await aliceCookie(),
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(authorized.body.results.map((result) => result.path), ["research/notes.md"]);
    assert.equal(JSON.stringify(await storedRepository()), before);
  });
});
