// The Issues routes of the same-origin API stand-in used by component tests:
// the list of a repository, the detail of one repository-scoped issue number
// and the collaboration writes on it (create, edit, comment and react). The
// answers mirror the server's payloads without importing production code.

import type { StubComment, StubIssue, StubRepositoryView } from "./repository-stub";

export interface StubIssueRouteInput {
  owner: string;
  /** The extra path segment after `issues`, or null for the list route. */
  number: string | null;
  view: StubRepositoryView;
  /** The viewer's effective repository role, or null for a visitor. */
  viewerRole?: string | null;
  /** The signed-in username, or null for a visitor. */
  username?: string | null;
  /** The accounts with at least Triage permission on the repository. */
  assignableMembers?: readonly string[];
}

export interface StubIssueRouteResult {
  status: number;
  body: unknown;
}

const WRITE_ROLES = new Set(["write", "maintain", "admin"]);
const TRIAGE_ROLES = new Set(["triage", "maintain", "admin"]);

export function stubCanTriage(viewerRole?: string | null): boolean {
  return viewerRole != null && TRIAGE_ROLES.has(viewerRole);
}

export const STUB_REACTION_TYPES = [
  "thumbs_up",
  "heart",
  "hooray",
  "laugh",
  "confused",
  "rocket",
  "eyes",
];

export const STUB_ISSUE_MESSAGES = {
  titleRequired: "Title is required",
  titleTooLong: "Title must be 256 characters or fewer",
  descriptionTooLong: "Description must be 65536 characters or fewer",
  commentRequired: "Comment is required",
  commentTooLong: "Comment must be 65536 characters or fewer",
  reactionUnsupported: "Reaction is not supported",
  issueNotCreated: "Issue not created",
  issueNotSaved: "Issue not saved",
  commentNotAdded: "Comment not added",
  reactionNotSaved: "Reaction not saved",
  metadataNotSaved: "Issue metadata not saved",
  stateNotSaved: "Issue state not saved",
  memberNotAssignable: "Member is not assignable",
  labelUnsupported: "Label is not supported",
  milestoneUnsupported: "Milestone is not supported",
  stateUnsupported: "State is not supported",
};

export const STUB_TITLE_MAX_LENGTH = 256;
export const STUB_DESCRIPTION_MAX_LENGTH = 65536;
export const STUB_COMMENT_MAX_LENGTH = 65536;

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function labelPayload(view: StubRepositoryView, name: string) {
  const label = view.labels.find((candidate) => candidate.name === name);
  return {
    name,
    color: label?.color ?? null,
    description: label?.description ?? null,
  };
}

function milestonePayload(view: StubRepositoryView, title: string) {
  const milestone = view.milestones.find((candidate) => candidate.title === title);
  return { title, state: milestone?.state ?? "open" };
}

/** The stable identifier of one fixture comment. */
function commentIdOf(issue: StubIssue, index: number): string {
  return issue.comments?.[index]?.id ?? `issue-comment-${issue.number}-${index + 1}`;
}

function reactionSummaries(
  reactions: Array<{ reaction: string; username: string }> | undefined,
  username: string | null,
) {
  const stored = reactions ?? [];
  return STUB_REACTION_TYPES.filter((type) =>
    stored.some((reaction) => reaction.reaction === type),
  ).map((type) => ({
    reaction: type,
    count: stored.filter((reaction) => reaction.reaction === type).length,
    reacted: username !== null && stored.some((r) => r.reaction === type && r.username === username),
  }));
}

function commentPayload(issue: StubIssue, comment: StubComment, index: number, username: string | null) {
  return {
    id: commentIdOf(issue, index),
    author: comment.author,
    body: comment.body,
    createdAt: comment.createdAt,
    reactions: reactionSummaries(comment.reactions, username),
  };
}

/**
 * The stored activity records of one issue. A fixture without explicit events
 * keeps its history as creation plus the comments, exactly like a never-edited
 * stored issue; the first write materializes that history before appending.
 */
