import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAccountsDomain } from "../src/domain/accounts.mjs";
import { createIssuesDomain, TITLE_MAX, BODY_MAX } from "../src/domain/issues.mjs";
import { createOrganizationsDomain } from "../src/domain/organizations.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function createDomains() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-issues-"));
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
    issues: {},
    labels: {},
    milestones: {},
    timelines: {},
    comments: {},
    reactions: {},
  });
  const accounts = createAccountsDomain(store);
  const organizations = createOrganizationsDomain(store);
  const issues = createIssuesDomain(store);
  await accounts.seedIfEmpty();
  await organizations.seedIfEmpty();
  await issues.seedIfEmpty();
  return { directory, store, accounts, organizations, issues };
}

test("seed provisions issues, labels, milestones and comments for every acme-docs repository", async () => {
  const { store } = await createDomains();
  const state = await store.read();

  for (const repoId of ["acme-demo:acme-docs", "alice-dev:acme-docs"]) {
    const issuesByNumber = state.issues[repoId];
    assert.ok(issuesByNumber, `issues seeded for ${repoId}`);

    const open = issuesByNumber[1];
    assert.equal(open.title, "Improve onboarding");
    assert.equal(open.description, "Describe the onboarding improvement.");
    assert.equal(open.status, "open");
    // Exactly one label is applied to the seeded open issue (REQ-5-1-2); the
    // `bug` label stays unapplied so REQ-5-3-2 can apply and remove it.
    assert.deepEqual([...open.labels].sort(), ["documentation"]);
    assert.deepEqual(open.assignees, ["bob-reviewer"]);
    assert.equal(state.milestones[repoId][open.milestone].title, "Q3 launch");
    assert.deepEqual(Object.keys(state.labels[repoId]).sort(), ["bug", "documentation"]);
    // REQ-5-3-3: the current repository also contains a selectable v1.0 milestone.
    assert.deepEqual(
      Object.values(state.milestones[repoId])
        .map((milestone) => milestone.title)
        .sort(),
      ["Q3 launch", "v1.0"],
    );

    const closed = issuesByNumber[2];
    assert.equal(closed.title, "Legacy welcome text");
    assert.equal(closed.status, "closed");

    const invalidEdit = issuesByNumber[3];
    assert.equal(invalidEdit.title, "Original issue title");

    // REQ-5-1-1: an Open issue carries the `bug` label (with a word in its
    // title), while `Improve onboarding` keeps `bug` unapplied for REQ-5-3-2.
    const bugIssue = issuesByNumber[4];
    assert.equal(bugIssue.title, "Improve onboarding flow");
    assert.equal(bugIssue.status, "open");
    assert.deepEqual(bugIssue.labels, ["bug"]);

    const firstKey = `${repoId}:1`;
    const comments = Object.values(state.comments[firstKey]);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].author, "bob-reviewer");

    const timeline = state.timelines[firstKey];
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0].type, "created");
    assert.equal(timeline[1].type, "comment");
    assert.ok(timeline[0].createdAt <= timeline[1].createdAt);
  }

  // REQ-5-3-2/5-3-3: another repository holds an external `bug` label and a
  // v1.0 milestone that the acme-docs pickers must never offer.
  const external = state.labels["acme-demo:acme-private"];
  assert.ok(external);
  assert.equal(external.bug.name, "bug");
  assert.equal(external.bug.repoId, "acme-demo:acme-private");
  const externalMilestones = state.milestones["acme-demo:acme-private"];
  assert.ok(externalMilestones);
  assert.deepEqual(
    Object.values(externalMilestones).map((milestone) => milestone.repoId),
    ["acme-demo:acme-private"],
  );
});

