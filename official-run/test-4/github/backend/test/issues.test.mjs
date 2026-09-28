import assert from "node:assert/strict";
import test from "node:test";

import { seedState } from "../src/domain/accounts.mjs";
import { seedOrganizations } from "../src/domain/organizations.mjs";
import { seedRepositories } from "../src/domain/repos.mjs";
import {
  addIssueComment,
  assignIssueParticipant,
  canChangeIssueState,
  canManageIssueMetadata,
  canWriteIssue,
  createIssue,
  findIssueByNumber,
  issueDetailPayload,
  listRepositoryIssues,
  seedIssues,
  setIssueMilestone,
  setIssueState,
  targetReactions,
  toggleIssueLabel,
  toggleIssueReaction,
  unassignIssueParticipant,
  updateIssueDescription,
  updateIssueTitle,
} from "../src/domain/issues.mjs";
import { normalizeRepositories } from "../src/domain/vcs.mjs";

function freshState() {
  const state = {
    accounts: [],
    sessions: [],
    recovery: [],
    organizations: [],
    organizationMembers: [],
    repositories: [],
    teams: [],
    teamMembers: [],
    repoGrants: [],
    labels: [],
    milestones: [],
    issues: [],
    issueComments: [],
    issueReactions: [],
    issueActivities: [],
  };
  seedState(state);
  seedOrganizations(state);
  seedRepositories(state);
  seedIssues(state);
  normalizeRepositories(state);
  return state;
}

function accountId(state, username) {
  return state.accounts.find((candidate) => candidate.username === username).id;
}

function personalRepo(state, name) {
  return state.repositories.find(
    (candidate) => candidate.ownerType === "account" && candidate.name === name,
  );
}

test("seed issues provisions acme-docs with labels, milestone, and known issues", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  assert.ok(repo, "personal acme-docs repository exists");

  const labels = state.labels.filter((label) => label.repositoryId === repo.id);
  assert.deepEqual(
    labels.map((label) => label.name).sort(),
    ["bug", "documentation"],
  );
  const milestone = state.milestones.find(
    (candidate) => candidate.repositoryId === repo.id && candidate.title === "Q3 launch",
  );
  assert.ok(milestone, "Q3 launch milestone exists");

  const issues = state.issues.filter((issue) => issue.repositoryId === repo.id);
  assert.equal(issues.length, 3);

  // The same read-only seed is also available on the organization acme-docs.
  const orgRepo = state.repositories.find(
    (candidate) => candidate.ownerType === "organization" && candidate.name === "acme-docs",
  );
  assert.ok(orgRepo, "organization acme-docs repository exists");
  assert.equal(state.issues.filter((issue) => issue.repositoryId === orgRepo.id).length, 3);

  const open = findIssueByNumber(state, repo.id, 1);
  assert.equal(open.title, "Improve onboarding");
  assert.equal(open.state, "open");
  assert.equal(open.description, "Describe the onboarding improvement.");
  assert.equal(open.assigneeAccountIds.length, 1);
  assert.equal(issueDetailPayload(state, open, accountId(state, "alice-dev")).issue.assignees.length, 1);

  const closed = findIssueByNumber(state, repo.id, 2);
  assert.equal(closed.title, "Legacy welcome text");
  assert.equal(closed.state, "closed");

  // REQ-5-2-2 invalid-edit seed and REQ-5-3 metadata target issue.
  const invalidEdit = findIssueByNumber(state, repo.id, 3);
  assert.equal(invalidEdit.title, "Original issue title");
  assert.equal(invalidEdit.state, "open");
  assert.deepEqual(invalidEdit.labelIds, []);
  assert.equal(invalidEdit.milestoneId, null);
  assert.deepEqual(invalidEdit.assigneeAccountIds, []);

  // Both acme-docs repositories also carry the selectable v1.0 milestone.
  assert.ok(
    state.milestones.some(
      (candidate) => candidate.repositoryId === repo.id && candidate.title === "v1.0",
    ),
  );
  assert.ok(
    state.milestones.some(
      (candidate) => candidate.repositoryId === orgRepo.id && candidate.title === "v1.0",
    ),
  );

  // bob-reviewer has a Triage grant on both acme-docs repositories and is
  // therefore an assignable member; the external acme-internal classifications
  // are seeded with a same-name label and distinct label/milestone names.
  const bob = accountId(state, "bob-reviewer");
  assert.ok(
    state.repoGrants.some(
      (grant) =>
        grant.repositoryId === repo.id && grant.subjectType === "account" && grant.subjectId === bob,
    ),
  );
  const internal = state.repositories.find(
    (candidate) => candidate.ownerType === "organization" && candidate.name === "acme-internal",
  );
  const internalLabels = state.labels.filter((label) => label.repositoryId === internal.id);
  assert.deepEqual(internalLabels.map((label) => label.name).sort(), ["bug", "priority-high"]);
  assert.ok(
    state.milestones.some(
      (candidate) => candidate.repositoryId === internal.id && candidate.title === "Backlog",
    ),
  );

  // The open issue carries bug + documentation; the closed issue carries bug.
  const openLabels = issueDetailPayload(state, open, null).issue.labels.map((label) => label.name);
  const closedLabels = issueDetailPayload(state, closed, null).issue.labels.map((label) => label.name);
  assert.deepEqual(openLabels.sort(), ["bug", "documentation"]);
  assert.deepEqual(closedLabels, ["bug"]);

  // The open issue has an assignee, the milestone, and one comment.
  const detail = issueDetailPayload(state, open, null);
  assert.equal(detail.issue.milestone.title, "Q3 launch");
  assert.equal(detail.comments.length, 1);
  assert.equal(detail.comments[0].author.username, "alice-dev");
  assert.ok(detail.comments[0].body.length > 0);
  assert.deepEqual(
    detail.activities.map((activity) => activity.type),
    ["created", "commented"],
  );
  // chronological order: creation before the comment
  assert.ok(detail.activities[0].createdAt <= detail.activities[1].createdAt);
  assert.equal(detail.activities[1].body, detail.comments[0].body);
});

