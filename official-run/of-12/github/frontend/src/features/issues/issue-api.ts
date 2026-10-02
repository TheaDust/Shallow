import { apiRequest, mutateJson, mutateJsonSync, type MutationOutcome } from "../../lib/api";
import type { RepositoryRole, RepositorySummary } from "../repositories/repository-api";

/**
 * Typed client for the issue surface (REQ-5, REQ-5-1).
 *
 * An issue is a persistent work item of one repository: the list rows carry the
 * repository-scoped number, title, status, author, labels and update time, and
 * the detail read adds the stored description, the comments and the activity
 * timeline. Both reads answer with the same stored record, so a reload or a
 * second account with view permission sees the same issue.
 */

export type IssueStatus = "open" | "closed";

/** A pre-existing colored classification name of the repository (REQ-5). */
export interface IssueLabel {
  name: string;
  color: string;
  description: string;
}

/** A pre-existing milestone of the repository; it changes no issue content. */
export interface IssueMilestone {
  id: string;
  title: string;
  state: string;
  description: string;
}

/**
 * One reaction of an issue or of a comment (REQ-5-2-3): the subject-target-
 * reaction type association is stored once per account and removed again when
 * the same reaction is selected a second time.
 */
export interface IssueReaction {
  /** The reaction type, rendered as its emoji. */
  type: string;
  count: number;
  /** True when the current viewer is one of the reacting accounts. */
  mine: boolean;
}

/** One row of the Issues list page. */
export interface IssueSummary {
  number: number;
  title: string;
  /** The stored description; the keyword filter also matches its text. */
  body: string;
  status: IssueStatus;
  author: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  commentCount: number;
  /** The reactions attached to the issue itself. */
  reactions: IssueReaction[];
}

export interface IssueComment {
  id: string;
  author: string;
  body: string;
  createdAt: string | null;
  reactions: IssueReaction[];
}

/** One entry of the append-only activity timeline. */
export interface IssueTimelineEntry {
  id: string;
  type: string;
  actor: string;
  text: string;
  createdAt: string | null;
}

/** What the current caller may do with the issues of this repository (REQ-5). */
export interface IssuePermissions {
  canCreateIssue: boolean;
  canEditIssue: boolean;
  canComment: boolean;
  canAssignParticipants: boolean;
  canApplyLabels: boolean;
  canSetMilestone: boolean;
  canChangeStatus: boolean;
}

export interface IssueListPayload {
  repository: RepositorySummary;
  viewerRole: RepositoryRole | null;
  permissions: IssuePermissions;
  labels: IssueLabel[];
  milestones: IssueMilestone[];
  /** Accounts holding at least Triage permission; the assignable members. */
  assignableMembers: string[];
  openCount: number;
  closedCount: number;
  issues: IssueSummary[];
}

export interface IssueDetailPayload {
  repository: RepositorySummary;
  viewerRole: RepositoryRole | null;
  permissions: IssuePermissions;
  /** The pre-existing classification items of the current repository. */
  labels: IssueLabel[];
  milestones: IssueMilestone[];
  /** The accounts the current repository may assign to this issue. */
  assignableMembers: string[];
  issue: IssueSummary;
  comments: IssueComment[];
  timeline: IssueTimelineEntry[];
}

const NO_PERMISSIONS: IssuePermissions = {
  canCreateIssue: false,
  canEditIssue: false,
  canComment: false,
  canAssignParticipants: false,
  canApplyLabels: false,
  canSetMilestone: false,
  canChangeStatus: false,
};

function normalizeReactions(value: IssueReaction[] | undefined): IssueReaction[] {
  return (value ?? []).map((reaction) => ({
    type: reaction.type,
    count: Number(reaction.count ?? 0),
    mine: reaction.mine === true,
  }));
}

function normalizeIssue(value: Partial<IssueSummary> | undefined): IssueSummary {
  return {
    number: Number(value?.number ?? 0),
    title: value?.title ?? "",
    body: value?.body ?? "",
    status: value?.status === "closed" ? "closed" : "open",
    author: value?.author ?? "",
    labels: [...(value?.labels ?? [])],
    assignees: [...(value?.assignees ?? [])],
    milestone: value?.milestone ?? null,
    createdAt: value?.createdAt ?? null,
    updatedAt: value?.updatedAt ?? value?.createdAt ?? null,
    commentCount: Number(value?.commentCount ?? 0),
    reactions: normalizeReactions(value?.reactions),
  };
}

