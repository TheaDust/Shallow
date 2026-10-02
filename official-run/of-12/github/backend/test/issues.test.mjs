import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { issuePermissions } from "../src/domain/issues.mjs";
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
  dataDir = await mkdtemp(join(tmpdir(), "shallow-issues-"));
  app = await startApp(dataDir);
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const aliceCookie = () => app.signIn("alice-dev", "Valid-password-123!");
const bobCookie = () => app.signIn("bob-reviewer", "Valid-password-123!");

describe("REQ-5-1-1 read the issue rows of a repository", () => {
  it("serves the seeded rows of acme-docs to a visitor without a session", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs/issues");
    assert.equal(response.status, 200);
    const payload = response.body;
    assert.equal(payload.repository.fullName, "alice-dev/acme-docs");
    assert.equal(payload.viewerRole, null);
    assert.equal(payload.openCount, 3);
    assert.equal(payload.closedCount, 1);

    assert.deepEqual(
      payload.issues.map((issue) => [issue.number, issue.title, issue.status]),
      [
        [1, "Improve onboarding", "open"],
        [2, "Legacy welcome text", "closed"],
        [3, "Original issue title", "open"],
        // The isolated work item of the metadata scenarios: it starts without
        // any assignee, label or milestone (REQ-5-3).
        [4, "Add changelog page", "open"],
      ],
    );
    assert.deepEqual(payload.issues[3].labels, []);
    assert.deepEqual(payload.issues[3].assignees, []);
    assert.equal(payload.issues[3].milestone, null);
    const open = payload.issues[0];
    assert.equal(open.author, "alice-dev");
    assert.deepEqual(open.labels, ["bug", "documentation"]);
    assert.deepEqual(open.assignees, ["bob-reviewer"]);
    assert.equal(open.milestone, "Q3 launch");
    assert.equal(open.body, "Describe the onboarding improvement.");
    assert.equal(open.commentCount, 1);
    assert.equal(typeof open.updatedAt, "string");

    const closed = payload.issues[1];
    assert.equal(closed.author, "bob-reviewer");
    assert.deepEqual(closed.labels, ["bug"]);
  });

  it("publishes the pre-existing labels and milestones of the repository", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs/issues");
    assert.deepEqual(
      response.body.labels.map((label) => label.name),
      ["bug", "documentation"],
    );
    assert.equal(response.body.labels[0].color.length > 0, true);
    assert.deepEqual(
      response.body.milestones.map((milestone) => milestone.title),
      ["Q3 launch", "v1.0"],
    );

    // The assignable members of the repository: every account holding at least
    // Triage permission. The visitor reading the payload sees the names, and
    // an account without a repository role is not among them (REQ-5-3-1).
    // The accounts with at least Triage permission on the public repository are
    // its owner, the Maintain grant of carol-maintainer and the Write grant of
    // bob-reviewer (REQ-6-3).
    assert.deepEqual(response.body.assignableMembers, ["alice-dev", "bob-reviewer", "carol-maintainer"]);
  });

  it("reads the same rows before and after the page is reloaded", async () => {
    const first = await app.request("/api/repositories/alice-dev/acme-docs/issues");
    const second = await app.request("/api/repositories/alice-dev/acme-docs/issues");
    assert.deepEqual(second.body.issues, first.body.issues);
  });

  it("serves an empty issue list for a repository without work items", async () => {
    const response = await app.request("/api/repositories/acme-demo/acme-web/issues");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.issues, []);
    assert.equal(response.body.openCount, 0);
    assert.equal(response.body.closedCount, 0);
  });

  it("refuses the issue rows of a private repository to a caller without access", async () => {
    const denied = await app.request("/api/repositories/alice-dev/secret-research/issues");
    assert.equal(denied.status, 403);

    // bob-reviewer holds Write on the private repository, so he reads its
    // protected work item without being allowed to manage it.
    const cookie = await bobCookie();
    const allowed = await app.request("/api/repositories/alice-dev/secret-research/issues", { cookie });
    assert.equal(allowed.status, 200);
    assert.deepEqual(
      allowed.body.issues.map((issue) => [issue.number, issue.title]),
      [[1, "Summarize the early findings"]],
    );
  });
});