test("listIssues returns rows to anonymous visitors on a public repository and denies private ones", async () => {
  const { issues } = await createDomains();

  const result = await issues.listIssues("alice-dev", "acme-docs", null);
  assert.equal(result.notFound, undefined);
  assert.equal(result.denied, undefined);
  assert.equal(result.myRole, null);
  assert.deepEqual(
    result.issues.map((issue) => issue.title),
    ["Improve onboarding flow", "Original issue title", "Legacy welcome text", "Improve onboarding"],
  );
  const open = result.issues.find((issue) => issue.number === 1);
  assert.equal(open.status, "open");
  assert.equal(open.author, "alice-dev");
  assert.deepEqual(open.labels, ["documentation"]);
  assert.ok(open.searchText.includes("Describe the onboarding improvement."));

  const denied = await issues.listIssues("alice-dev", "secret-research", null);
  assert.equal(denied.denied, true);

  const missing = await issues.listIssues("alice-dev", "no-such-repo", null);
  assert.equal(missing.notFound, true);
});

test("getIssue returns the complete detail for readers and hides content without access", async () => {
  const { issues } = await createDomains();

  const result = await issues.getIssue("alice-dev", "acme-docs", 1, "bob-reviewer");
  assert.equal(result.denied, undefined);
  assert.equal(result.issue.number, 1);
  assert.equal(result.issue.title, "Improve onboarding");
  assert.equal(result.issue.status, "open");
  assert.equal(result.issue.description, "Describe the onboarding improvement.");
  assert.deepEqual(result.issue.assignees, ["bob-reviewer"]);
  assert.deepEqual(
    result.issue.labels.map((label) => label.name).sort(),
    ["documentation"],
  );
  assert.equal(result.issue.milestone.title, "Q3 launch");
  // The detail context exposes the repository labels, milestones and
  // assignable members for the sidebar pickers.
  assert.deepEqual(
    result.labels.map((label) => label.name).sort(),
    ["bug", "documentation"],
  );
  assert.deepEqual(
    result.milestones.map((milestone) => milestone.title).sort(),
    ["Q3 launch", "v1.0"],
  );
  assert.deepEqual(result.assignableMembers, ["alice-dev", "bob-reviewer"]);
  assert.equal(result.issue.comments.length, 1);
  assert.equal(result.issue.comments[0].author, "bob-reviewer");
  assert.equal(result.issue.comments[0].reactions["👍"].count, 0);
  assert.deepEqual(
    result.issue.timeline.map((entry) => entry.type),
    ["created", "comment"],
  );

  const denied = await issues.getIssue("alice-dev", "secret-research", 1, null);
  assert.equal(denied.denied, true);

  const missing = await issues.getIssue("alice-dev", "acme-docs", 99, null);
  assert.equal(missing.notFound, true);
});

test("createIssue allocates an incrementing number and a creation activity", async () => {
  const { store, issues } = await createDomains();

  const result = await issues.createIssue("alice-dev", "alice-dev", "acme-docs", {
    title: "  Fix the search placeholder  ",
    description: "The placeholder is confusing.",
  });
  assert.equal(result.ok, true);
  assert.equal(result.issue.number, 5);
  assert.equal(result.issue.title, "Fix the search placeholder");
  assert.equal(result.issue.status, "open");
  assert.equal(result.issue.author, "alice-dev");

  const state = await store.read();
  const created = state.issues["alice-dev:acme-docs"][5];
  assert.equal(created.description, "The placeholder is confusing.");
  assert.equal(state.timelines["alice-dev:acme-docs:5"].length, 1);
  assert.equal(state.timelines["alice-dev:acme-docs:5"][0].type, "created");
  assert.equal(state.timelines["alice-dev:acme-docs:5"][0].author, "alice-dev");

  // The second repository keeps its own number sequence.
  const second = await issues.createIssue("alice-dev", "acme-demo", "acme-docs", {
    title: "Org issue",
  });
  assert.equal(second.issue.number, 5);

  const again = await issues.createIssue("alice-dev", "alice-dev", "acme-docs", {
    title: "One more",
  });
  assert.equal(again.issue.number, 6);
});

