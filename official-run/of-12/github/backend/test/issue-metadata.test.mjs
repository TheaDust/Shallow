/**
 * Issue metadata and status writes (REQ-5-3-1, REQ-5-3-2, REQ-5-3-3, REQ-5-4).
 *
 * Every case checks the stored record of the addressed issue — not only the
 * response — that the association belongs to the current repository, and that a
 * refused submission (missing permission, an unknown or foreign item, an
 * unknown status) left every earlier value alone.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAppStore } from "../src/domain/store.mjs";

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
  dataDir = await mkdtemp(join(tmpdir(), "shallow-issue-metadata-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const ISSUES = "/api/repositories/alice-dev/acme-docs/issues";
/** The isolated work item of the metadata scenarios: no metadata at all. */
const TARGET = `${ISSUES}/4`;

const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const carolCookie = () => app.signIn("carol-maintainer", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");
/** The seeded account that holds no role on any repository. */
const outsiderCookie = () => app.signIn("dana-observer", "Valid-password-123!");

/** The stored document, so a case can read the relations that must survive. */
async function storedDocument() {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(join(dataDir, "data.json"), "utf8"));
}

async function storedIssue(number) {
  const data = await storedDocument();
  const issue = data.issues.find((candidate) => candidate.number === number);
  return issue ? JSON.parse(JSON.stringify(issue)) : null;
}