describe("REQ-5-1-2 read one issue and its discussion", () => {
  it("serves the seeded open issue with its metadata, comments and activity", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs/issues/1");
    assert.equal(response.status, 200);
    const payload = response.body;
    assert.equal(payload.issue.number, 1);
    assert.equal(payload.issue.title, "Improve onboarding");
    assert.equal(payload.issue.status, "open");
    assert.equal(payload.issue.body, "Describe the onboarding improvement.");
    assert.deepEqual(payload.issue.labels, ["bug", "documentation"]);
    assert.deepEqual(payload.issue.assignees, ["bob-reviewer"]);
    assert.equal(payload.issue.milestone, "Q3 launch");

    assert.equal(payload.comments.length, 1);
    assert.equal(payload.comments[0].author, "bob-reviewer");
    assert.equal(payload.comments[0].body, "Great idea. Let us start with the welcome screen.");

    const timeline = payload.timeline;
    assert.equal(timeline[0].type, "created");
    assert.equal(timeline[timeline.length - 1].type, "commented");
    const times = timeline.map((event) => Date.parse(event.createdAt));
    assert.deepEqual(times, [...times].sort((left, right) => left - right));
    assert.deepEqual(
      timeline.filter((event) => event.type === "commented").map((event) => event.actor),
      ["bob-reviewer"],
    );
  });

  it("serves the seeded closed issue with its stored status", async () => {
    const response = await app.request("/api/repositories/alice-dev/acme-docs/issues/2");
    assert.equal(response.status, 200);
    assert.equal(response.body.issue.title, "Legacy welcome text");
    assert.equal(response.body.issue.status, "closed");
    assert.equal(response.body.issue.author, "bob-reviewer");
    assert.deepEqual(response.body.comments, []);
    assert.equal(response.body.timeline.some((event) => event.type === "closed"), true);
  });

  it("answers an unknown or malformed number without issue content", async () => {
    const unknown = await app.request("/api/repositories/alice-dev/acme-docs/issues/99");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.issue, undefined);

    const malformed = await app.request("/api/repositories/alice-dev/acme-docs/issues/abc");
    assert.equal(malformed.status, 404);

    const missingRepository = await app.request("/api/repositories/alice-dev/not-a-repository/issues/1");
    assert.equal(missingRepository.status, 404);
  });

  it("hides a private issue from a caller without access and serves it to a collaborator", async () => {
    const denied = await app.request("/api/repositories/alice-dev/secret-research/issues/1");
    assert.equal(denied.status, 403);
    assert.equal(denied.body.issue, undefined);

    const cookie = await bobCookie();
    const allowed = await app.request("/api/repositories/alice-dev/secret-research/issues/1", { cookie });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.issue.title, "Summarize the early findings");
    // Write may read and comment, but neither close nor reopen the work item.
    assert.equal(allowed.body.permissions.canComment, true);
    assert.equal(allowed.body.permissions.canChangeStatus, false);
  });

  it("reports the operation-specific permissions of the caller", async () => {
    const visitor = await app.request("/api/repositories/alice-dev/acme-docs/issues/1");
    assert.deepEqual(visitor.body.permissions, {
      canCreateIssue: false,
      canEditIssue: false,
      canComment: false,
      canAssignParticipants: false,
      canApplyLabels: false,
      canSetMilestone: false,
      canChangeStatus: false,
    });

    const alice = await aliceCookie();
    const owner = await app.request("/api/repositories/alice-dev/acme-docs/issues/1", { cookie: alice });
    assert.equal(owner.body.viewerRole, "Admin");
    assert.equal(owner.body.permissions.canEditIssue, true);
    assert.equal(owner.body.permissions.canApplyLabels, true);
    assert.equal(owner.body.permissions.canChangeStatus, true);

    // bob-reviewer holds Write on secret-research: he may comment and edit, but
    // neither label nor assign nor change the status.
    const bob = await bobCookie();
    const writer = await app.request("/api/repositories/alice-dev/secret-research/issues", { cookie: bob });
    assert.equal(writer.body.viewerRole, "Write");
    assert.equal(writer.body.permissions.canComment, true);
    assert.equal(writer.body.permissions.canCreateIssue, true);
    assert.equal(writer.body.permissions.canApplyLabels, false);
    assert.equal(writer.body.permissions.canSetMilestone, false);
    assert.equal(writer.body.permissions.canChangeStatus, false);
    assert.equal(writer.body.permissions.canAssignParticipants, false);
  });
});

describe("REQ-5 issue permission rules", () => {
  const repository = {
    id: "repository-test",
    ownerType: "organization",
    ownerId: "organization-test",
    grants: [
      { subjectType: "account", subjectId: "account-read", role: "Read" },
      { subjectType: "account", subjectId: "account-triage", role: "Triage" },
      { subjectType: "account", subjectId: "account-write", role: "Write" },
      { subjectType: "account", subjectId: "account-maintain", role: "Maintain" },
    ],
  };
  const data = {
    memberships: [{ organizationId: "organization-test", accountId: "account-owner", role: "Owner" }],
    teamMembers: [],
    repositories: [repository],
  };

  function allowed(accountId) {
    const permissions = issuePermissions(data, repository, accountId);
    return {
      content: permissions.canCreateIssue && permissions.canEditIssue && permissions.canComment,
      triage: permissions.canAssignParticipants
        && permissions.canApplyLabels
        && permissions.canSetMilestone
        && permissions.canChangeStatus,
    };
  }

  it("grants each operation by its own explicit role list", () => {
    assert.deepEqual(allowed(null), { content: false, triage: false });
    assert.deepEqual(allowed("account-read"), { content: false, triage: false });
    assert.deepEqual(allowed("account-triage"), { content: false, triage: true });
    assert.deepEqual(allowed("account-write"), { content: true, triage: false });
    assert.deepEqual(allowed("account-maintain"), { content: true, triage: true });
    assert.deepEqual(allowed("account-owner"), { content: true, triage: true });
  });
});