test("createIssue rejects blank and overlong input without allocating a number", async () => {
  const { store, issues } = await createDomains();

  const blank = await issues.createIssue("alice-dev", "alice-dev", "acme-docs", {
    title: "   ",
    description: "",
  });
  assert.equal(blank.ok, false);
  assert.deepEqual(blank.errors, { title: "Title is required" });

  const overlong = await issues.createIssue("alice-dev", "alice-dev", "acme-docs", {
    title: "x".repeat(TITLE_MAX + 1),
  });
  assert.equal(overlong.ok, false);
  assert.deepEqual(overlong.errors, { title: `Title must be at most ${TITLE_MAX} characters` });

  const longDescription = await issues.createIssue("alice-dev", "alice-dev", "acme-docs", {
    title: "Valid title",
    description: "x".repeat(BODY_MAX + 1),
  });
  assert.equal(longDescription.ok, false);
  assert.deepEqual(longDescription.errors, {
    description: `Description must be at most ${BODY_MAX} characters`,
  });

  const state = await store.read();
  assert.deepEqual(Object.keys(state.issues["alice-dev:acme-docs"]), ["1", "2", "3", "4"]);
});

test("createIssue requires Write, Maintain or Admin permission", async () => {
  const { issues } = await createDomains();

  const anonymous = await issues.createIssue(null, "alice-dev", "acme-docs", {
    title: "No session",
  });
  assert.equal(anonymous.forbidden, true);

  // carol-dev has no effective role on the public personal repository.
  const readOnly = await issues.createIssue("carol-dev", "alice-dev", "acme-docs", {
    title: "No write role",
  });
  assert.equal(readOnly.forbidden, true);
});

test("editIssueTitle and editIssueDescription update only the target fields and record activities", async () => {
  const { store, issues } = await createDomains();

  const titleResult = await issues.editIssueTitle(
    "alice-dev",
    "alice-dev",
    "acme-docs",
    1,
    { title: "Improved onboarding flow" },
  );
  assert.equal(titleResult.ok, true);
  assert.equal(titleResult.issue.title, "Improved onboarding flow");
  assert.equal(titleResult.issue.description, "Describe the onboarding improvement.");
  assert.equal(titleResult.issue.status, "open");

  const descriptionResult = await issues.editIssueDescription(
    "alice-dev",
    "alice-dev",
    "acme-docs",
    1,
    { description: "Rewrite the welcome screens." },
  );
  assert.equal(descriptionResult.ok, true);
  assert.equal(descriptionResult.issue.description, "Rewrite the welcome screens.");

  const state = await store.read();
  const timeline = state.timelines["alice-dev:acme-docs:1"];
  const titleEdit = timeline.find((entry) => entry.type === "title-edited");
  assert.equal(titleEdit.oldTitle, "Improve onboarding");
  assert.equal(titleEdit.newTitle, "Improved onboarding flow");
  assert.equal(titleEdit.author, "alice-dev");
  const descriptionEdit = timeline.find((entry) => entry.type === "description-edited");
  assert.equal(descriptionEdit.oldDescription, "Describe the onboarding improvement.");

  // Other issues and the issue's labels/assignees/milestone stay unchanged.
  const second = state.issues["alice-dev:acme-docs"][2];
  assert.equal(second.title, "Legacy welcome text");
  assert.equal(titleResult.issue.assignees.length, 1);
  assert.equal(titleResult.issue.milestone.title, "Q3 launch");

  // The list summary reflects the new title.
  const list = await issues.listIssues("alice-dev", "acme-docs", null);
  const summary = list.issues.find((issue) => issue.number === 1);
  assert.equal(summary.title, "Improved onboarding flow");
});