test("listRepositoryIssues returns summaries with row fields", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const summaries = listRepositoryIssues(state, repo.id);
  assert.equal(summaries.length, 3);
  const open = summaries.find((summary) => summary.number === 1);
  assert.equal(open.title, "Improve onboarding");
  assert.equal(open.state, "open");
  assert.equal(open.author.username, "alice-dev");
  assert.deepEqual(open.labels.map((label) => label.name).sort(), ["bug", "documentation"]);
  assert.ok(open.updatedAt);
  assert.equal(open.commentsCount, 1);
});

test("createIssue assigns incrementing numbers and appends a creation activity", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const alice = accountId(state, "alice-dev");

  const outcome = createIssue(state, {
    repositoryId: repo.id,
    accountId: alice,
    title: "  A brand new task  ",
    description: "Details here",
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.issue.number, 4);
  assert.equal(outcome.issue.title, "A brand new task");
  assert.equal(outcome.issue.state, "open");
  assert.equal(outcome.issue.authorAccountId, alice);
  assert.equal(state.issueActivities.filter((activity) => activity.issueId === outcome.issue.id).length, 1);
  assert.equal(state.issueActivities.find((activity) => activity.issueId === outcome.issue.id).type, "created");
  assert.equal(listRepositoryIssues(state, repo.id).length, 4);

  const second = createIssue(state, {
    repositoryId: repo.id,
    accountId: alice,
    title: "Another one",
    description: "",
  });
  assert.equal(second.issue.number, 5);
});

test("createIssue rejects blank/overlong titles and overlong descriptions without allocating a number", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const alice = accountId(state, "alice-dev");
  const before = state.issues.length;

  const blank = createIssue(state, {
    repositoryId: repo.id,
    accountId: alice,
    title: "   ",
    description: "",
  });
  assert.equal(blank.ok, false);
  assert.equal(blank.errors.title, "Title is required");

  const overlong = createIssue(state, {
    repositoryId: repo.id,
    accountId: alice,
    title: "x".repeat(257),
    description: "",
  });
  assert.equal(overlong.ok, false);
  assert.ok(overlong.errors.title.includes("256"));

  const longDescription = createIssue(state, {
    repositoryId: repo.id,
    accountId: alice,
    title: "Valid title",
    description: "y".repeat(65537),
  });
  assert.equal(longDescription.ok, false);
  assert.ok(longDescription.errors.description.includes("65536"));

  assert.equal(state.issues.length, before);
  assert.equal(state.issueActivities.length, 10); // seed activities only (5 per acme-docs)
});

