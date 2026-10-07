// REQ-5-1 and REQ-5-2 over the real HTTP surface: the issues list and detail of
// a public repository, the read-only nature of filtering, issue creation with a
// repository-scoped number, discussion comments, the required-field rules and
// the operation-specific permissions (Write may create and comment, a read-only
// account may not).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createAuthStore } from "../src/lib/auth-store.mjs";
import { createOrgStore } from "../src/lib/org-store.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-issue-"));
  return startDataDir(dataDir);
}

/** A second app over the same data directory models a restart. */
async function startDataDir(dataDir) {
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

async function signIn(baseUrl, username) {
  const response = await request(baseUrl, "POST", "/api/auth/sign-in", {
    identifier: username,
    password: "Valid-password-123!",
  });
  assert.equal(response.status, 200, `sign-in of ${username} failed`);
  return response.cookie;
}

const ISSUES = "/api/repositories/acme-demo/acme-docs/issues";

test("a visitor reads the seeded issue list of the public repository", async () => {
  const app = await startApp();
  try {
    const listed = await request(app.baseUrl, "GET", ISSUES);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.repository.name, "acme-docs");
    assert.equal(listed.body.canWrite, false);
    assert.equal(listed.body.canTriage, false);

    const open = listed.body.issues.find((issue) => issue.title === "Improve onboarding");
    assert.equal(open.number, 1);
    assert.equal(open.status, "open");
    assert.equal(open.author, "alice-dev");
    assert.deepEqual(open.labels.map((label) => label.name), ["documentation"]);

    const closed = listed.body.issues.find((issue) => issue.title === "Legacy welcome text");
    assert.equal(closed.status, "closed");

    // Reading is read-only: the stored rows are unchanged by a second read.
    const again = await request(app.baseUrl, "GET", ISSUES);
    assert.equal(again.body.issues.length, listed.body.issues.length);
  } finally {
    await app.close();
  }
});