test("invalid title edits keep the original title", async () => {
  const { store, issues } = await createDomains();

  const blank = await issues.editIssueTitle("alice-dev", "alice-dev", "acme-docs", 3, {
    title: "   ",
  });
  assert.equal(blank.ok, false);
  assert.deepEqual(blank.errors, { title: "Title is required" });

  const overlong = await issues.editIssueTitle("alice-dev", "alice-dev", "acme-docs", 3, {
    title: "x".repeat(TITLE_MAX + 1),
  });
  assert.equal(overlong.ok, false);

  const state = await store.read();
  assert.equal(state.issues["alice-dev:acme-docs"][3].title, "Original issue title");

  const readOnly = await issues.editIssueTitle("carol-dev", "alice-dev", "acme-docs", 1, {
    title: "No permission",
  });
  assert.equal(readOnly.forbidden, true);
  assert.equal(state.issues["alice-dev:acme-docs"][1].title, "Improve onboarding");
});

test("addComment appends an independent record and timeline entry; blank input is rejected", async () => {
  const { store, issues } = await createDomains();

  const result = await issues.addComment("alice-dev", "alice-dev", "acme-docs", 1, {
    body: "  Let me prepare the copy.  ",
  });
  assert.equal(result.ok, true);
  assert.equal(result.comment.author, "alice-dev");
  assert.equal(result.comment.body, "Let me prepare the copy.");

  const state = await store.read();
  const key = "alice-dev:acme-docs:1";
  const comments = Object.values(state.comments[key]);
  assert.equal(comments.length, 2);
  const timeline = state.timelines[key];
  const entry = timeline.find((item) => item.type === "comment" && item.commentId === result.comment.id);
  assert.ok(entry);
  assert.equal(entry.author, "alice-dev");

  const blank = await issues.addComment("alice-dev", "alice-dev", "acme-docs", 1, {
    body: "   \n  ",
  });
  assert.equal(blank.ok, false);
  assert.deepEqual(blank.errors, { comment: "Comment is required" });

  const overlong = await issues.addComment("alice-dev", "alice-dev", "acme-docs", 1, {
    body: "x".repeat(BODY_MAX + 1),
  });
  assert.equal(overlong.ok, false);
  assert.deepEqual(Object.keys(overlong.errors), ["comment"]);

  const after = await store.read();
  assert.equal(Object.values(after.comments[key]).length, 2);
  assert.equal(after.timelines[key].length, timeline.length);

  const readOnly = await issues.addComment("carol-dev", "alice-dev", "acme-docs", 1, {
    body: "Not allowed",
  });
  assert.equal(readOnly.forbidden, true);
});

test("reactions toggle per user, target and reaction and persist", async () => {
  const { store, issues } = await createDomains();
  const key = "alice-dev:acme-docs:1";
  const comments = await issues.getIssue("alice-dev", "acme-docs", 1, "alice-dev");
  const commentId = comments.issue.comments[0].id;

  const added = await issues.toggleReaction("alice-dev", "alice-dev", "acme-docs", 1, {
    targetType: "comment",
    targetId: commentId,
    reaction: "👍",
  });
  assert.equal(added.ok, true);
  assert.equal(added.added, true);
  assert.equal(added.reactions["👍"].count, 1);
  assert.equal(added.reactions["👍"].reacted, true);

  // A second selection by the same user removes the reaction.
  const removed = await issues.toggleReaction("alice-dev", "alice-dev", "acme-docs", 1, {
    targetType: "comment",
    targetId: commentId,
    reaction: "👍",
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.added, false);
  assert.equal(removed.reactions["👍"].count, 0);
  assert.equal(removed.reactions["👍"].reacted, false);

  // A different user can add the same reaction on the same target.
  const secondUser = await issues.toggleReaction("bob-reviewer", "alice-dev", "acme-docs", 1, {
    targetType: "comment",
    targetId: commentId,
    reaction: "👍",
  });
  assert.equal(secondUser.ok, true);
  assert.equal(secondUser.reactions["👍"].count, 1);

  // Issue-level reactions work the same way.
  const issueReaction = await issues.toggleReaction("alice-dev", "alice-dev", "acme-docs", 1, {
    targetType: "issue",
    targetId: "issue",
    reaction: "🎉",
  });
  assert.equal(issueReaction.ok, true);
  assert.equal(issueReaction.reactions["🎉"].count, 1);

  const state = await store.read();
  assert.deepEqual(state.reactions[key]["comment:" + commentId]["👍"], ["bob-reviewer"]);
  assert.deepEqual(state.reactions[key]["issue:issue"]["🎉"], ["alice-dev"]);
  assert.equal(
    state.timelines[key].filter((entry) => entry.type === "reaction").length,
    4,
  );

  const invalid = await issues.toggleReaction("alice-dev", "alice-dev", "acme-docs", 1, {
    targetType: "comment",
    targetId: commentId,
    reaction: "?",
  });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors, { reaction: "Reaction is invalid" });

  const anonymous = await issues.toggleReaction(null, "alice-dev", "acme-docs", 1, {
    targetType: "issue",
    targetId: "issue",
    reaction: "👍",
  });
  assert.equal(anonymous.forbidden, true);
});