test("addIssueComment appends comment + timeline record and updates the issue time", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const open = findIssueByNumber(state, repo.id, 1);
  const alice = accountId(state, "alice-dev");
  const before = open.updatedAt;

  const outcome = addIssueComment(state, { issueId: open.id, accountId: alice, body: "  A follow-up note  " });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.comment.body, "A follow-up note");
  const detail = issueDetailPayload(state, open, null);
  assert.equal(detail.comments.length, 2);
  assert.equal(detail.activities.length, 3);
  assert.equal(detail.activities[2].type, "commented");
  assert.equal(detail.activities[2].body, "A follow-up note");
  assert.ok(open.updatedAt >= before);

  const blank = addIssueComment(state, { issueId: open.id, accountId: alice, body: " \n " });
  assert.equal(blank.ok, false);
  assert.equal(blank.errors.body, "Comment is required");
  const overlong = addIssueComment(state, { issueId: open.id, accountId: alice, body: "z".repeat(65537) });
  assert.equal(overlong.ok, false);
  assert.ok(overlong.errors.body.includes("65536"));
  assert.equal(issueDetailPayload(state, open, null).comments.length, 2);
});

test("reactions toggle per user/target/reaction and expose counts and viewer state", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const open = findIssueByNumber(state, repo.id, 1);
  const comment = state.issueComments.find((candidate) => candidate.issueId === open.id);
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");

  let outcome = toggleIssueReaction(state, {
    issueId: open.id,
    accountId: alice,
    targetType: "comment",
    targetId: comment.id,
    reaction: "👍",
  });
  assert.equal(outcome.ok, true);
  let reactions = targetReactions(state, open.id, "comment", comment.id, alice);
  assert.equal(reactions.find((entry) => entry.reaction === "👍").count, 1);
  assert.equal(reactions.find((entry) => entry.reaction === "👍").viewerReacted, true);

  // Bob reacts the same way; the count grows but Alice's state stays.
  toggleIssueReaction(state, {
    issueId: open.id,
    accountId: bob,
    targetType: "comment",
    targetId: comment.id,
    reaction: "👍",
  });
  reactions = targetReactions(state, open.id, "comment", comment.id, alice);
  assert.equal(reactions.find((entry) => entry.reaction === "👍").count, 2);

  // Selecting the same reaction again removes only the caller's own record.
  outcome = toggleIssueReaction(state, {
    issueId: open.id,
    accountId: alice,
    targetType: "comment",
    targetId: comment.id,
    reaction: "👍",
  });
  assert.equal(outcome.ok, true);
  reactions = targetReactions(state, open.id, "comment", comment.id, alice);
  assert.equal(reactions.find((entry) => entry.reaction === "👍").count, 1);
  assert.equal(reactions.find((entry) => entry.reaction === "👍").viewerReacted, false);

  // Issue-body reactions work too; invalid targets are rejected.
  const issueReaction = toggleIssueReaction(state, {
    issueId: open.id,
    accountId: alice,
    targetType: "issue",
    targetId: open.id,
    reaction: "❤️",
  });
  assert.equal(issueReaction.ok, true);
  assert.equal(targetReactions(state, open.id, "issue", open.id, alice).find((entry) => entry.reaction === "❤️").count, 1);
  const invalid = toggleIssueReaction(state, {
    issueId: open.id,
    accountId: alice,
    targetType: "comment",
    targetId: "missing",
    reaction: "👍",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.target, "Target not found");
});

