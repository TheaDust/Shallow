// Issue domain: repository-scoped issues, labels, milestones, comments,
// reactions and the append-only activity timeline. Issue numbers are unique
// per repository and allocated atomically; every mutation records an entry in
// the issue's timeline before the store update completes.

import { randomUUID } from "node:crypto";

import { effectiveRole, repositoryAccessible } from "./organizations.mjs";

export const REACTION_TYPES = ["👍", "🎉", "❤️", "🚀", "👀"];

export const TITLE_MAX = 256;
export const BODY_MAX = 65536;

const CONTENT_ROLES = new Set(["write", "maintain", "admin"]);
const MANAGE_ROLES = new Set(["triage", "maintain", "admin"]);
const ROLE_RANK = { read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };

function normalizeTitle(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBody(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateTitle(title, errors, key = "title") {
  if (!title) errors[key] = "Title is required";
  else if (title.length > TITLE_MAX) {
    errors[key] = `Title must be at most ${TITLE_MAX} characters`;
  }
}

function validateDescription(description, errors) {
  if (description.length > BODY_MAX) {
    errors.description = `Description must be at most ${BODY_MAX} characters`;
  }
}

function validateComment(body, errors) {
  if (!body) errors.comment = "Comment is required";
  else if (body.length > BODY_MAX) {
    errors.comment = `Comment must be at most ${BODY_MAX} characters`;
  }
}

function canManageContent(state, repo, accountId) {
  if (!accountId) return false;
  const role = effectiveRole(state, repo, accountId);
  return role !== null && CONTENT_ROLES.has(role);
}

// Issue metadata and status operations (assignees, labels, milestones, close
// and reopen) require Triage, Maintain or Admin; the role lists are explicit
// per operation and are not an automatic cumulative grant.
function canManageIssue(state, repo, accountId) {
  if (!accountId) return false;
  const role = effectiveRole(state, repo, accountId);
  return role !== null && MANAGE_ROLES.has(role);
}

// Accounts with at least Triage permission on the repository: organization
// owners (Admin), direct member grants and team grants, plus personal
// repository owners and their direct grants. These are the only accounts the
// assignee selector may offer.
function assignableMembers(state, repo) {
  const members = [];
  for (const account of Object.values(state.accounts ?? {})) {
    const role = effectiveRole(state, repo, account.id);
    if (role && (ROLE_RANK[role] ?? 0) >= (ROLE_RANK.triage ?? 0)) {
      members.push(account.username);
    }
  }
  return members.sort((a, b) => a.localeCompare(b));
}

function issueKey(repoId, number) {
  return `${repoId}:${number}`;
}

function serializeLabel(label) {
  return { name: label.name, color: label.color };
}

function serializeIssueSummary(repo, issue) {
  return {
    number: issue.number,
    title: issue.title,
    status: issue.status,
    author: issue.author,
    labels: [...(issue.labels ?? [])],
    // Hidden search text: keyword filters match title or body without
    // changing any issue data; it is never rendered by the frontend.
    searchText: `${issue.title}\n${issue.description ?? ""}`,
    updatedAt: issue.updatedAt,
  };
}

function serializeReactions(state, key, targetType, targetId, accountId) {
  const bucket = state.reactions?.[key]?.[`${targetType}:${targetId}`] ?? {};
  const result = {};
  for (const reaction of REACTION_TYPES) {
    const users = bucket[reaction] ?? [];
    result[reaction] = {
      count: users.length,
      reacted: users.includes(accountId),
    };
  }
  return result;
}

function serializeTimelineEntry(entry) {
  const serialized = {
    id: entry.id,
    type: entry.type,
    author: entry.author,
    createdAt: entry.createdAt,
  };
  if (entry.commentId) serialized.commentId = entry.commentId;
  if (entry.oldTitle !== undefined) serialized.oldTitle = entry.oldTitle;
  if (entry.newTitle !== undefined) serialized.newTitle = entry.newTitle;
  if (entry.oldDescription !== undefined) serialized.oldDescription = entry.oldDescription;
  if (entry.newDescription !== undefined) serialized.newDescription = entry.newDescription;
  if (entry.reaction !== undefined) serialized.reaction = entry.reaction;
  if (entry.targetType !== undefined) serialized.targetType = entry.targetType;
  if (entry.targetId !== undefined) serialized.targetId = entry.targetId;
  if (entry.added !== undefined) serialized.added = entry.added;
  if (entry.targetUsername !== undefined) serialized.targetUsername = entry.targetUsername;
  if (entry.labelName !== undefined) serialized.labelName = entry.labelName;
  if (entry.oldMilestone !== undefined) serialized.oldMilestone = entry.oldMilestone;
  if (entry.newMilestone !== undefined) serialized.newMilestone = entry.newMilestone;
  return serialized;
}

function serializeComment(state, key, comment, accountId) {
  return {
    id: comment.id,
    author: comment.author,
    body: comment.body,
    createdAt: comment.createdAt,
    reactions: serializeReactions(state, key, "comment", comment.id, accountId),
  };
}

function serializeMilestone(milestone) {
  return milestone ? { id: milestone.id, title: milestone.title } : null;
}

// Repository-level metadata offered by the issue detail response: the label
// names and milestone titles of the current repository and the accounts that
// may be assigned to issues (effective role at least Triage).
function serializeIssueContext(state, repo) {
  return {
    labels: Object.values(state.labels?.[repo.id] ?? {})
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(serializeLabel),
    milestones: Object.values(state.milestones?.[repo.id] ?? {})
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(serializeMilestone),
    assignableMembers: assignableMembers(state, repo),
  };
}

function serializeIssue(state, repo, issue, accountId) {
  const key = issueKey(repo.id, issue.number);
  const comments = Object.values(state.comments?.[key] ?? {})
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((comment) => serializeComment(state, key, comment, accountId));
  const milestone = issue.milestone
    ? state.milestones?.[repo.id]?.[issue.milestone] ?? null
    : null;
  const timeline = [...(state.timelines?.[key] ?? [])]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(serializeTimelineEntry);
  return {
    number: issue.number,
    title: issue.title,
    description: issue.description ?? "",
    status: issue.status,
    author: issue.author,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    assignees: [...(issue.assignees ?? [])],
    labels: (issue.labels ?? []).map((name) => {
      const label = state.labels?.[repo.id]?.[name];
      return label ? serializeLabel(label) : { name, color: "#6e7781" };
    }),
    milestone: serializeMilestone(milestone),
    comments,
    reactions: serializeReactions(state, key, "issue", "issue", accountId),
    timeline,
  };
}

// Seed data for every repository named `acme-docs` (the REQ-3-3 context
// repository appears both as the organization repository and as alice-dev's
// personal repository; both are public and receive the same issue seeds).
function seedRepositoryIssues(state, repoId) {
  const now = Date.now();
  const daysAgo = (days) => new Date(now - days * 86400000).toISOString();
  const created = (days) => ({ createdAt: daysAgo(days) });

  state.labels[repoId] = {
    bug: {
      id: `${repoId}:label:bug`,
      repoId,
      name: "bug",
      color: "#d73a4a",
      ...created(10),
    },
    documentation: {
      id: `${repoId}:label:documentation`,
      repoId,
      name: "documentation",
      color: "#0075ca",
      ...created(10),
    },
  };

  const milestoneId = `${repoId}:milestone:q3-launch`;
  const versionMilestoneId = `${repoId}:milestone:v1-0`;
  state.milestones[repoId] = {
    [milestoneId]: {
      id: milestoneId,
      repoId,
      title: "Q3 launch",
      description: "",
      state: "open",
      ...created(10),
    },
    [versionMilestoneId]: {
      id: versionMilestoneId,
      repoId,
      title: "v1.0",
      description: "",
      state: "open",
      ...created(10),
    },
  };

  const issues = {
    1: {
      id: `${repoId}:1`,
      repoId,
      number: 1,
      title: "Improve onboarding",
      description: "Describe the onboarding improvement.",
      author: "alice-dev",
      status: "open",
      assignees: ["bob-reviewer"],
      // Exactly one label is applied to the seeded open issue (REQ-5-1-2);
      // `bug` stays unapplied so REQ-5-3-2 can apply and remove it. Both
      // labels exist in the repository.
      labels: ["documentation"],
      milestone: milestoneId,
      createdAt: daysAgo(7),
      updatedAt: daysAgo(2),
    },
    2: {
      id: `${repoId}:2`,
      repoId,
      number: 2,
      title: "Legacy welcome text",
      description:
        "The welcome text shown to new users is outdated and should be replaced. New onboarding guidance should become the default as part of the Improve onboarding work.",
      author: "alice-dev",
      status: "closed",
      assignees: [],
      labels: ["bug"],
      milestone: null,
      createdAt: daysAgo(5),
      updatedAt: daysAgo(1),
    },
    3: {
      id: `${repoId}:3`,
      repoId,
      number: 3,
      title: "Original issue title",
      description: "This issue keeps its original title when an invalid edit is rejected.",
      author: "alice-dev",
      status: "open",
      assignees: [],
      labels: [],
      milestone: null,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    },
    4: {
      id: `${repoId}:4`,
      repoId,
      number: 4,
      // REQ-5-1-1 needs an Open issue with the `bug` label and a word in its
      // title; REQ-5-3-2 needs `bug` not yet applied to `Improve onboarding`,
      // so the bug label lives on this separate open issue. Its title keeps
      // the contiguous phrase "Improve onboarding" so an Open+keyword+`bug`
      // filter row still contains that phrase plus the bug label.
      title: "Improve onboarding flow",
      description: "The onboarding flow should guide new users through the first steps.",
      author: "alice-dev",
      status: "open",
      assignees: [],
      labels: ["bug"],
      milestone: null,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
  };
  state.issues[repoId] = issues;

  const firstKey = issueKey(repoId, 1);
  const commentId = `${firstKey}:comment:c1`;
  state.comments[firstKey] = {
    [commentId]: {
      id: commentId,
      issueKey: firstKey,
      author: "bob-reviewer",
      body: "I can draft the new onboarding flow.",
      createdAt: daysAgo(2),
    },
  };
  state.timelines[firstKey] = [
    {
      id: `${firstKey}:tl:1`,
      type: "created",
      author: "alice-dev",
      createdAt: daysAgo(7),
    },
    {
      id: `${firstKey}:tl:2`,
      type: "comment",
      author: "bob-reviewer",
      commentId,
      createdAt: daysAgo(2),
    },
  ];

  const secondKey = issueKey(repoId, 2);
  state.timelines[secondKey] = [
    {
      id: `${secondKey}:tl:1`,
      type: "created",
      author: "alice-dev",
      createdAt: daysAgo(5),
    },
    {
      id: `${secondKey}:tl:2`,
      type: "closed",
      author: "alice-dev",
      createdAt: daysAgo(1),
    },
  ];

  const thirdKey = issueKey(repoId, 3);
  state.timelines[thirdKey] = [
    {
      id: `${thirdKey}:tl:1`,
      type: "created",
      author: "alice-dev",
      createdAt: daysAgo(3),
    },
  ];

  const fourthKey = issueKey(repoId, 4);
  state.timelines[fourthKey] = [
    {
      id: `${fourthKey}:tl:1`,
      type: "created",
      author: "alice-dev",
      createdAt: daysAgo(1),
    },
  ];
}

export function createIssuesDomain(store) {
  async function seedIfEmpty() {
    await store.update(async (state) => {
      if (state.issues && Object.keys(state.issues).length > 0) return;
      state.issues = state.issues ?? {};
      state.labels = state.labels ?? {};
      state.milestones = state.milestones ?? {};
      state.timelines = state.timelines ?? {};
      state.comments = state.comments ?? {};
      state.reactions = state.reactions ?? {};

      const repoIds = Object.keys(state.repositories ?? {}).filter(
        (id) => state.repositories[id].name === "acme-docs",
      );
      for (const repoId of repoIds) {
        seedRepositoryIssues(state, repoId);
      }

      // External classification seeds on another repository (REQ-5-3-2/5-3-3):
      // the acme-docs pickers must never offer or associate these records.
      const externalRepoId = "acme-demo:acme-private";
      if (state.repositories?.[externalRepoId]) {
        state.labels[externalRepoId] = {
          bug: {
            id: `${externalRepoId}:label:bug`,
            repoId: externalRepoId,
            name: "bug",
            color: "#d73a4a",
            createdAt: new Date().toISOString(),
          },
        };
        const externalMilestoneId = `${externalRepoId}:milestone:v1-0`;
        state.milestones[externalRepoId] = {
          [externalMilestoneId]: {
            id: externalMilestoneId,
            repoId: externalRepoId,
            title: "v1.0",
            description: "",
            state: "open",
            createdAt: new Date().toISOString(),
          },
        };
      }
    });
  }

  async function listIssues(owner, name, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const issues = Object.values(state.issues?.[repo.id] ?? {})
      .map((issue) => serializeIssueSummary(repo, issue))
      .sort((a, b) => b.number - a.number);
    const labels = Object.values(state.labels?.[repo.id] ?? {})
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(serializeLabel);
    return {
      repository: { owner: repo.ownerId, name: repo.name },
      myRole: effectiveRole(state, repo, accountId),
      labels,
      issues,
    };
  }

  async function getIssue(owner, name, number, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const issue = state.issues?.[repo.id]?.[number];
    if (!issue) return { notFound: true };
    return {
      issue: serializeIssue(state, repo, issue, accountId),
      myRole: effectiveRole(state, repo, accountId),
      ...serializeIssueContext(state, repo),
    };
  }

  // Create a repository-scoped issue. The number is allocated only inside the
  // atomic update after validation and permission checks pass, so a failure
  // never allocates a number or persists partial data.
  async function createIssue(accountId, owner, name, input = {}) {
    const title = normalizeTitle(input.title);
    const description = normalizeBody(input.description ?? "");
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageContent(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const errors = {};
      validateTitle(title, errors);
      validateDescription(description, errors);
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const repoIssues = state.issues?.[repo.id] ?? {};
      const number =
        Object.keys(repoIssues).reduce((max, key) => Math.max(max, Number(key)), 0) + 1;
      const now = new Date().toISOString();
      const issue = {
        id: `${repo.id}:${number}`,
        repoId: repo.id,
        number,
        title,
        description,
        author: accountId,
        status: "open",
        assignees: [],
        labels: [],
        milestone: null,
        createdAt: now,
        updatedAt: now,
      };
      state.issues = state.issues ?? {};
      state.issues[repo.id] = state.issues[repo.id] ?? {};
      state.issues[repo.id][number] = issue;
      state.timelines = state.timelines ?? {};
      const key = issueKey(repo.id, number);
      state.timelines[key] = [
        {
          id: `${key}:tl:1`,
          type: "created",
          author: accountId,
          createdAt: now,
        },
      ];
      result = { ok: true, issue: serializeIssueSummary(repo, issue) };
    });
    return result;
  }

  async function editIssueTitle(accountId, owner, name, number, input = {}) {
    const title = normalizeTitle(input.title);
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageContent(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const issue = state.issues?.[repo.id]?.[number];
      if (!issue) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      validateTitle(title, errors);
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      const oldTitle = issue.title;
      issue.title = title;
      issue.updatedAt = now;
      const key = issueKey(repo.id, number);
      state.timelines = state.timelines ?? {};
      state.timelines[key] = state.timelines[key] ?? [];
      state.timelines[key].push({
        id: `${key}:tl:${randomUUID()}`,
        type: "title-edited",
        author: accountId,
        createdAt: now,
        oldTitle,
        newTitle: title,
      });
      result = { ok: true, issue: serializeIssue(state, repo, issue, accountId) };
    });
    return result;
  }

  async function editIssueDescription(accountId, owner, name, number, input = {}) {
    const description = normalizeBody(input.description ?? "");
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageContent(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const issue = state.issues?.[repo.id]?.[number];
      if (!issue) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      validateDescription(description, errors);
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      const oldDescription = issue.description ?? "";
      issue.description = description;
      issue.updatedAt = now;
      const key = issueKey(repo.id, number);
      state.timelines = state.timelines ?? {};
      state.timelines[key] = state.timelines[key] ?? [];
      state.timelines[key].push({
        id: `${key}:tl:${randomUUID()}`,
        type: "description-edited",
        author: accountId,
        createdAt: now,
        oldDescription,
        newDescription: description,
      });
      result = { ok: true, issue: serializeIssue(state, repo, issue, accountId) };
    });
    return result;
  }

  // Append a discussion comment as an independent record plus a timeline
  // entry. A blank, overlong or unauthorized comment changes nothing.
  async function addComment(accountId, owner, name, number, input = {}) {
    const body = normalizeBody(input.body ?? "");
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageContent(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const issue = state.issues?.[repo.id]?.[number];
      if (!issue) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      validateComment(body, errors);
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      const key = issueKey(repo.id, number);
      const commentId = `${key}:comment:${randomUUID()}`;
      state.comments = state.comments ?? {};
      state.comments[key] = state.comments[key] ?? {};
      state.comments[key][commentId] = {
        id: commentId,
        issueKey: key,
        author: accountId,
        body,
        createdAt: now,
      };
      state.timelines = state.timelines ?? {};
      state.timelines[key] = state.timelines[key] ?? [];
      state.timelines[key].push({
        id: `${key}:tl:${randomUUID()}`,
        type: "comment",
        author: accountId,
        commentId,
        createdAt: now,
      });
      issue.updatedAt = now;
      result = {
        ok: true,
        comment: serializeComment(state, key, state.comments[key][commentId], accountId),
      };
    });
    return result;
  }

  // Toggle one reaction of the current user on an issue or a comment. For the
  // same user, target and reaction only one association exists; selecting the
  // same reaction a second time removes it.
  async function toggleReaction(accountId, owner, name, number, input = {}) {
    const targetType = input.targetType === "comment" ? "comment" : "issue";
    const targetId =
      targetType === "comment" ? String(input.targetId ?? "") : "issue";
    const reaction = input.reaction;
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!accountId || !repositoryAccessible(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const issue = state.issues?.[repo.id]?.[number];
      if (!issue) {
        result = { ok: false, notFound: true };
        return;
      }
      const key = issueKey(repo.id, number);
      if (targetType === "comment" && !state.comments?.[key]?.[targetId]) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      if (!REACTION_TYPES.includes(reaction)) errors.reaction = "Reaction is invalid";
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      state.reactions = state.reactions ?? {};
      state.reactions[key] = state.reactions[key] ?? {};
      const bucketKey = `${targetType}:${targetId}`;
      state.reactions[key][bucketKey] = state.reactions[key][bucketKey] ?? {};
      const users = state.reactions[key][bucketKey][reaction] ?? [];
      const index = users.indexOf(accountId);
      let added;
      if (index >= 0) {
        users.splice(index, 1);
        added = false;
      } else {
        users.push(accountId);
        added = true;
      }
      state.reactions[key][bucketKey][reaction] = users;
      state.timelines = state.timelines ?? {};
      state.timelines[key] = state.timelines[key] ?? [];
      state.timelines[key].push({
        id: `${key}:tl:${randomUUID()}`,
        type: "reaction",
        author: accountId,
        createdAt: now,
        reaction,
        targetType,
        targetId,
        added,
      });
      result = {
        ok: true,
        reactions: serializeReactions(state, key, targetType, targetId, accountId),
        added,
        reaction,
      };
    });
    return result;
  }

  // Toggle the assignment of one assignable member (effective role at least
  // Triage) to an issue. Selecting an already-selected member removes the
  // relationship; the account and its repository grant are never touched.
  async function toggleAssignee(accountId, owner, name, number, input = {}) {
    const username = typeof input.username === "string" ? input.username.trim() : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageIssue(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const issue = state.issues?.[repo.id]?.[number];
      if (!issue) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      const target = state.accounts?.[username];
      if (!target) {
        errors.username = "Account not found";
      } else {
        const role = effectiveRole(state, repo, username);
        if (!role || (ROLE_RANK[role] ?? 0) < (ROLE_RANK.triage ?? 0)) {
          errors.username = "Account is not assignable to this repository";
        }
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      const assignees = [...(issue.assignees ?? [])];
      const index = assignees.indexOf(username);
      let added;
      if (index >= 0) {
        assignees.splice(index, 1);
        added = false;
      } else {
        assignees.push(username);
        added = true;
      }
      issue.assignees = assignees;
      issue.updatedAt = now;
      const key = issueKey(repo.id, number);
      state.timelines = state.timelines ?? {};
      state.timelines[key] = state.timelines[key] ?? [];
      state.timelines[key].push({
        id: `${key}:tl:${randomUUID()}`,
        type: added ? "assigned" : "unassigned",
        author: accountId,
        createdAt: now,
        targetUsername: username,
      });
      result = { ok: true, issue: serializeIssue(state, repo, issue, accountId) };
    });
    return result;
  }

  // Toggle an existing repository label on an issue. The label must already
  // exist in the current repository; unknown or cross-repository names are
  // rejected and never created.
  async function toggleLabel(accountId, owner, name, number, input = {}) {
    const labelName = typeof input.name === "string" ? input.name.trim() : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageIssue(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const issue = state.issues?.[repo.id]?.[number];
      if (!issue) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      const label = state.labels?.[repo.id]?.[labelName];
      if (!label) errors.name = "Label does not exist in this repository";
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      const labels = [...(issue.labels ?? [])];
      const index = labels.indexOf(labelName);
      let added;
      if (index >= 0) {
        labels.splice(index, 1);
        added = false;
      } else {
        labels.push(labelName);
        added = true;
      }
      issue.labels = labels;
      issue.updatedAt = now;
      const key = issueKey(repo.id, number);
      state.timelines = state.timelines ?? {};
      state.timelines[key] = state.timelines[key] ?? [];
      state.timelines[key].push({
        id: `${key}:tl:${randomUUID()}`,
        type: added ? "labeled" : "unlabeled",
        author: accountId,
        createdAt: now,
        labelName,
      });
      result = { ok: true, issue: serializeIssue(state, repo, issue, accountId) };
    });
    return result;
  }

  // Set the single milestone of an issue from the current repository's
  // milestone list; a null/empty value removes the association ("None").
  async function setMilestone(accountId, owner, name, number, input = {}) {
    const milestoneId = input.milestoneId === null || input.milestoneId === undefined || input.milestoneId === ""
      ? null
      : String(input.milestoneId);
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageIssue(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const issue = state.issues?.[repo.id]?.[number];
      if (!issue) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      const target = milestoneId ? state.milestones?.[repo.id]?.[milestoneId] : null;
      if (milestoneId && !target) {
        errors.milestone = "Milestone does not exist in this repository";
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      const oldMilestone = issue.milestone ? state.milestones?.[repo.id]?.[issue.milestone]?.title ?? null : null;
      const newMilestone = target ? target.title : null;
      if (issue.milestone !== milestoneId) {
        issue.milestone = milestoneId;
        issue.updatedAt = now;
        const key = issueKey(repo.id, number);
        state.timelines = state.timelines ?? {};
        state.timelines[key] = state.timelines[key] ?? [];
        state.timelines[key].push({
          id: `${key}:tl:${randomUUID()}`,
          type: "milestone-changed",
          author: accountId,
          createdAt: now,
          oldMilestone,
          newMilestone,
        });
      }
      result = { ok: true, issue: serializeIssue(state, repo, issue, accountId) };
    });
    return result;
  }

  // Close or reopen an issue. Only the status and its activity change; the
  // title, description, comments, labels, assignees and milestone stay intact.
  async function setIssueStatus(accountId, owner, name, number, input = {}) {
    const status = input.status === "closed" ? "closed" : input.status === "open" ? "open" : null;
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageIssue(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const issue = state.issues?.[repo.id]?.[number];
      if (!issue) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      if (status === null) errors.status = "Status is invalid";
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      if (issue.status !== status) {
        const now = new Date().toISOString();
        issue.status = status;
        issue.updatedAt = now;
        const key = issueKey(repo.id, number);
        state.timelines = state.timelines ?? {};
        state.timelines[key] = state.timelines[key] ?? [];
        state.timelines[key].push({
          id: `${key}:tl:${randomUUID()}`,
          type: status === "closed" ? "closed" : "reopened",
          author: accountId,
          createdAt: now,
        });
      }
      result = { ok: true, issue: serializeIssue(state, repo, issue, accountId) };
    });
    return result;
  }

  return {
    seedIfEmpty,
    listIssues,
    getIssue,
    createIssue,
    editIssueTitle,
    editIssueDescription,
    addComment,
    toggleReaction,
    toggleAssignee,
    toggleLabel,
    setMilestone,
    setIssueStatus,
  };
}