test("a visitor reads one issue with its description, discussion and timeline", async () => {
  const app = await startApp();
  try {
    const detail = await request(app.baseUrl, "GET", `${ISSUES}/1`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.issue.title, "Improve onboarding");
    assert.equal(detail.body.issue.description, "Describe the onboarding improvement.");
    assert.equal(detail.body.issue.status, "open");
    assert.equal(detail.body.issue.number, 1);
    assert.equal(detail.body.comments.length, 1);
    assert.equal(detail.body.comments[0].author, "alice-dev");
    assert.ok(detail.body.comments[0].body.length > 0);
    assert.deepEqual(
      detail.body.events.map((event) => event.type),
      ["created", "commented"],
    );

    const missing = await request(app.baseUrl, "GET", `${ISSUES}/99`);
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test("issues of a private repository stay unreadable for a visitor", async () => {
  const app = await startApp();
  try {
    const denied = await request(
      app.baseUrl,
      "GET",
      "/api/repositories/acme-demo/secret-research/issues",
    );
    assert.equal(denied.status, 403);
  } finally {
    await app.close();
  }
});

test("issue-write permission is required and the author's issue persists", async () => {
  const app = await startApp();
  try {
    const viewer = await signIn(app.baseUrl, "default-branch-viewer");
    const readOnlyCreate = await request(app.baseUrl, "POST", ISSUES, { title: "Nope" }, viewer);
    assert.equal(readOnlyCreate.status, 403);

    // A new issue takes the next number the repository has not used yet.
    const before = await request(app.baseUrl, "GET", ISSUES);
    const nextNumber = Math.max(...before.body.issues.map((issue) => issue.number)) + 1;

    const author = await signIn(app.baseUrl, "issue-author");
    const created = await request(
      app.baseUrl,
      "POST",
      ISSUES,
      { title: "Fix the welcome banner", description: "The banner text is stale." },
      author,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.issue.title, "Fix the welcome banner");
    assert.equal(created.body.issue.description, "The banner text is stale.");
    assert.equal(created.body.issue.status, "open");
    assert.equal(created.body.issue.author, "issue-author");
    assert.equal(created.body.issue.number, nextNumber);
    assert.equal(created.body.canWrite, true);
    assert.equal(created.body.canTriage, false);

    const listed = await request(app.baseUrl, "GET", ISSUES);
    assert.ok(listed.body.issues.some((issue) => issue.title === "Fix the welcome banner"));

    // The same record is read back after a restart of the application.
    const restarted = await startDataDir(app.dataDir);
    try {
      const again = await request(restarted.baseUrl, "GET", `${ISSUES}/${nextNumber}`);
      assert.equal(again.status, 200);
      assert.equal(again.body.issue.title, "Fix the welcome banner");
      assert.equal(again.body.issue.description, "The banner text is stale.");
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a whitespace-only title is rejected and creates no issue", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "GET", ISSUES);
    const author = await signIn(app.baseUrl, "issue-author");
    const rejected = await request(app.baseUrl, "POST", ISSUES, { title: "   " }, author);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fieldErrors.title, "Title is required");

    const after = await request(app.baseUrl, "GET", ISSUES);
    assert.equal(after.body.issues.length, before.body.issues.length);

    const tooLong = await request(app.baseUrl, "POST", ISSUES, { title: "x".repeat(257) }, author);
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.fieldErrors.title, "Title must be 256 characters or fewer");
  } finally {
    await app.close();
  }
});

test("a comment of a writer is appended to the discussion and persists", async () => {
  const app = await startApp();
  try {
    const commenter = await signIn(app.baseUrl, "issue-commenter");
    const before = await request(app.baseUrl, "GET", `${ISSUES}/3`);
    assert.equal(before.body.comments.length, 0);

    const added = await request(
      app.baseUrl,
      "POST",
      `${ISSUES}/3/comments`,
      { body: "Adding the onboarding checklist." },
      commenter,
    );
    assert.equal(added.status, 201);
    assert.equal(added.body.comments.length, 1);
    assert.equal(added.body.comments[0].author, "issue-commenter");
    assert.equal(added.body.comments[0].body, "Adding the onboarding checklist.");
    assert.deepEqual(
      added.body.events.map((event) => event.type),
      ["created", "commented"],
    );

    const restarted = await startDataDir(app.dataDir);
    try {
      const again = await request(restarted.baseUrl, "GET", `${ISSUES}/3`);
      assert.equal(again.body.comments.length, 1);
      assert.equal(again.body.comments[0].author, "issue-commenter");
      assert.equal(again.body.comments[0].body, "Adding the onboarding checklist.");
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("a whitespace-only comment is rejected and leaves the discussion unchanged", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "GET", `${ISSUES}/4`);
    assert.equal(before.body.comments.length, 0);

    const viewer = await signIn(app.baseUrl, "default-branch-viewer");
    const forbidden = await request(app.baseUrl, "POST", `${ISSUES}/4/comments`, { body: "hi" }, viewer);
    assert.equal(forbidden.status, 403);

    const commenter = await signIn(app.baseUrl, "issue-commenter");
    const rejected = await request(app.baseUrl, "POST", `${ISSUES}/4/comments`, { body: "   " }, commenter);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fieldErrors.body, "Comment is required");

    const after = await request(app.baseUrl, "GET", `${ISSUES}/4`);
    assert.equal(after.body.comments.length, 0);
    assert.deepEqual(
      after.body.events.map((event) => event.type),
      ["created"],
    );
  } finally {
    await app.close();
  }
});

// --- REQ-5-2-2: editing the title and the description ----------------------

test("a Maintain editor saves the title and the description separately and both persist", async () => {
  const app = await startApp();
  try {
    const editor = await signIn(app.baseUrl, "issue-editor");
    const seeded = await request(app.baseUrl, "GET", `${ISSUES}/5`, undefined, editor);
    assert.equal(seeded.status, 200);
    assert.equal(seeded.body.issue.title, "Editable onboarding issue");
    const originalDescription = seeded.body.issue.description;
    assert.equal(seeded.body.canWrite, true);
    assert.equal(seeded.body.canTriage, true);

    const renamed = await request(app.baseUrl, "PATCH", `${ISSUES}/5`, { title: "  Renamed onboarding issue  " }, editor);
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.issue.title, "Renamed onboarding issue");
    // Only the selected field changed.
    assert.equal(renamed.body.issue.description, originalDescription);

    const described = await request(
      app.baseUrl,
      "PATCH",
      `${ISSUES}/5`,
      { description: "The onboarding copy now mentions the checklist." },
      editor,
    );
    assert.equal(described.status, 200);
    assert.equal(described.body.issue.title, "Renamed onboarding issue");
    assert.equal(described.body.issue.description, "The onboarding copy now mentions the checklist.");

    const events = (await request(app.baseUrl, "GET", `${ISSUES}/5`)).body.events.map((event) => event.type);
    assert.deepEqual(events, ["created", "renamed", "description-edited"]);

    const restarted = await startDataDir(app.dataDir);
    try {
      const again = await request(restarted.baseUrl, "GET", `${ISSUES}/5`);
      assert.equal(again.body.issue.title, "Renamed onboarding issue");
      assert.equal(again.body.issue.description, "The onboarding copy now mentions the checklist.");
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

test("an empty title is rejected and the original title is kept", async () => {
  const app = await startApp();
  try {
    const editor = await signIn(app.baseUrl, "issue-editor");
    const before = await request(app.baseUrl, "GET", `${ISSUES}/6`);
    assert.equal(before.body.issue.title, "Original issue title");

    const rejected = await request(app.baseUrl, "PATCH", `${ISSUES}/6`, { title: "   " }, editor);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.fieldErrors.title, "Title is required");

    const after = await request(app.baseUrl, "GET", `${ISSUES}/6`);
    assert.equal(after.body.issue.title, "Original issue title");
    assert.deepEqual(
      after.body.events.map((event) => event.type),
      before.body.events.map((event) => event.type),
    );

    const tooLong = await request(app.baseUrl, "PATCH", `${ISSUES}/6`, { title: "x".repeat(257) }, editor);
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.fieldErrors.title, "Title must be 256 characters or fewer");
  } finally {
    await app.close();
  }
});

test("content editing needs the write rule and metadata needs the triage rule", async () => {
  const app = await startApp();
  try {
    // `issue-author` holds Write: content yes, metadata no.
    const author = await signIn(app.baseUrl, "issue-author");
    const edit = await request(app.baseUrl, "PATCH", `${ISSUES}/5`, { title: "Written by the author" }, author);
    assert.equal(edit.status, 200);
    const assign = await request(
      app.baseUrl,
      "POST",
      `${ISSUES}/5/assignees`,
      { username: "bob-reviewer" },
      author,
    );
    assert.equal(assign.status, 403);

    // A readable account without any grant can do neither.
    const viewer = await signIn(app.baseUrl, "default-branch-viewer");
    const deniedEdit = await request(app.baseUrl, "PATCH", `${ISSUES}/5`, { title: "Nope" }, viewer);
    assert.equal(deniedEdit.status, 403);
    const deniedAssign = await request(
      app.baseUrl,
      "POST",
      `${ISSUES}/5/assignees`,
      { username: "bob-reviewer" },
      viewer,
    );
    assert.equal(deniedAssign.status, 403);

    // An anonymous caller is refused as well.
    const anonymous = await request(app.baseUrl, "PATCH", `${ISSUES}/5`, { title: "Nope" });
    assert.equal(anonymous.status, 401);
  } finally {
    await app.close();
  }
});

// --- REQ-5-3: assignees, labels and milestones -----------------------------

test("assigning and unassigning one member keeps the account and its permission", async () => {
  const app = await startApp();
  try {
    const editor = await signIn(app.baseUrl, "issue-editor");
    const before = await request(app.baseUrl, "GET", `${ISSUES}/7`, undefined, editor);
    assert.deepEqual(before.body.issue.assignees, []);
    assert.ok(before.body.availableAssignees.includes("bob-reviewer"));
    assert.ok(!before.body.issue.assignees.includes("bob-reviewer"));

    const assigned = await request(
      app.baseUrl,
      "POST",
      `${ISSUES}/7/assignees`,
      { username: "bob-reviewer" },
      editor,
    );
    assert.equal(assigned.status, 200);
    assert.deepEqual(assigned.body.issue.assignees, ["bob-reviewer"]);

    const reloaded = await request(app.baseUrl, "GET", `${ISSUES}/7`);
    assert.deepEqual(reloaded.body.issue.assignees, ["bob-reviewer"]);

    // A name that is not an eligible member of this repository is refused.
    const invalid = await request(app.baseUrl, "POST", `${ISSUES}/7/assignees`, { username: "no-such-member" }, editor);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.assignee, "Assignee is invalid");

    const removed = await request(app.baseUrl, "DELETE", `${ISSUES}/7/assignees/bob-reviewer`, undefined, editor);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.issue.assignees, []);
    assert.equal((await request(app.baseUrl, "GET", `${ISSUES}/7`)).body.issue.assignees.length, 0);

    // The member account and its repository-independent access are untouched.
    const member = await signIn(app.baseUrl, "bob-reviewer");
    assert.ok(member.includes("shallow_session"));
  } finally {
    await app.close();
  }
});

test("applying an existing label and setting an existing milestone persist", async () => {
  const app = await startApp();
  try {
    const editor = await signIn(app.baseUrl, "issue-editor");
    const labels = await request(app.baseUrl, "GET", `${ISSUES}/8`, undefined, editor);
    assert.deepEqual(labels.body.issue.labels, []);
    assert.deepEqual(labels.body.availableLabels.map((label) => label.name), ["bug", "documentation"]);

    const applied = await request(app.baseUrl, "POST", `${ISSUES}/8/labels`, { name: "bug" }, editor);
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.body.issue.labels.map((label) => label.name), ["bug"]);

    const unknown = await request(app.baseUrl, "POST", `${ISSUES}/8/labels`, { name: "no-such-label" }, editor);
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.fieldErrors.label, "Label is invalid");
    assert.deepEqual(
      (await request(app.baseUrl, "GET", `${ISSUES}/8`)).body.issue.labels.map((label) => label.name),
      ["bug"],
    );

    const milestones = await request(app.baseUrl, "GET", `${ISSUES}/9`, undefined, editor);
    assert.equal(milestones.body.issue.milestone, null);
    assert.deepEqual(milestones.body.availableMilestones.map((entry) => entry.name), ["v1.0"]);

    const set = await request(app.baseUrl, "PUT", `${ISSUES}/9/milestone`, { name: "v1.0" }, editor);
    assert.equal(set.status, 200);
    assert.deepEqual(set.body.issue.milestone, { name: "v1.0" });

    const invalid = await request(app.baseUrl, "PUT", `${ISSUES}/9/milestone`, { name: "v2.0" }, editor);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.milestone, "Milestone is invalid");

    const restarted = await startDataDir(app.dataDir);
    try {
      const labelView = await request(restarted.baseUrl, "GET", `${ISSUES}/8`);
      assert.deepEqual(labelView.body.issue.labels.map((label) => label.name), ["bug"]);
      const milestoneView = await request(restarted.baseUrl, "GET", `${ISSUES}/9`);
      assert.deepEqual(milestoneView.body.issue.milestone, { name: "v1.0" });
    } finally {
      await restarted.close();
    }
  } finally {
    await app.close();
  }
});