test("canWriteIssue follows the explicit write/maintain/admin role list", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const orgRepo = state.repositories.find(
    (candidate) => candidate.ownerType === "organization" && candidate.name === "acme-docs",
  );
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");
  assert.equal(canWriteIssue(state, alice, repo), true); // owner acts as Admin
  assert.equal(canWriteIssue(state, bob, repo), true); // Write grant on the personal repo
  assert.equal(canWriteIssue(state, bob, orgRepo), false); // Triage grant on the org repo
  assert.equal(canWriteIssue(state, null, repo), false);
});

test("metadata permission follows the explicit triage/maintain/admin role list", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const orgRepo = state.repositories.find(
    (candidate) => candidate.ownerType === "organization" && candidate.name === "acme-docs",
  );
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");
  assert.equal(canManageIssueMetadata(state, alice, repo), true);
  // bob-reviewer has a Triage grant on the org acme-docs repository.
  assert.equal(canManageIssueMetadata(state, bob, orgRepo), true);
  // Write on the personal repo may edit but not manage metadata.
  assert.equal(canManageIssueMetadata(state, bob, repo), false);
  assert.equal(canManageIssueMetadata(state, null, repo), false);
  // A Write grant may edit but not manage metadata; a Read grant may not.
  const writeState = freshState();
  const writeRepo = personalRepo(writeState, "acme-docs");
  const writeAccount = writeState.accounts.find((candidate) => candidate.username === "bob-reviewer");
  writeState.repoGrants = writeState.repoGrants.filter(
    (grant) => !(grant.repositoryId === writeRepo.id && grant.subjectType === "account" && grant.subjectId === writeAccount.id),
  );
  writeState.repoGrants.push({
    repositoryId: writeRepo.id,
    subjectType: "account",
    subjectId: writeAccount.id,
    role: "write",
    grantorAccountId: accountId(writeState, "alice-dev"),
    createdAt: new Date().toISOString(),
  });
  assert.equal(canManageIssueMetadata(writeState, writeAccount.id, writeRepo), false);
  assert.equal(canWriteIssue(writeState, writeAccount.id, writeRepo), true);
  // Read grants may neither edit nor manage metadata.
  const readState = freshState();
  const readRepo = personalRepo(readState, "acme-docs");
  const readAccount = readState.accounts.find((candidate) => candidate.username === "bob-reviewer");
  readState.repoGrants = readState.repoGrants.filter(
    (grant) => !(grant.repositoryId === readRepo.id && grant.subjectType === "account" && grant.subjectId === readAccount.id),
  );
  readState.repoGrants.push({
    repositoryId: readRepo.id,
    subjectType: "account",
    subjectId: readAccount.id,
    role: "read",
    grantorAccountId: accountId(readState, "alice-dev"),
    createdAt: new Date().toISOString(),
  });
  assert.equal(canManageIssueMetadata(readState, readAccount.id, readRepo), false);
  assert.equal(canWriteIssue(readState, readAccount.id, readRepo), false);
});

test("assignable members are Triage-or-higher accounts of the issue's repository only", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const invalidEdit = findIssueByNumber(state, repo.id, 3);
  const members = issueDetailPayload(state, invalidEdit, accountId(state, "alice-dev")).assignableMembers;
  assert.deepEqual(members, ["alice-dev", "bob-reviewer"]);
  // carol-dev has no repository role and is never listed.
  assert.ok(state.accounts.some((account) => account.username === "carol-dev"));
  assert.ok(!members.includes("carol-dev"));
});