describe("REQ-5-3-1 assign or unassign issue participants", () => {
  it("offers only the accounts with at least Triage permission as assignable members", async () => {
    const detail = await app.request(TARGET, { cookie: await aliceCookie() });
    assert.equal(detail.status, 200);
    // carol-maintainer holds Maintain on the repository, bob-reviewer the Write
    // grant of the review workspace (REQ-6-3) and alice-dev owns it;
    // dana-observer holds no role at all on the public repository.
    assert.deepEqual(detail.body.assignableMembers, ["alice-dev", "bob-reviewer", "carol-maintainer"]);
    assert.equal(detail.body.permissions.canAssignParticipants, true);
  });

  it("assigns and unassigns one member, keeping the activity and the account", async () => {
    const cookie = await aliceCookie();
    const assigned = await app.request(`${TARGET}/assignees`, {
      method: "POST",
      cookie,
      body: { username: "carol-maintainer" },
    });
    assert.equal(assigned.status, 200);
    assert.deepEqual(assigned.body.issue.assignees, ["carol-maintainer"]);
    assert.equal(assigned.body.issue.title, "Add changelog page");
    assert.equal(assigned.body.issue.milestone, null);
    const activity = assigned.body.timeline.at(-1);
    assert.equal(activity.type, "assigned");
    assert.equal(activity.actor, "alice-dev");
    assert.equal(activity.text, "assigned carol-maintainer");

    // The stored association is the one a reload and another caller read.
    const reloaded = await app.request(TARGET, { cookie });
    assert.deepEqual(reloaded.body.issue.assignees, ["carol-maintainer"]);
    const other = await app.request(TARGET, { cookie: await carolCookie() });
    assert.deepEqual(other.body.issue.assignees, ["carol-maintainer"]);

    // The same option removes the association again: only the issue relation
    // disappears, and the historical records stay in the timeline.
    const removed = await app.request(`${TARGET}/assignees`, {
      method: "POST",
      cookie,
      body: { username: "carol-maintainer" },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.issue.assignees, []);
    assert.equal(removed.body.timeline.at(-1).text, "unassigned carol-maintainer");
    assert.equal(removed.body.timeline.some((event) => event.text === "assigned carol-maintainer"), true);

    const document = await storedDocument();
    assert.ok(document.accounts.some((account) => account.username === "carol-maintainer"));
    const repository = document.repositories.find((entry) => entry.name === "acme-docs");
    assert.equal(
      repository.grants.some(
        (grant) => grant.subjectId === "account-carol-maintainer" && grant.role === "Maintain",
      ),
      true,
    );
    const finalRead = await app.request(TARGET, { cookie });
    assert.deepEqual(finalRead.body.issue.assignees, []);
  });

  it("refuses a non-assignable account, an unknown issue and a caller without the role", async () => {
    const cookie = await aliceCookie();
    const before = await storedIssue(4);

    // dana-observer holds no Triage permission, so she cannot be assigned.
    const ineligible = await app.request(`${TARGET}/assignees`, {
      method: "POST",
      cookie,
      body: { username: "dana-observer" },
    });
    assert.equal(ineligible.status, 400);
    assert.ok(ineligible.body.fields.assignee);

    const unknownIssue = await app.request(`${ISSUES}/99/assignees`, {
      method: "POST",
      cookie,
      body: { username: "carol-maintainer" },
    });
    assert.equal(unknownIssue.status, 404);

    // A signed-in viewer without Triage permission is refused and stores nothing.
    const outsider = await outsiderCookie();
    const refused = await app.request(`${TARGET}/assignees`, {
      method: "POST",
      cookie: outsider,
      body: { username: "carol-maintainer" },
    });
    assert.equal(refused.status, 403);

    const anonymous = await app.request(`${TARGET}/assignees`, {
      method: "POST",
      body: { username: "carol-maintainer" },
    });
    assert.equal(anonymous.status, 401);

    assert.deepEqual(await storedIssue(4), before);
  });
});

describe("REQ-5-3-2 apply labels to an issue", () => {
  it("applies and removes a label of the current repository and records both activities", async () => {
    const cookie = await aliceCookie();
    const applied = await app.request(`${TARGET}/labels`, {
      method: "POST",
      cookie,
      body: { label: "bug" },
    });
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.body.issue.labels, ["bug"]);
    assert.equal(applied.body.timeline.at(-1).text, "added the bug label");

    // The same name is displayed by the issue row of the list page.
    const list = await app.request(ISSUES, { cookie });
    assert.deepEqual(list.body.issues.find((issue) => issue.number === 4).labels, ["bug"]);

    const removed = await app.request(`${TARGET}/labels`, {
      method: "POST",
      cookie,
      body: { label: "bug" },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.issue.labels, []);
    assert.equal(removed.body.timeline.at(-1).text, "removed the bug label");
    assert.equal(removed.body.timeline.some((event) => event.text === "added the bug label"), true);

    const reloaded = await app.request(TARGET, { cookie });
    assert.deepEqual(reloaded.body.issue.labels, []);
  });

  it("never creates a label and never offers the labels of another repository", async () => {
    const cookie = await aliceCookie();
    const before = await storedIssue(4);

    // `frontend` belongs to acme-web, not to acme-docs.
    const foreign = await app.request(`${TARGET}/labels`, {
      method: "POST",
      cookie,
      body: { label: "frontend" },
    });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.body.fields.label, "Unknown label");

    const invented = await app.request(`${TARGET}/labels`, {
      method: "POST",
      cookie,
      body: { label: "priority" },
    });
    assert.equal(invented.status, 400);

    const document = await storedDocument();
    const repository = document.repositories.find((entry) => entry.name === "acme-docs");
    assert.deepEqual(repository.labels.map((label) => label.name), ["bug", "documentation"]);
    assert.deepEqual(await storedIssue(4), before);
  });

  it("refuses a Read or Write viewer and an anonymous caller", async () => {
    const before = await storedIssue(4);
    const outsider = await outsiderCookie();
    const refused = await app.request(`${TARGET}/labels`, {
      method: "POST",
      cookie: outsider,
      body: { label: "bug" },
    });
    assert.equal(refused.status, 403);

    const anonymous = await app.request(`${TARGET}/labels`, {
      method: "POST",
      body: { label: "bug" },
    });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await storedIssue(4), before);
  });
});

describe("REQ-5-3-3 assign an issue to a milestone", () => {
  it("stores at most one milestone and removes it with None", async () => {
    const cookie = await carolCookie();
    const selected = await app.request(`${TARGET}/milestone`, {
      method: "POST",
      cookie,
      body: { milestone: "v1.0" },
    });
    assert.equal(selected.status, 200);
    assert.equal(selected.body.issue.milestone, "v1.0");
    assert.equal(selected.body.timeline.at(-1).text, "added this issue to the v1.0 milestone");
    assert.equal(selected.body.timeline.at(-1).actor, "carol-maintainer");

    // Selecting another milestone replaces the association instead of adding one.
    const replaced = await app.request(`${TARGET}/milestone`, {
      method: "POST",
      cookie,
      body: { milestone: "Q3 launch" },
    });
    assert.equal(replaced.body.issue.milestone, "Q3 launch");

    const cleared = await app.request(`${TARGET}/milestone`, {
      method: "POST",
      cookie,
      body: { milestone: "None" },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.issue.milestone, null);
    assert.equal(cleared.body.timeline.at(-1).text, "removed this issue from the Q3 launch milestone");

    const reloaded = await app.request(TARGET, { cookie });
    assert.equal(reloaded.body.issue.milestone, null);
  });

  it("refuses another repository's milestone and a caller without the role", async () => {
    const cookie = await aliceCookie();
    const before = await storedIssue(4);

    // `Web launch` belongs to acme-web.
    const foreign = await app.request(`${TARGET}/milestone`, {
      method: "POST",
      cookie,
      body: { milestone: "Web launch" },
    });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.body.fields.milestone, "Unknown milestone");

    const outsider = await outsiderCookie();
    const refused = await app.request(`${TARGET}/milestone`, {
      method: "POST",
      cookie: outsider,
      body: { milestone: "v1.0" },
    });
    assert.equal(refused.status, 403);

    const document = await storedDocument();
    const repository = document.repositories.find((entry) => entry.name === "acme-docs");
    assert.deepEqual(repository.milestones.map((milestone) => milestone.title), ["Q3 launch", "v1.0"]);
    assert.deepEqual(await storedIssue(4), before);
  });
});