function storedEventsOf(issue: StubIssue) {
  if (issue.events && issue.events.length > 0) {
    return issue.events.map((event, index) => ({
      id: event.id ?? `issue-event-${issue.number}-${index + 1}`,
      type: event.type,
      actor: event.actor,
      createdAt: event.createdAt,
      data: event.data ?? {},
    }));
  }
  return [
    {
      id: `issue-event-${issue.number}-created`,
      type: "created",
      actor: issue.author,
      createdAt: issue.createdAt,
      data: {},
    },
    ...(issue.comments ?? []).map((comment, index) => ({
      id: `issue-event-${issue.number}-comment-${index + 1}`,
      type: "commented",
      actor: comment.author,
      createdAt: comment.createdAt,
      data: {},
    })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function eventsOf(issue: StubIssue) {
  return storedEventsOf(issue);
}

function rowOf(view: StubRepositoryView, issue: StubIssue) {
  return {
    id: `issue-${view.name}-${issue.number}`,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    state: issue.state,
    author: issue.author,
    labels: (issue.labels ?? []).map((name) => labelPayload(view, name)),
    milestone: issue.milestone ? milestonePayload(view, issue.milestone) : null,
    commentCount: (issue.comments ?? []).length,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt ?? issue.createdAt,
  };
}

function identityOf(owner: string, view: StubRepositoryView, viewerRole: string | null) {
  return {
    owner,
    name: view.name,
    description: view.description,
    visibility: view.visibility,
    defaultBranch: view.defaultBranch,
    viewerRole,
    source: view.source ?? null,
  };
}

/** The complete detail payload of one issue, as the server answers it. */
function detailOf(
  owner: string,
  view: StubRepositoryView,
  issue: StubIssue,
  viewerRole: string | null,
  username: string | null,
  assignableMembers: readonly string[] = [],
) {
  return {
    repository: identityOf(owner, view, viewerRole),
    issue: {
      id: `issue-${view.name}-${issue.number}`,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      state: issue.state,
      author: issue.author,
      assignees: [...(issue.assignees ?? [])],
      labels: (issue.labels ?? []).map((name) => labelPayload(view, name)),
      milestone: issue.milestone ? milestonePayload(view, issue.milestone) : null,
      reactions: reactionSummaries(issue.reactions, username),
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt ?? issue.createdAt,
      closedAt: issue.closedAt ?? null,
      closedBy: issue.closedBy ?? null,
    },
    comments: (issue.comments ?? []).map((comment, index) =>
      commentPayload(issue, comment, index, username),
    ),
    events: eventsOf(issue),
    viewerRole,
    canWrite: viewerRole !== null && WRITE_ROLES.has(viewerRole),
    canTriage: viewerRole !== null && TRIAGE_ROLES.has(viewerRole),
    labels: view.labels.map((label) => ({
      name: label.name,
      color: label.color ?? null,
      description: label.description ?? null,
    })),
    milestones: view.milestones.map((milestone) => ({
      title: milestone.title,
      state: milestone.state ?? "open",
    })),
    assigneeCandidates: viewerRole !== null && TRIAGE_ROLES.has(viewerRole)
      ? [...assignableMembers].sort((left, right) => left.localeCompare(right))
      : [],
  };
}

function findIssue(view: StubRepositoryView, number: string | null): StubIssue | undefined {
  if (number === null) return undefined;
  const requested = Number.parseInt(number.trim().replace(/^#/, ""), 10);
  if (!Number.isInteger(requested)) return undefined;
  return view.issues.find((candidate) => candidate.number === requested);
}

/**
 * Answers one Issues route. The caller has already resolved the repository and
 * the viewer's read permission.
 */
export function handleRepositoryIssueStub(input: StubIssueRouteInput): StubIssueRouteResult {
  const { owner, number, view } = input;
  const viewerRole = input.viewerRole ?? null;
  const username = input.username ?? null;
  const repository = identityOf(owner, view, viewerRole);
  const issues = [...view.issues].sort((left, right) => right.number - left.number);

  if (number === null) {
    return {
      status: 200,
      body: {
        repository,
        issues: issues.map((issue) => rowOf(view, issue)),
        labels: view.labels.map((label) => ({
          name: label.name,
          color: label.color ?? null,
          description: label.description ?? null,
        })),
        milestones: view.milestones.map((milestone) => ({
          title: milestone.title,
          state: milestone.state ?? "open",
        })),
        counts: {
          open: issues.filter((issue) => issue.state === "open").length,
          closed: issues.filter((issue) => issue.state === "closed").length,
          all: issues.length,
        },
      },
    };
  }

  const issue = findIssue(view, number);
  if (!issue) return { status: 404, body: { error: "Not found" } };

  return {
    status: 200,
    body: detailOf(owner, view, issue, viewerRole, username, input.assignableMembers ?? []),
  };
}

export interface StubIssueWriteInput {
  owner: string;
  /** `create` posts the list route; every other action addresses one number. */
  action: "create" | "edit" | "comment" | "reaction" | "assignee" | "label" | "milestone" | "state";
  number: string | null;
  view: StubRepositoryView;
  viewerRole: string | null;
  username: string;
  body: unknown;
  /** The accounts with at least Triage permission on the repository. */
  assignableMembers?: readonly string[];
}

function titleError(value: unknown): string | null {
  if (typeof value !== "string") return STUB_ISSUE_MESSAGES.titleRequired;
  const trimmed = value.trim();
  if (trimmed.length === 0) return STUB_ISSUE_MESSAGES.titleRequired;
  if (trimmed.length > STUB_TITLE_MAX_LENGTH) return STUB_ISSUE_MESSAGES.titleTooLong;
  return null;
}

function descriptionError(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > STUB_DESCRIPTION_MAX_LENGTH) {
    return STUB_ISSUE_MESSAGES.descriptionTooLong;
  }
  return null;
}

function commentError(value: unknown): string | null {
  if (typeof value !== "string") return STUB_ISSUE_MESSAGES.commentRequired;
  const trimmed = value.trim();
  if (trimmed.length === 0) return STUB_ISSUE_MESSAGES.commentRequired;
  if (trimmed.length > STUB_COMMENT_MAX_LENGTH) return STUB_ISSUE_MESSAGES.commentTooLong;
  return null;
}

function hasField(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Answers one issue write. The caller has already refused a visitor and an
 * unreadable repository; this mirrors the server rules for the stored role, the
 * field rules and the atomic writes.
 */
export function handleRepositoryIssueWriteStub(input: StubIssueWriteInput): StubIssueRouteResult {
  const { view, viewerRole, username } = input;
  const body = (input.body ?? {}) as Record<string, unknown>;
  const canWrite = viewerRole !== null && WRITE_ROLES.has(viewerRole);
  const canTriage = stubCanTriage(viewerRole);
  const candidates = [...(input.assignableMembers ?? [])];
  const detail = (issue: StubIssue) =>
    detailOf(input.owner, view, issue, viewerRole, username, candidates);

  if (input.action === "create") {
    if (!canWrite) return { status: 403, body: { error: "Access denied" } };
    const rawTitle = typeof body.title === "string" ? body.title : "";
    const rawDescription =
      typeof body.description === "string"
        ? body.description
        : typeof body.body === "string"
          ? body.body
          : "";
    const fieldErrors: Record<string, string> = {};
    const titleReason = titleError(rawTitle);
    if (titleReason) fieldErrors.title = titleReason;
    const descriptionReason = descriptionError(rawDescription);
    if (descriptionReason) fieldErrors.description = descriptionReason;
    if (Object.keys(fieldErrors).length > 0) {
      return { status: 400, body: { error: STUB_ISSUE_MESSAGES.issueNotCreated, fieldErrors } };
    }

    const number = view.issues.reduce((max, issue) => Math.max(max, issue.number), 0) + 1;
    const createdAt = now();
    const issue: StubIssue = {
      number,
      title: rawTitle.trim(),
      body: rawDescription,
      state: "open",
      author: username,
      assignees: [],
      labels: [],
      milestone: null,
      reactions: [],
      comments: [],
      events: [
        { id: nextId("issue-event"), type: "created", actor: username, createdAt, data: {} },
      ],
      createdAt,
      updatedAt: createdAt,
    };
    view.issues.push(issue);
    return { status: 201, body: detail(issue) };
  }

  const issue = findIssue(view, input.number);
  if (!issue) return { status: 404, body: { error: "Not found" } };

  if (input.action === "edit") {
    if (!canWrite) return { status: 403, body: { error: "Access denied" } };
    const wantsTitle = hasField(body, "title");
    const wantsDescription = hasField(body, "description") || hasField(body, "body");
    if (!wantsTitle && !wantsDescription) {
      return {
        status: 400,
        body: {
          error: STUB_ISSUE_MESSAGES.issueNotSaved,
          fieldErrors: { title: STUB_ISSUE_MESSAGES.titleRequired },
        },
      };
    }
    const fieldErrors: Record<string, string> = {};
    if (wantsTitle) {
      const reason = titleError(body.title);
      if (reason) fieldErrors.title = reason;
    }
    if (wantsDescription) {
      const reason = descriptionError(
        typeof body.description === "string" ? body.description : body.body,
      );
      if (reason) fieldErrors.description = reason;
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { status: 400, body: { error: STUB_ISSUE_MESSAGES.issueNotSaved, fieldErrors } };
    }

    const updatedAt = now();
    const events = storedEventsOf(issue);
    if (wantsTitle) {
      issue.title = String(body.title).trim();
      events.push({
        id: nextId("issue-event"),
        type: "edited",
        actor: username,
        createdAt: updatedAt,
        data: { field: "title", title: issue.title },
      });
    }
    if (wantsDescription) {
      issue.body = typeof body.description === "string" ? body.description : String(body.body ?? "");
      events.push({
        id: nextId("issue-event"),
        type: "edited",
        actor: username,
        createdAt: updatedAt,
        data: { field: "description" },
      });
    }
    issue.events = events;
    issue.updatedAt = updatedAt;
    return { status: 200, body: detail(issue) };
  }

  if (input.action === "comment") {
    if (!canWrite) return { status: 403, body: { error: "Access denied" } };
    const raw = typeof body.body === "string" ? body.body : typeof body.comment === "string" ? body.comment : "";
    const reason = commentError(raw);
    if (reason) {
      return {
        status: 400,
        body: { error: STUB_ISSUE_MESSAGES.commentNotAdded, fieldErrors: { comment: reason } },
      };
    }
    const createdAt = now();
    // The history is materialized before the new comment joins it, so a
    // derived comment record is never counted twice.
    const history = storedEventsOf(issue);
    issue.comments = [
      ...(issue.comments ?? []),
      { id: nextId("issue-comment"), author: username, body: raw.trim(), createdAt, reactions: [] },
    ];
    issue.events = [
      ...history,
      { id: nextId("issue-event"), type: "commented", actor: username, createdAt, data: {} },
    ];
    return { status: 201, body: detail(issue) };
  }

  // The triage metadata writes: assignees, labels, milestone and status.
  if (
    input.action === "assignee" ||
    input.action === "label" ||
    input.action === "milestone" ||
    input.action === "state"
  ) {
    if (!canTriage) return { status: 403, body: { error: "Access denied" } };

    if (input.action === "assignee") {
      const name = typeof body.username === "string" ? body.username.trim() : "";
      if (name.length === 0) {
        return {
          status: 400,
          body: {
            error: STUB_ISSUE_MESSAGES.metadataNotSaved,
            fieldErrors: { username: STUB_ISSUE_MESSAGES.memberNotAssignable },
          },
        };
      }
      const assignees = [...(issue.assignees ?? [])];
      const assigned = assignees.includes(name);
      const desired = typeof body.assigned === "boolean" ? body.assigned : !assigned;
      if (desired && !candidates.includes(name)) {
        return {
          status: 400,
          body: {
            error: STUB_ISSUE_MESSAGES.metadataNotSaved,
            fieldErrors: { username: STUB_ISSUE_MESSAGES.memberNotAssignable },
          },
        };
      }
      if (desired === assigned) return { status: 200, body: detail(issue) };
      issue.assignees = desired
        ? [...assignees, name]
        : assignees.filter((candidate) => candidate !== name);
      issue.events = [
        ...storedEventsOf(issue),
        {
          id: nextId("issue-event"),
          type: desired ? "assigned" : "unassigned",
          actor: username,
          createdAt: now(),
          data: { assignee: name },
        },
      ];
      issue.updatedAt = now();
      return { status: 200, body: detail(issue) };
    }

    if (input.action === "label") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      // Only a label of the current repository may be associated.
      const label = view.labels.find((candidate) => candidate.name === name);
      if (!label) {
        return {
          status: 400,
          body: {
            error: STUB_ISSUE_MESSAGES.metadataNotSaved,
            fieldErrors: { name: STUB_ISSUE_MESSAGES.labelUnsupported },
          },
        };
      }
      const appliedLabels = [...(issue.labels ?? [])];
      const applied = appliedLabels.includes(label.name);
      const desired = typeof body.applied === "boolean" ? body.applied : !applied;
      if (desired === applied) return { status: 200, body: detail(issue) };
      issue.labels = desired
        ? [...appliedLabels, label.name]
        : appliedLabels.filter((candidate) => candidate !== label.name);
      issue.events = [
        ...storedEventsOf(issue),
        {
          id: nextId("issue-event"),
          type: desired ? "labeled" : "unlabeled",
          actor: username,
          createdAt: now(),
          data: { labelName: label.name },
        },
      ];
      issue.updatedAt = now();
      return { status: 200, body: detail(issue) };
    }

    if (input.action === "milestone") {
      const raw = "title" in body ? body.title : body.milestone;
      const title = typeof raw === "string" ? raw.trim() : null;
      if (title === null || title.length === 0) {
        if (!issue.milestone) return { status: 200, body: detail(issue) };
        issue.milestone = null;
        issue.events = [
          ...storedEventsOf(issue),
          { id: nextId("issue-event"), type: "unmilestoned", actor: username, createdAt: now(), data: {} },
        ];
        issue.updatedAt = now();
        return { status: 200, body: detail(issue) };
      }
      const milestone = view.milestones.find((candidate) => candidate.title === title);
      if (!milestone) {
        return {
          status: 400,
          body: {
            error: STUB_ISSUE_MESSAGES.metadataNotSaved,
            fieldErrors: { title: STUB_ISSUE_MESSAGES.milestoneUnsupported },
          },
        };
      }
      if (issue.milestone === milestone.title) return { status: 200, body: detail(issue) };
      issue.milestone = milestone.title;
      issue.events = [
        ...storedEventsOf(issue),
        {
          id: nextId("issue-event"),
          type: "milestoned",
          actor: username,
          createdAt: now(),
          data: { milestoneTitle: milestone.title },
        },
      ];
      issue.updatedAt = now();
      return { status: 200, body: detail(issue) };
    }

    const state = body.state === "closed" ? "closed" : body.state === "open" ? "open" : null;
    if (state === null) {
      return {
        status: 400,
        body: {
          error: STUB_ISSUE_MESSAGES.stateNotSaved,
          fieldErrors: { state: STUB_ISSUE_MESSAGES.stateUnsupported },
        },
      };
    }
    if (state === issue.state) return { status: 200, body: detail(issue) };
    const createdAt = now();
    issue.state = state;
    issue.closedAt = state === "closed" ? createdAt : null;
    issue.closedBy = state === "closed" ? username : null;
    issue.events = [
      ...storedEventsOf(issue),
      {
        id: nextId("issue-event"),
        type: state === "closed" ? "closed" : "reopened",
        actor: username,
        createdAt,
        data: {},
      },
    ];
    issue.updatedAt = createdAt;
    return { status: 200, body: detail(issue) };
  }

  // A reaction only needs a signed-in viewer who can read the issue.
  const reaction = typeof body.reaction === "string" ? body.reaction : "";
  if (!STUB_REACTION_TYPES.includes(reaction)) {
    return {
      status: 400,
      body: {
        error: STUB_ISSUE_MESSAGES.reactionNotSaved,
        fieldErrors: { reaction: STUB_ISSUE_MESSAGES.reactionUnsupported },
      },
    };
  }
  const commentId = typeof body.commentId === "string" && body.commentId.length > 0
    ? body.commentId
    : null;
  const target: { reactions?: Array<{ reaction: string; username: string }> } | null =
    commentId === null
      ? issue
      : (() => {
          const index = (issue.comments ?? []).findIndex(
            (_comment, position) => commentIdOf(issue, position) === commentId,
          );
          return index === -1 ? null : (issue.comments?.[index] as StubComment);
        })();
  if (target === null) return { status: 404, body: { error: "Not found" } };

  const stored = target.reactions ?? [];
  const existing = stored.findIndex(
    (candidate) => candidate.reaction === reaction && candidate.username === username,
  );
  if (existing === -1) stored.push({ reaction, username });
  else stored.splice(existing, 1);
  target.reactions = stored;

  const createdAt = now();
  issue.events = [
    ...storedEventsOf(issue),
    {
      id: nextId("issue-event"),
      type: existing === -1 ? "reacted" : "unreacted",
      actor: username,
      createdAt,
      data: { reaction, target: commentId === null ? "issue" : "comment" },
    },
  ];
  return { status: 200, body: detail(issue) };
}