test("updateIssueTitle and updateIssueDescription edit only their own field and record activities", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const open = findIssueByNumber(state, repo.id, 1);
  const alice = accountId(state, "alice-dev");
  const originalDescription = open.description;
  const originalLabels = [...open.labelIds];
  const originalAssignee = [...open.assigneeAccountIds];
  const originalMilestone = open.milestoneId;

  const titleOutcome = updateIssueTitle(state, { issueId: open.id, accountId: alice, title: "  Improved onboarding  " });
  assert.equal(titleOutcome.ok, true);
  assert.equal(open.title, "Improved onboarding");
  assert.equal(open.description, originalDescription); // untouched
  const titleActivity = titleOutcome.activity;
  assert.equal(titleActivity.type, "edited");
  assert.equal(titleActivity.field, "title");
  assert.equal(titleActivity.value, "Improved onboarding");
  assert.equal(titleActivity.actorAccountId, alice);
  assert.ok(titleActivity.createdAt);

  const descriptionOutcome = updateIssueDescription(state, { issueId: open.id, accountId: alice, description: "A clearer plan." });
  assert.equal(descriptionOutcome.ok, true);
  assert.equal(open.description, "A clearer plan.");
  assert.equal(open.title, "Improved onboarding"); // untouched
  assert.equal(descriptionOutcome.activity.field, "description");
  assert.equal(descriptionOutcome.activity.value, "A clearer plan.");

  // Status, labels, assignees, milestone remain unchanged.
  assert.equal(open.state, "open");
  assert.deepEqual(open.labelIds, originalLabels);
  assert.deepEqual(open.assigneeAccountIds, originalAssignee);
  assert.equal(open.milestoneId, originalMilestone);

  // Blank and overlong titles are rejected and the original value is retained.
  const blank = updateIssueTitle(state, { issueId: open.id, accountId: alice, title: "   " });
  assert.equal(blank.ok, false);
  assert.equal(blank.errors.title, "Title is required");
  assert.equal(open.title, "Improved onboarding");
  const overlong = updateIssueTitle(state, { issueId: open.id, accountId: alice, title: "x".repeat(257) });
  assert.equal(overlong.ok, false);
  assert.ok(overlong.errors.title.includes("256"));
  assert.equal(open.title, "Improved onboarding");
  const longDescription = updateIssueDescription(state, { issueId: open.id, accountId: alice, description: "y".repeat(65537) });
  assert.equal(longDescription.ok, false);
  assert.ok(longDescription.errors.description.includes("65536"));
  assert.equal(open.description, "A clearer plan.");

  // The activities are displayed in the detail payload with the new value.
  const detail = issueDetailPayload(state, open, null);
  const editedActivities = detail.activities.filter((activity) => activity.type === "edited");
  assert.equal(editedActivities.length, 2);
  assert.equal(editedActivities[0].field, "title");
  assert.equal(editedActivities[0].value, "Improved onboarding");
});

test("issue participants can be assigned and unassigned with activities and without deleting the account", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const invalidEdit = findIssueByNumber(state, repo.id, 3);
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");

  const assigned = assignIssueParticipant(state, { issueId: invalidEdit.id, operatorAccountId: alice, username: "bob-reviewer" });
  assert.equal(assigned.ok, true);
  assert.deepEqual(invalidEdit.assigneeAccountIds, [bob]);
  assert.equal(assigned.activity.type, "assigned");
  assert.equal(assigned.activity.assignee, "bob-reviewer");

  // Reassigning is a no-op; the account still exists afterwards.
  assert.equal(assignIssueParticipant(state, { issueId: invalidEdit.id, operatorAccountId: alice, username: "bob-reviewer" }).activity, null);
  assert.equal(state.accounts.filter((account) => account.username === "bob-reviewer").length, 1);

  const unassigned = unassignIssueParticipant(state, { issueId: invalidEdit.id, operatorAccountId: alice, username: "bob-reviewer" });
  assert.equal(unassigned.ok, true);
  assert.deepEqual(invalidEdit.assigneeAccountIds, []);
  assert.equal(unassigned.activity.type, "unassigned");
  assert.equal(state.accounts.filter((account) => account.username === "bob-reviewer").length, 1);
  // The Write grant is untouched by unassignment.
  assert.equal(canWriteIssue(state, bob, repo), true);

  // A non-assignable account is rejected on assignment.
  const rejected = assignIssueParticipant(state, { issueId: invalidEdit.id, operatorAccountId: alice, username: "carol-dev" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors.username, "Account is not assignable");

  // Historical activities remain visible in the timeline.
  const detail = issueDetailPayload(state, invalidEdit, null);
  const types = detail.activities.map((activity) => activity.type);
  assert.deepEqual(types, ["created", "assigned", "unassigned"]);
  assert.equal(detail.activities[1].assignee, "bob-reviewer");
});