// --- REQ-5-4: closing and reopening an issue -------------------------------

test("a Maintain editor closes and reopens the issue and both states persist", async () => {
  const app = await startApp();
  try {
    const editor = await signIn(app.baseUrl, "issue-editor");
    const seeded = await request(app.baseUrl, "GET", `${ISSUES}/10`, undefined, editor);
    assert.equal(seeded.status, 200);
    assert.equal(seeded.body.issue.title, "Closable onboarding issue");
    assert.equal(seeded.body.issue.status, "open");
    assert.equal(seeded.body.canTriage, true);

    const closed = await request(app.baseUrl, "PATCH", `${ISSUES}/10/status`, { status: "closed" }, editor);
    assert.equal(closed.status, 200);
    assert.equal(closed.body.issue.status, "closed");
    assert.equal(closed.body.issue.title, "Closable onboarding issue");
    assert.equal(closed.body.issue.description, "Tracks closing and reopening the onboarding issue.");
    assert.deepEqual(
      closed.body.events.map((event) => event.type),
      ["created", "closed"],
    );

    const restarted = await startDataDir(app.dataDir);
    try {
      const persisted = await request(restarted.baseUrl, "GET", `${ISSUES}/10`);
      assert.equal(persisted.body.issue.status, "closed");
    } finally {
      await restarted.close();
    }

    const reopened = await request(app.baseUrl, "PATCH", `${ISSUES}/10/status`, { status: "open" }, editor);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.issue.status, "open");
    assert.deepEqual(
      reopened.body.events.map((event) => event.type),
      ["created", "closed", "reopened"],
    );

    // Closing and reopening never touch the content, discussion or metadata.
    const view = await request(app.baseUrl, "GET", `${ISSUES}/10`, undefined, editor);
    assert.equal(view.body.issue.title, "Closable onboarding issue");
    assert.equal(view.body.issue.description, "Tracks closing and reopening the onboarding issue.");
    assert.deepEqual(view.body.issue.labels, []);
    assert.deepEqual(view.body.issue.assignees, []);
    assert.equal(view.body.issue.milestone, null);
    assert.equal(view.body.comments.length, 0);
  } finally {
    await app.close();
  }
});

