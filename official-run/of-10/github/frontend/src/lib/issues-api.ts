import { ApiError, apiRequest } from "./api";
import type { RepositoryContext, RepositoryRole } from "./repositories-api";

/**
 * Issues of one repository (REQ-5). The list payload carries the repository
 * context (identity, visibility and the viewer's role), the label and milestone
 * definitions of that repository and every issue row; the detail payload adds the
 * description, the comments and the activity timeline of one number.
 */

export type IssueStatus = "open" | "closed";

/** The two statuses a work item can be stored in, in their display order. */
export const ISSUE_STATUSES: readonly IssueStatus[] = ["open", "closed"];

/**
 * The bounds and the exact messages of the issue forms (REQ-5-2). A title holds
 * 1-256 non-empty characters after trimming, a description may be empty and holds
 * at most 65536 characters.
 */
export const ISSUE_TITLE_MAX_LENGTH = 256;
export const ISSUE_BODY_MAX_LENGTH = 65536;
export const ISSUE_COMMENT_MAX_LENGTH = 65536;
export const ISSUE_MESSAGES = {
  titleRequired: "Title is required",
  titleTooLong: `Title must be ${ISSUE_TITLE_MAX_LENGTH} characters or fewer`,
  descriptionTooLong: `Description must be ${ISSUE_BODY_MAX_LENGTH} characters or fewer`,
  commentRequired: "Comment is required",
  commentTooLong: `Comment must be ${ISSUE_COMMENT_MAX_LENGTH} characters or fewer`,
};

/**
 * The complaint of one title, or null when it may be stored. The same rule is
 * applied by the server, so a refused save keeps the stored title either way.
 */
export function issueTitleError(value: string): string | null {
  const title = value.trim();
  if (!title) return ISSUE_MESSAGES.titleRequired;
  if (title.length > ISSUE_TITLE_MAX_LENGTH) return ISSUE_MESSAGES.titleTooLong;
  return null;
}

export function issueDescriptionError(value: string): string | null {
  const description = value.trim();
  if (description.length > ISSUE_BODY_MAX_LENGTH) return ISSUE_MESSAGES.descriptionTooLong;
  return null;
}

/**
 * The complaint of one comment body, or null when it may be stored. The same
 * rule is applied by the server, so a refused comment is never appended.
 */
export function issueCommentError(value: string): string | null {
  const body = value.trim();
  if (!body) return ISSUE_MESSAGES.commentRequired;
  if (body.length > ISSUE_COMMENT_MAX_LENGTH) return ISSUE_MESSAGES.commentTooLong;
  return null;
}

/** A classification name defined in the current repository. */
export interface IssueLabel {
  id: string;
  name: string;
  color: string;
}

/** A goal classification defined in the current repository. */
export interface IssueMilestone {
  id: string;
  title: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  description: string;
  status: IssueStatus;
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: IssueLabel[];
  assignees: string[];
  milestone: IssueMilestone | null;
}

export interface IssueComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  reactions?: IssueReaction[];
}

/**
 * One reaction type on one target: its count and whether the current viewer is
 * among the accounts behind it. The viewer may toggle their own association.
 */
export interface IssueReaction {
  type: string;
  count: number;
  reacted: boolean;
  users: string[];
}

export interface IssueActivity {
  id: string;
  type: string;
  actor: string;
  createdAt: string;
  from?: string;
  to?: string;
}

export interface IssueDetail extends IssueSummary {
  reactions?: IssueReaction[];
  comments: IssueComment[];
  activities: IssueActivity[];
}

export interface RepositoryIssuesPayload {
  repository: RepositoryContext;
  issues: IssueSummary[];
  labels: IssueLabel[];
  milestones: IssueMilestone[];
}

export interface RepositoryIssuePayload {
  repository: RepositoryContext;
  issue: IssueDetail;
  labels: IssueLabel[];
  milestones: IssueMilestone[];
  /** Members that may be assigned to this issue; only a manager receives them. */
  assignableMembers?: string[];
}