test("toggleAssignee adds and removes an assignable member and records activities", async () => {
  const { store, issues } = await createDomains();

  // alice-dev has Admin (org owner / personal owner) and is not yet assigned.
  const added = await issues.toggleAssignee("alice-dev", "alice-dev", "acme-docs", 1, {
    username: "alice-dev",
  });
  assert.equal(added.ok, true);
  assert.deepEqual(added.issue.assignees, ["bob-reviewer", "alice-dev"]);

  const state = await store.read();
  const timeline = state.timelines["alice-dev:acme-docs:1"];
  const assigned = timeline.find((entry) => entry.type === "assigned");
  assert.ok(assigned);
  assert.equal(assigned.author, "alice-dev");
  assert.equal(assigned.targetUsername, "alice-dev");

  // Selecting the same member again removes only the relationship.
  const removed = await issues.toggleAssignee("alice-dev", "alice-dev", "acme-docs", 1, {
    username: "alice-dev",
  });
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.issue.assignees, ["bob-reviewer"]);

  const after = await store.read();
  const unassigned = after.timelines["alice-dev:acme-docs:1"].find(
    (entry) => entry.type === "unassigned",
  );
  assert.ok(unassigned);
  assert.equal(unassigned.targetUsername, "alice-dev");
  // The account and its repository permission are untouched by unassignment.
  assert.equal(after.accounts["alice-dev"].username, "alice-dev");
  assert.equal(
    (await issues.getIssue("alice-dev", "acme-docs", 1, "alice-dev")).myRole,
    "admin",
  );

  // The final assignee set survives a fresh read (refresh).
  const read = await issues.getIssue("alice-dev", "acme-docs", 1, "alice-dev");
  assert.deepEqual(read.issue.assignees, ["bob-reviewer"]);
});

test("toggleAssignee rejects non-assignable accounts and users without Triage", async () => {
  const { store, issues } = await createDomains();

  // carol-dev is a registered account outside the repository collaborator scope.
  const outside = await issues.toggleAssignee("alice-dev", "alice-dev", "acme-docs", 1, {
    username: "carol-dev",
  });
  assert.equal(outside.ok, false);
  assert.deepEqual(outside.errors, {
    username: "Account is not assignable to this repository",
  });

  const unknown = await issues.toggleAssignee("alice-dev", "alice-dev", "acme-docs", 1, {
    username: "ghost-user",
  });
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.errors, { username: "Account not found" });

  // A Write/Read user cannot save assignee changes; the server rejects them.
  const writeUser = await issues.toggleAssignee("bob-reviewer", "alice-dev", "acme-docs", 1, {
    username: "alice-dev",
  });
  assert.equal(writeUser.forbidden, true);

  const state = await store.read();
  assert.deepEqual(state.issues["alice-dev:acme-docs"][1].assignees, ["bob-reviewer"]);
  assert.deepEqual(state.accounts["carol-dev"].username, "carol-dev");
});