test("the status transition needs the triage rule and a valid status", async () => {
  const app = await startApp();
  try {
    const editor = await signIn(app.baseUrl, "issue-editor");

    // An unknown status value writes nothing.
    const invalid = await request(app.baseUrl, "PATCH", `${ISSUES}/10/status`, { status: "maybe" }, editor);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.fieldErrors.status, "Status is invalid");
    assert.equal((await request(app.baseUrl, "GET", `${ISSUES}/10`)).body.issue.status, "open");

    const missing = await request(app.baseUrl, "PATCH", `${ISSUES}/99/status`, { status: "closed" }, editor);
    assert.equal(missing.status, 404);

    // Write may edit the content but not the status.
    const author = await signIn(app.baseUrl, "issue-author");
    const deniedWrite = await request(
      app.baseUrl,
      "PATCH",
      `${ISSUES}/10/status`,
      { status: "closed" },
      author,
    );
    assert.equal(deniedWrite.status, 403);
    assert.equal((await request(app.baseUrl, "GET", `${ISSUES}/10`)).body.issue.status, "open");

    // Read may view the issue but not transition it.
    const viewer = await signIn(app.baseUrl, "issue-viewer");
    const readable = await request(app.baseUrl, "GET", `${ISSUES}/11`, undefined, viewer);
    assert.equal(readable.status, 200);
    assert.equal(readable.body.issue.title, "Protected onboarding issue");
    assert.equal(readable.body.issue.status, "open");
    assert.equal(readable.body.canTriage, false);
    const deniedRead = await request(
      app.baseUrl,
      "PATCH",
      `${ISSUES}/11/status`,
      { status: "closed" },
      viewer,
    );
    assert.equal(deniedRead.status, 403);

    // An anonymous caller is refused as well.
    const anonymous = await request(app.baseUrl, "PATCH", `${ISSUES}/10/status`, { status: "closed" });
    assert.equal(anonymous.status, 401);
  } finally {
    await app.close();
  }
});