/** The visible status text of one issue. */
export function issueStatusLabel(status: IssueStatus): string {
  return status === "closed" ? "Closed" : "Open";
}

/**
 * The accessible name of the single status action of the detail page (REQ-5-4):
 * an Open issue offers `Close issue`, a Closed one offers `Reopen issue`.
 */
export function issueStatusActionLabel(status: IssueStatus): string {
  return status === "closed" ? "Reopen issue" : "Close issue";
}

/** Roles that may create issues, edit titles/descriptions and comment. */
export function canWriteIssues(role: RepositoryRole | null | undefined): boolean {
  return role === "write" || role === "maintain" || role === "admin";
}

/** Roles that may assign, label, set a milestone and close or reopen issues. */
export function canManageIssues(role: RepositoryRole | null | undefined): boolean {
  return role === "triage" || role === "maintain" || role === "admin";
}

function issuesPath(owner: string, name: string, suffix = ""): string {
  const base = `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`;
  return suffix ? `${base}/${suffix}` : base;
}

/** Every issue of the repository, with its labels and milestones. */
export function fetchRepositoryIssues(
  owner: string,
  name: string,
): Promise<RepositoryIssuesPayload> {
  return apiRequest<RepositoryIssuesPayload>(issuesPath(owner, name));
}

/** One issue, addressed by its repository-scoped number. */
export function fetchRepositoryIssue(
  owner: string,
  name: string,
  number: number,
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name, String(number)));
}

export interface CreateIssueInput {
  title: string;
  description: string;
}

export function createRepositoryIssue(
  owner: string,
  name: string,
  input: CreateIssueInput,
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveIssueTitle(
  owner: string,
  name: string,
  number: number,
  title: string,
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name, `${number}/title`), {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function saveIssueDescription(
  owner: string,
  name: string,
  number: number,
  description: string,
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name, `${number}/description`), {
    method: "POST",
    body: JSON.stringify({ description }),
  });
}

/** Appends one comment to the discussion of the target issue. */
export function addIssueComment(
  owner: string,
  name: string,
  number: number,
  body: string,
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name, `${number}/comments`), {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

/**
 * Toggles one reaction of the current account on the issue itself
 * (`commentId` omitted) or on one of its comments.
 */
export function toggleIssueReaction(
  owner: string,
  name: string,
  number: number,
  input: { type: string; commentId?: string | null },
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name, `${number}/reactions`), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Assigns or unassigns one account; the association is stored immediately. */
export function saveIssueAssignees(
  owner: string,
  name: string,
  number: number,
  input: { username: string; assigned: boolean },
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name, `${number}/assignees`), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Applies or removes one label of the current repository. */
export function saveIssueLabels(
  owner: string,
  name: string,
  number: number,
  input: { labelId: string; applied: boolean },
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name, `${number}/labels`), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Sets the single milestone of the work item, or `null` to remove it. */
export function saveIssueMilestone(
  owner: string,
  name: string,
  number: number,
  milestoneId: string | null,
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name, `${number}/milestone`), {
    method: "POST",
    body: JSON.stringify({ milestoneId }),
  });
}

/**
 * Stores the new status of the target issue (REQ-5-4). The transition, its
 * operator, its time and its history record are all written on the server, and
 * the answer is the persisted issue the list and the detail page both read.
 */
export function saveIssueStatus(
  owner: string,
  name: string,
  number: number,
  status: IssueStatus,
): Promise<RepositoryIssuePayload> {
  return apiRequest<RepositoryIssuePayload>(issuesPath(owner, name, `${number}/status`), {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

/**
 * Repository context carried by the answer for a number the readable repository
 * does not have, so the page can show it as absent instead of as an unknown
 * address.
 */
export function missingIssueContext(error: unknown): RepositoryContext | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { repository?: RepositoryContext } | null;
  return body?.repository ?? null;
}