test("toggleLabel applies and removes an existing repository label and records activities", async () => {
  const { store, issues } = await createDomains();

  // `bug` exists in the repository but is not applied to issue 1 yet.
  const added = await issues.toggleLabel("alice-dev", "alice-dev", "acme-docs", 1, {
    name: "bug",
  });
  assert.equal(added.ok, true);
  assert.deepEqual(
    added.issue.labels.map((label) => label.name).sort(),
    ["bug", "documentation"],
  );

  const state = await store.read();
  const labeled = state.timelines["alice-dev:acme-docs:1"].find(
    (entry) => entry.type === "labeled",
  );
  assert.ok(labeled);
  assert.equal(labeled.labelName, "bug");
  assert.equal(labeled.author, "alice-dev");

  // The issue list summary shows the applied label too.
  const list = await issues.listIssues("alice-dev", "acme-docs", null);
  const summary = list.issues.find((issue) => issue.number === 1);
  assert.ok(summary.labels.includes("bug"));

  const removed = await issues.toggleLabel("alice-dev", "alice-dev", "acme-docs", 1, {
    name: "bug",
  });
  assert.equal(removed.ok, true);
  assert.deepEqual(
    removed.issue.labels.map((label) => label.name).sort(),
    ["documentation"],
  );

  const after = await store.read();
  const unlabeled = after.timelines["alice-dev:acme-docs:1"].find(
    (entry) => entry.type === "unlabeled",
  );
  assert.ok(unlabeled);
  assert.equal(unlabeled.labelName, "bug");

  // Unknown label names are rejected and never created; cross-repository
  // labels are not offered.
  const unknown = await issues.toggleLabel("alice-dev", "alice-dev", "acme-docs", 1, {
    name: "not-a-label",
  });
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.errors, { name: "Label does not exist in this repository" });

  const readOnly = await issues.toggleLabel("bob-reviewer", "alice-dev", "acme-docs", 1, {
    name: "bug",
  });
  assert.equal(readOnly.forbidden, true);
  assert.deepEqual(after.issues["alice-dev:acme-docs"][1].labels, ["documentation"]);
});

test("setMilestone selects a repository milestone and None removes the association", async () => {
  const { store, issues } = await createDomains();

  const detail = await issues.getIssue("alice-dev", "acme-docs", 1, "alice-dev");
  const v10 = detail.milestones.find((milestone) => milestone.title === "v1.0");
  assert.ok(v10);

  const set = await issues.setMilestone("alice-dev", "alice-dev", "acme-docs", 1, {
    milestoneId: v10.id,
  });
  assert.equal(set.ok, true);
  assert.equal(set.issue.milestone.title, "v1.0");

  const state = await store.read();
  const changed = state.timelines["alice-dev:acme-docs:1"].find(
    (entry) => entry.type === "milestone-changed",
  );
  assert.ok(changed);
  assert.equal(changed.oldMilestone, "Q3 launch");
  assert.equal(changed.newMilestone, "v1.0");

  const none = await issues.setMilestone("alice-dev", "alice-dev", "acme-docs", 1, {
    milestoneId: null,
  });
  assert.equal(none.ok, true);
  assert.equal(none.issue.milestone, null);

  const after = await store.read();
  const removedEntry = after.timelines["alice-dev:acme-docs:1"].find(
    (entry) => entry.type === "milestone-changed" && entry.newMilestone === null,
  );
  assert.ok(removedEntry);
  assert.equal(removedEntry.oldMilestone, "v1.0");

  // Milestones from other repositories are rejected and never associated.
  const externalId = "acme-demo:acme-private:milestone:v1-0";
  const external = await issues.setMilestone("alice-dev", "alice-dev", "acme-docs", 1, {
    milestoneId: externalId,
  });
  assert.equal(external.ok, false);
  assert.deepEqual(external.errors, {
    milestone: "Milestone does not exist in this repository",
  });

  const readOnly = await issues.setMilestone("bob-reviewer", "alice-dev", "acme-docs", 1, {
    milestoneId: v10.id,
  });
  assert.equal(readOnly.forbidden, true);

  // A refreshed read keeps the last saved state (None).
  const fresh = await issues.getIssue("alice-dev", "acme-docs", 1, "alice-dev");
  assert.equal(fresh.issue.milestone, null);
});