test("labels toggle within the current repository only and record applied/removed activities", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const invalidEdit = findIssueByNumber(state, repo.id, 3);
  const alice = accountId(state, "alice-dev");
  const bugLabel = state.labels.find(
    (candidate) => candidate.repositoryId === repo.id && candidate.name === "bug",
  );

  const applied = toggleIssueLabel(state, { issueId: invalidEdit.id, accountId: alice, name: "bug" });
  assert.equal(applied.ok, true);
  assert.deepEqual(invalidEdit.labelIds, [bugLabel.id]);
  assert.equal(applied.activity.type, "labeled");
  assert.equal(applied.activity.label, "bug");

  // The same selection removes the association again.
  const removed = toggleIssueLabel(state, { issueId: invalidEdit.id, accountId: alice, name: "bug" });
  assert.equal(removed.ok, true);
  assert.deepEqual(invalidEdit.labelIds, []);
  assert.equal(removed.activity.type, "unlabeled");

  // Labels of other repositories are not resolvable by the acme-docs issue.
  const external = toggleIssueLabel(state, { issueId: invalidEdit.id, accountId: alice, name: "priority-high" });
  assert.equal(external.ok, false);
  assert.equal(external.errors.label, "Label not found");
  assert.deepEqual(invalidEdit.labelIds, []);
  assert.ok(!state.labels.some((label) => label.repositoryId === repo.id && label.name === "priority-high"));
});

test("milestone selection is single-select within the current repository and None removes it", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const invalidEdit = findIssueByNumber(state, repo.id, 3);
  const alice = accountId(state, "alice-dev");

  const selected = setIssueMilestone(state, { issueId: invalidEdit.id, accountId: alice, milestoneTitle: "v1.0" });
  assert.equal(selected.ok, true);
  assert.equal(selected.activity.type, "milestoned");
  assert.equal(selected.activity.milestone, "v1.0");
  const milestone = state.milestones.find((candidate) => candidate.id === invalidEdit.milestoneId);
  assert.equal(milestone.repositoryId, repo.id);
  assert.equal(milestone.title, "v1.0");

  // Selecting another milestone replaces the association (single select).
  setIssueMilestone(state, { issueId: invalidEdit.id, accountId: alice, milestoneTitle: "Q3 launch" });
  const milestoneAfter = state.milestones.find((candidate) => candidate.id === invalidEdit.milestoneId);
  assert.equal(milestoneAfter.title, "Q3 launch");

  // None removes the association and records a demilestoned activity.
  const removed = setIssueMilestone(state, { issueId: invalidEdit.id, accountId: alice, milestoneTitle: null });
  assert.equal(removed.ok, true);
  assert.equal(invalidEdit.milestoneId, null);
  assert.equal(removed.activity.type, "demilestoned");
  assert.equal(removed.activity.milestone, "Q3 launch");

  // A milestone of another repository is not selectable.
  const external = setIssueMilestone(state, { issueId: invalidEdit.id, accountId: alice, milestoneTitle: "Backlog" });
  assert.equal(external.ok, false);
  assert.equal(external.errors.milestone, "Milestone not found");
  assert.equal(invalidEdit.milestoneId, null);
});