describe("REQ-5-4 close or reopen an issue", () => {
  it("closes and reopens the issue, appending both transitions in order", async () => {
    const cookie = await aliceCookie();
    const before = await app.request(TARGET, { cookie });
    assert.equal(before.body.issue.status, "open");

    const closed = await app.request(`${TARGET}/status`, {
      method: "POST",
      cookie,
      body: { status: "closed" },
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.issue.status, "closed");
    const closeEvent = closed.body.timeline.at(-1);
    assert.equal(closeEvent.type, "closed");
    assert.equal(closeEvent.text, "Closed issue");
    assert.equal(closeEvent.actor, "alice-dev");

    const reopened = await app.request(`${TARGET}/status`, {
      method: "POST",
      cookie,
      body: { status: "open" },
    });
    assert.equal(reopened.body.issue.status, "open");
    assert.equal(reopened.body.timeline.at(-1).text, "Reopened issue");

    // The transition changes nothing but the status: number, title, body,
    // comments, labels, assignees and milestone stay exactly as they were.
    assert.equal(reopened.body.issue.number, before.body.issue.number);
    assert.equal(reopened.body.issue.title, before.body.issue.title);
    assert.equal(reopened.body.issue.body, before.body.issue.body);
    assert.deepEqual(reopened.body.issue.labels, before.body.issue.labels);
    assert.deepEqual(reopened.body.issue.assignees, before.body.issue.assignees);
    assert.equal(reopened.body.issue.milestone, before.body.issue.milestone);
    assert.deepEqual(
      reopened.body.comments.map((comment) => comment.id),
      before.body.comments.map((comment) => comment.id),
    );

    // A reload keeps the final Open state and the appended history.
    const reloaded = await app.request(TARGET, { cookie });
    assert.equal(reloaded.body.issue.status, "open");
    const texts = reloaded.body.timeline.map((event) => event.text);
    assert.ok(texts.indexOf("Closed issue") < texts.indexOf("Reopened issue"));

    const list = await app.request(ISSUES, { cookie });
    assert.equal(list.body.issues.find((issue) => issue.number === 4).status, "open");
  });

  it("keeps the seeded open issue closable and closable again after a reload", async () => {
    const cookie = await aliceCookie();
    const closed = await app.request(`${ISSUES}/3/status`, {
      method: "POST",
      cookie,
      body: { status: "closed" },
    });
    assert.equal(closed.body.issue.status, "closed");
    const list = await app.request(ISSUES, { cookie });
    assert.equal(list.body.issues.find((issue) => issue.number === 3).status, "closed");

    const reopened = await app.request(`${ISSUES}/3/status`, {
      method: "POST",
      cookie,
      body: { status: "open" },
    });
    assert.equal(reopened.body.issue.status, "open");
    assert.equal(reopened.body.issue.title, "Original issue title");
  });

  it("refuses a viewer without issue-management permission and an unknown status", async () => {
    const before = await storedIssue(4);

    const outsider = await outsiderCookie();
    const refused = await app.request(`${TARGET}/status`, {
      method: "POST",
      cookie: outsider,
      body: { status: "closed" },
    });
    assert.equal(refused.status, 403);

    const anonymous = await app.request(`${TARGET}/status`, {
      method: "POST",
      body: { status: "closed" },
    });
    assert.equal(anonymous.status, 401);

    const cookie = await aliceCookie();
    const invalid = await app.request(`${TARGET}/status`, {
      method: "POST",
      cookie,
      body: { status: "merged" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fields.status, "Unknown status");

    assert.deepEqual(await storedIssue(4), before);
  });
});