test("setIssueStatus closes and reopens an issue without touching other fields", async () => {
  const { store, issues } = await createDomains();

  const closed = await issues.setIssueStatus("alice-dev", "alice-dev", "acme-docs", 1, {
    status: "closed",
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.issue.status, "closed");
  assert.equal(closed.issue.title, "Improve onboarding");
  assert.equal(closed.issue.description, "Describe the onboarding improvement.");
  assert.deepEqual(closed.issue.assignees, ["bob-reviewer"]);
  assert.deepEqual(
    closed.issue.labels.map((label) => label.name).sort(),
    ["documentation"],
  );
  assert.equal(closed.issue.milestone.title, "Q3 launch");
  assert.equal(closed.issue.comments.length, 1);

  const reopened = await issues.setIssueStatus("alice-dev", "alice-dev", "acme-docs", 1, {
    status: "open",
  });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.issue.status, "open");

  const state = await store.read();
  const timeline = state.timelines["alice-dev:acme-docs:1"];
  const closeEntry = timeline.find((entry) => entry.type === "closed");
  const reopenEntry = timeline.find((entry) => entry.type === "reopened");
  assert.ok(closeEntry);
  assert.ok(reopenEntry);
  assert.equal(closeEntry.author, "alice-dev");
  assert.equal(reopenEntry.author, "alice-dev");
  assert.ok(closeEntry.createdAt <= reopenEntry.createdAt);

  // The final Open state persists after refresh and in the list.
  const fresh = await issues.getIssue("alice-dev", "acme-docs", 1, "alice-dev");
  assert.equal(fresh.issue.status, "open");
  const list = await issues.listIssues("alice-dev", "acme-docs", null);
  assert.equal(list.issues.find((issue) => issue.number === 1).status, "open");

  const invalid = await issues.setIssueStatus("alice-dev", "alice-dev", "acme-docs", 1, {
    status: "merged",
  });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors, { status: "Status is invalid" });

  // Read/Write users cannot change the status.
  const readOnly = await issues.setIssueStatus("bob-reviewer", "alice-dev", "acme-docs", 1, {
    status: "closed",
  });
  assert.equal(readOnly.forbidden, true);
  const finalState = await store.read();
  assert.equal(finalState.issues["alice-dev:acme-docs"][1].status, "open");
});

test("issue metadata operations apply to the organization repository with org-owner Admin", async () => {
  const { issues } = await createDomains();

  // alice-dev is the organization owner (Admin) on acme-demo/acme-docs.
  const detail = await issues.getIssue("acme-demo", "acme-docs", 1, "alice-dev");
  assert.equal(detail.myRole, "admin");
  assert.ok(detail.assignableMembers.includes("alice-dev"));
  assert.ok(detail.assignableMembers.includes("bob-reviewer"));

  const assigned = await issues.toggleAssignee("alice-dev", "acme-demo", "acme-docs", 1, {
    username: "alice-dev",
  });
  assert.equal(assigned.ok, true);
  assert.ok(assigned.issue.assignees.includes("alice-dev"));

  const labeled = await issues.toggleLabel("alice-dev", "acme-demo", "acme-docs", 1, {
    name: "bug",
  });
  assert.equal(labeled.ok, true);
  assert.ok(labeled.issue.labels.some((label) => label.name === "bug"));
});