test("close/reopen permission follows the explicit triage/maintain/admin role list", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const orgRepo = state.repositories.find(
    (candidate) => candidate.ownerType === "organization" && candidate.name === "acme-docs",
  );
  const alice = accountId(state, "alice-dev");
  const bob = accountId(state, "bob-reviewer");
  assert.equal(canChangeIssueState(state, alice, repo), true); // owner acts as Admin
  assert.equal(canChangeIssueState(state, bob, orgRepo), true); // Triage grant
  assert.equal(canChangeIssueState(state, bob, repo), false); // Write grant on the personal repo
  assert.equal(canChangeIssueState(state, null, repo), false);

  // A Write grant may edit and comment but not close or reopen.
  const writeState = freshState();
  const writeRepo = personalRepo(writeState, "acme-docs");
  const writeAccount = writeState.accounts.find((candidate) => candidate.username === "bob-reviewer");
  writeState.repoGrants = writeState.repoGrants.filter(
    (grant) =>
      !(
        grant.repositoryId === writeRepo.id &&
        grant.subjectType === "account" &&
        grant.subjectId === writeAccount.id
      ),
  );
  writeState.repoGrants.push({
    repositoryId: writeRepo.id,
    subjectType: "account",
    subjectId: writeAccount.id,
    role: "write",
    grantorAccountId: accountId(writeState, "alice-dev"),
    createdAt: new Date().toISOString(),
  });
  assert.equal(canChangeIssueState(writeState, writeAccount.id, writeRepo), false);
  assert.equal(canWriteIssue(writeState, writeAccount.id, writeRepo), true);

  // Read grants may neither manage metadata nor change the state.
  const readState = freshState();
  const readRepo = personalRepo(readState, "acme-docs");
  const readAccount = readState.accounts.find((candidate) => candidate.username === "bob-reviewer");
  readState.repoGrants = readState.repoGrants.filter(
    (grant) =>
      !(
        grant.repositoryId === readRepo.id &&
        grant.subjectType === "account" &&
        grant.subjectId === readAccount.id
      ),
  );
  readState.repoGrants.push({
    repositoryId: readRepo.id,
    subjectType: "account",
    subjectId: readAccount.id,
    role: "read",
    grantorAccountId: accountId(readState, "alice-dev"),
    createdAt: new Date().toISOString(),
  });
  assert.equal(canChangeIssueState(readState, readAccount.id, readRepo), false);
  assert.equal(canManageIssueMetadata(readState, readAccount.id, readRepo), false);
});

test("setIssueState closes and reopens with operator, time, and activities without touching other fields", () => {
  const state = freshState();
  const repo = personalRepo(state, "acme-docs");
  const open = findIssueByNumber(state, repo.id, 1);
  const alice = accountId(state, "alice-dev");
  const before = {
    title: open.title,
    description: open.description,
    labelIds: [...open.labelIds],
    assigneeAccountIds: [...open.assigneeAccountIds],
    milestoneId: open.milestoneId,
    comments: state.issueComments.filter((comment) => comment.issueId === open.id).length,
  };

  const closed = setIssueState(state, { issueId: open.id, accountId: alice, state: "closed" });
  assert.equal(closed.ok, true);
  assert.equal(open.state, "closed");
  assert.ok(open.closedAt, "closing records the time");
  assert.equal(closed.activity.type, "closed");
  assert.equal(closed.activity.actorAccountId, alice);
  assert.ok(closed.activity.createdAt);

  // The transition does not modify title, description, comments, labels,
  // assignees, or milestone.
  assert.equal(open.title, before.title);
  assert.equal(open.description, before.description);
  assert.deepEqual(open.labelIds, before.labelIds);
  assert.deepEqual(open.assigneeAccountIds, before.assigneeAccountIds);
  assert.equal(open.milestoneId, before.milestoneId);
  assert.equal(
    state.issueComments.filter((comment) => comment.issueId === open.id).length,
    before.comments,
  );

  // Closing an already closed issue is a no-op that stores nothing new.
  const noop = setIssueState(state, { issueId: open.id, accountId: alice, state: "closed" });
  assert.equal(noop.ok, true);
  assert.equal(noop.activity, null);

  // Reopening restores Open and clears the close time.
  const reopened = setIssueState(state, { issueId: open.id, accountId: alice, state: "open" });
  assert.equal(reopened.ok, true);
  assert.equal(open.state, "open");
  assert.equal(open.closedAt, null);
  assert.equal(reopened.activity.type, "reopened");

  // The timeline appends close and reopen events in sequence and shows the operator.
  const detail = issueDetailPayload(state, open, null);
  assert.deepEqual(
    detail.activities.map((activity) => activity.type),
    ["created", "commented", "closed", "reopened"],
  );
  assert.equal(detail.activities[2].actor.username, "alice-dev");
  assert.equal(detail.activities[3].actor.username, "alice-dev");

  // Invalid states are rejected without changing anything.
  const invalid = setIssueState(state, { issueId: open.id, accountId: alice, state: "bogus" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.state, "State is invalid");
  assert.equal(open.state, "open");
  assert.equal(issueDetailPayload(state, open, null).activities.length, 4);
});