function normalizePermissions(value: Partial<IssuePermissions> | undefined): IssuePermissions {
  return { ...NO_PERMISSIONS, ...(value ?? {}) };
}

function issuePath(owner: string, name: string, suffix = ""): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues${suffix}`;
}

/** The issue rows of a repository, filtered only in the browser (REQ-5-1-1). */
export async function fetchRepositoryIssues(owner: string, name: string): Promise<IssueListPayload> {
  const payload = await apiRequest<Partial<IssueListPayload>>(issuePath(owner, name));
  return {
    repository: payload.repository as RepositorySummary,
    viewerRole: payload.viewerRole ?? null,
    permissions: normalizePermissions(payload.permissions),
    labels: normalizeLabels(payload.labels),
    milestones: normalizeMilestones(payload.milestones),
    assignableMembers: [...(payload.assignableMembers ?? [])],
    openCount: Number(payload.openCount ?? 0),
    closedCount: Number(payload.closedCount ?? 0),
    issues: (payload.issues ?? []).map(normalizeIssue),
  };
}

function normalizeLabels(value: IssueLabel[] | undefined): IssueLabel[] {
  return (value ?? []).map((label) => ({
    name: label.name,
    color: label.color ?? "",
    description: label.description ?? "",
  }));
}

function normalizeMilestones(value: IssueMilestone[] | undefined): IssueMilestone[] {
  return (value ?? []).map((milestone) => ({
    id: milestone.id,
    title: milestone.title,
    state: milestone.state ?? "open",
    description: milestone.description ?? "",
  }));
}

function normalizeComment(value: Partial<IssueComment> | undefined): IssueComment {
  return {
    id: value?.id ?? "",
    author: value?.author ?? "",
    body: value?.body ?? "",
    createdAt: value?.createdAt ?? null,
    reactions: normalizeReactions(value?.reactions),
  };
}

/** One issue of a repository with its comments and its activity (REQ-5-1-2). */
export async function fetchRepositoryIssue(
  owner: string,
  name: string,
  number: string,
): Promise<IssueDetailPayload> {
  const payload = await apiRequest<Partial<IssueDetailPayload>>(
    issuePath(owner, name, `/${encodeURIComponent(number)}`),
  );
  return normalizeDetail(payload);
}

/** The complete detail shape a read and every write of the workflow answers. */
function normalizeDetail(payload: Partial<IssueDetailPayload>): IssueDetailPayload {
  return {
    repository: payload.repository as RepositorySummary,
    viewerRole: payload.viewerRole ?? null,
    permissions: normalizePermissions(payload.permissions),
    labels: normalizeLabels(payload.labels),
    milestones: normalizeMilestones(payload.milestones),
    assignableMembers: [...(payload.assignableMembers ?? [])],
    issue: normalizeIssue(payload.issue),
    comments: (payload.comments ?? []).map(normalizeComment),
    timeline: (payload.timeline ?? []).map((entry) => ({
      id: entry.id,
      type: entry.type ?? "activity",
      actor: entry.actor ?? "",
      text: entry.text ?? "",
      createdAt: entry.createdAt ?? null,
    })),
  };
}

function detailOutcome(
  outcome: MutationOutcome<Partial<IssueDetailPayload>>,
): MutationOutcome<IssueDetailPayload> {
  return outcome.ok ? { ok: true, data: normalizeDetail(outcome.data) } : outcome;
}

/** POST .../issues — create one issue with a title and an optional description. */
export async function createRepositoryIssue(
  owner: string,
  name: string,
  input: { title: string; description: string },
): Promise<MutationOutcome<IssueDetailPayload>> {
  return detailOutcome(await mutateJson(issuePath(owner, name), {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

/**
 * The creation submit of the New issue page (REQ-5-2-1).
 *
 * The submission changes the address of the page, so it is issued blocking: the
 * stored issue exists before the detail address becomes active, exactly like the
 * sign-in submit of REQ-1-1-2 and the file editor of REQ-4-4.
 */
export function createRepositoryIssueSync(
  owner: string,
  name: string,
  input: { title: string; description: string },
): MutationOutcome<IssueDetailPayload> {
  return detailOutcome(mutateJsonSync(issuePath(owner, name), input));
}

/** POST .../issues/:number/title — replace only the title (REQ-5-2-2). */
export async function saveIssueTitle(
  owner: string,
  name: string,
  number: string,
  title: string,
): Promise<MutationOutcome<IssueDetailPayload>> {
  return detailOutcome(await mutateJson(issuePath(owner, name, `/${encodeURIComponent(number)}/title`), {
    method: "POST",
    body: JSON.stringify({ title }),
  }));
}

/** POST .../issues/:number/description — replace only the description. */
export async function saveIssueDescription(
  owner: string,
  name: string,
  number: string,
  description: string,
): Promise<MutationOutcome<IssueDetailPayload>> {
  return detailOutcome(await mutateJson(issuePath(owner, name, `/${encodeURIComponent(number)}/description`), {
    method: "POST",
    body: JSON.stringify({ description }),
  }));
}

/** POST .../issues/:number/comments — append one stored comment (REQ-5-2-3). */
export async function postIssueComment(
  owner: string,
  name: string,
  number: string,
  body: string,
): Promise<MutationOutcome<IssueDetailPayload>> {
  return detailOutcome(await mutateJson(issuePath(owner, name, `/${encodeURIComponent(number)}/comments`), {
    method: "POST",
    body: JSON.stringify({ body }),
  }));
}

/**
 * POST .../issues/:number/assignees — add or remove one issue-account relation
 * (REQ-5-3-1). The username must be an assignable member of the repository;
 * the stored relation is answered with the refreshed detail payload.
 */
export async function toggleIssueAssignee(
  owner: string,
  name: string,
  number: string,
  username: string,
): Promise<MutationOutcome<IssueDetailPayload>> {
  return detailOutcome(await mutateJson(issuePath(owner, name, `/${encodeURIComponent(number)}/assignees`), {
    method: "POST",
    body: JSON.stringify({ username }),
  }));
}

/** POST .../issues/:number/labels — add or remove one issue-label relation (REQ-5-3-2). */
export async function toggleIssueLabel(
  owner: string,
  name: string,
  number: string,
  label: string,
): Promise<MutationOutcome<IssueDetailPayload>> {
  return detailOutcome(await mutateJson(issuePath(owner, name, `/${encodeURIComponent(number)}/labels`), {
    method: "POST",
    body: JSON.stringify({ label }),
  }));
}

/**
 * POST .../issues/:number/milestone — associate the issue with one milestone of
 * the current repository, or clear it with `null` (REQ-5-3-3).
 */
export async function setIssueMilestone(
  owner: string,
  name: string,
  number: string,
  milestone: string | null,
): Promise<MutationOutcome<IssueDetailPayload>> {
  return detailOutcome(await mutateJson(issuePath(owner, name, `/${encodeURIComponent(number)}/milestone`), {
    method: "POST",
    body: JSON.stringify({ milestone }),
  }));
}

/** POST .../issues/:number/status — close or reopen the issue (REQ-5-4). */
export async function changeIssueStatus(
  owner: string,
  name: string,
  number: string,
  status: IssueStatus,
): Promise<MutationOutcome<IssueDetailPayload>> {
  return detailOutcome(await mutateJson(issuePath(owner, name, `/${encodeURIComponent(number)}/status`), {
    method: "POST",
    body: JSON.stringify({ status }),
  }));
}

/**
 * POST .../issues/:number/reactions — add or remove one reaction of the current
 * viewer on the issue itself or on one of its comments (REQ-5-2-3).
 */
export async function toggleIssueReaction(
  owner: string,
  name: string,
  number: string,
  input: { type: string; commentId?: string },
): Promise<MutationOutcome<IssueDetailPayload>> {
  const suffix = input.commentId
    ? `/${encodeURIComponent(number)}/comments/${encodeURIComponent(input.commentId)}/reactions`
    : `/${encodeURIComponent(number)}/reactions`;
  return detailOutcome(await mutateJson(issuePath(owner, name, suffix), {
    method: "POST",
    body: JSON.stringify({ type: input.type }),
  }));
}
