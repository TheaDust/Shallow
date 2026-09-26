export interface SessionUser {
  username: string;
  email: string;
}

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'ready'; user: SessionUser | null };

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export interface RegisterErrors {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  agreeToTerms?: string;
}

export type RegisterResult =
  | { ok: true; username: string; email: string; emailVerified: boolean }
  | { ok: false; errors: RegisterErrors };

export type SignInResult =
  | { ok: true; username: string; email: string }
  | { ok: false; message: string };

export type SessionResult =
  | { authenticated: true; username: string; email: string }
  | { authenticated: false };

export interface RecoveryRequestResult {
  ok: true;
  code: string;
}

export interface RecoveryErrors {
  email?: string;
  verificationCode?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export type RecoveryResetResult =
  | { ok: true; message: string }
  | { ok: false; errors: RecoveryErrors };

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export type ChangePasswordResult =
  | { ok: true; message: string }
  | { ok: false; errors: ChangePasswordErrors };

// ---- REQ-2-1 organizations and repositories ----

export interface OrganizationSummary {
  name: string;
  displayName: string;
  createdAt: string;
  /** REQ-3-2-1: the signed-in account's role in this organization (null for visitors/non-members). */
  role?: string | null;
}

export interface CreateOrganizationPayload {
  name: string;
  displayName: string;
}

export interface CreateOrganizationErrors {
  name?: string;
  displayName?: string;
}

export type CreateOrganizationResult =
  | { ok: true; organization: OrganizationSummary }
  | { ok: false; errors: CreateOrganizationErrors };

export interface RepoSummary {
  name: string;
  description: string;
  visibility: 'public' | 'private';
  updatedAt: string;
}

export interface OrganizationMember {
  username: string;
  role: 'owner' | 'member';
}

export interface AddOrganizationMemberPayload {
  identifier: string;
  role: 'member' | 'owner';
}

export interface AddOrganizationMemberErrors {
  identifier?: string;
  role?: string;
}

export type AddOrganizationMemberResult =
  | { ok: true; member: { username: string; role: 'owner' | 'member' } }
  | { ok: false; errors: AddOrganizationMemberErrors };

export interface TeamSummary {
  name: string;
  description: string;
  parentTeamName: string | null;
}

export interface TeamCore {
  name: string;
  description: string;
  parentTeamName: string | null;
  createdAt: string;
}

export interface TeamDetail extends TeamCore {
  creator: string | null;
  ancestorNames: string[];
  organization: OrganizationSummary;
}

export interface CreateTeamPayload {
  name: string;
  description: string;
  parentTeamName: string;
}

export interface CreateTeamErrors {
  name?: string;
  parentTeam?: string;
}

export type CreateTeamResult =
  | { ok: true; team: TeamCore }
  | { ok: false; errors: CreateTeamErrors };

export type UpdateTeamParentResult =
  | { ok: true; team: TeamCore }
  | { ok: false; errors: CreateTeamErrors };

export type TeamDetailResult =
  | { ok: true; team: TeamDetail }
  | { ok: false; status: number; message: string };

export type TeamMembersResult =
  | { ok: true; members: { username: string }[] }
  | { ok: false; status: number; message: string };

export interface AddTeamMemberErrors {
  username?: string;
}

export type AddTeamMemberResult =
  | { ok: true; member: { username: string } }
  | { ok: false; errors: AddTeamMemberErrors };

export type RemoveTeamMemberResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

/**
 * REQ-2-2-4: result of removing a member from an organization. The server
 * rejects the operation when the caller is not an Owner or the target is the
 * last Owner (all relationships stay unchanged in that case).
 */
export type RemoveOrganizationMemberResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export interface UpdateTeamParentPayload {
  parentTeamName: string;
}

export interface RepositoryOverview {
  owner: string;
  ownerType: 'user' | 'organization';
  name: string;
  description: string;
  visibility: 'public' | 'private';
  defaultBranch: string;
  updatedAt: string;
  createdAt: string;
  role: string | null;
  /**
   * REQ-3-2-2: the source repository of a fork (owner + name) or null when
   * the repository is not a fork; the overview renders “Forked from
   * <source repository name>” with a link to the source overview.
   */
  forkedFrom?: { owner: string; name: string } | null;
}

export type OrganizationResult =
  | { ok: true; organization: OrganizationSummary; role?: string | null }
  | { ok: false; status: number; message: string };

export type OrganizationRepositoriesResult =
  | { ok: true; repositories: RepoSummary[] }
  | { ok: false; status: number; message: string };

export type OrganizationPeopleResult =
  | { ok: true; members: OrganizationMember[] }
  | { ok: false; status: number; message: string };

export type OrganizationTeamsResult =
  | { ok: true; teams: TeamSummary[] }
  | { ok: false; status: number; message: string };

export type OrganizationsResult =
  | { ok: true; organizations: OrganizationSummary[] }
  | { ok: false; status: number; message: string };

export type RepositoryResult =
  | { ok: true; repository: RepositoryOverview }
  | { ok: false; status: number; message: string };

// ---- REQ-3-2-1 repository creation and content ----

export interface RepositorySummary {
  owner: string;
  ownerType: 'user' | 'organization';
  name: string;
  description: string;
  visibility: 'public' | 'private';
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRepositoryPayload {
  owner: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  initialize: boolean;
}

export interface CreateRepositoryErrors {
  owner?: string;
  name?: string;
  visibility?: string;
}

export type CreateRepositoryResult =
  | { ok: true; repository: RepositorySummary }
  | { ok: false; errors: CreateRepositoryErrors };

// ---- REQ-3-2-2 repository forking ----

export interface ForkRepositoryPayload {
  owner: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
}

export type ForkRepositoryErrors = CreateRepositoryErrors;

export type ForkRepositoryResult =
  | { ok: true; repository: RepositorySummary }
  | { ok: false; errors: ForkRepositoryErrors };

export type UserRepositoriesResult =
  | { ok: true; repositories: RepositorySummary[] }
  | { ok: false; status: number; message: string };

export interface RepositoryBranchInfo {
  name: string;
  headCommitId: string | null;
}

/**
 * REQ-4-3-1: the branch list of a repository for the Code page branch
 * selector. The server returns the default branch name and every stored
 * branch (name + pointed-to commit); the default branch is listed first.
 * REQ-4-3-2: `canCreate` tells the selector whether the signed-in account
 * may create branches (Write, Maintain, Admin, or organization Owner
 * status); Read/Triage/visitors only browse and never see the create entry.
 */
export type RepositoryBranchesResult =
  | { ok: true; defaultBranch: string; canCreate: boolean; branches: RepositoryBranchInfo[] }
  | { ok: false; status: number; message: string };

// ---- REQ-4-3-2 create a branch from an existing revision ----

/**
 * REQ-4-3-2: a branch-creation request. `name` is the new branch name; `base`
 * is the branch whose head commit the new branch points to (the Code page
 * always sends the branch it is currently reading; the server defaults to the
 * repository default branch when omitted).
 */
export interface CreateBranchPayload {
  name: string;
  base: string;
}

export interface CreateBranchErrors {
  name?: string;
  base?: string;
}

export type CreateBranchResult =
  | { ok: true; branch: RepositoryBranchInfo }
  | { ok: false; status: number; message: string; errors?: CreateBranchErrors };


export interface RepositoryFileEntry {
  path: string;
  content: string;
}

/**
 * REQ-4-1: one entry of a directory listing. `name` is the exact last path
 * segment (used as the link's accessible name); `type` distinguishes
 * directories from files; `path` is the full path used for the href.
 */
export interface RepositoryTreeEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

export type RepositoryContentsResult =
  | { ok: true; branch: RepositoryBranchInfo | null; files: RepositoryFileEntry[]; entries?: RepositoryTreeEntry[] }
  | { ok: false; status: number; message: string };

export interface RepositoryCommit {
  id: string;
  message: string;
  author: string | null;
  createdAt: string;
  /** REQ-4-2-1: short hash (the first characters of the stored commit id). */
  shortId?: string;
  /** REQ-4-2-1: parent commit references (id, short hash, message). */
  parents?: { id: string; shortId: string; message: string }[];
  /** REQ-4-2-1: changed file paths in this commit's snapshot. */
  files?: string[];
}

export type RepositoryCommitsResult =
  | {
      ok: true;
      branch: RepositoryBranchInfo | null;
      commits: RepositoryCommit[];
    }
  | { ok: false; status: number; message: string };

/** REQ-4-1: the most recent commit of a file on a branch (file page). */
export type RepositoryFileCommit = RepositoryCommit;

export type RepositoryFileResult =
  | {
      ok: true;
      branch: string;
      file: RepositoryFileEntry;
      commit?: RepositoryFileCommit | null;
      /** REQ-4-4: the signed-in account's effective repository role (the file page gates its Edit entry on it). */
      role?: string | null;
    }
  | { ok: false; status: number; message: string };

/** REQ-4-1: directory listing of a branch path (directory page). */
export type RepositoryTreeResult =
  | {
      ok: true;
      branch: RepositoryBranchInfo;
      path: string;
      entries: RepositoryTreeEntry[];
      /** REQ-4-4: the signed-in account's effective repository role (the Code page gates its Add file entry on it). */
      role?: string | null;
    }
  | { ok: false; status: number; message: string };

// ---- REQ-4-4 web file editor ----

/**
 * REQ-4-4: a web file-editor submission. `path` is the file name (may
 * contain slashes), `content` the full text, `message` the commit message,
 * and `branch` the branch whose head the new commit moves to.
 */
export interface FileWritePayload {
  branch: string;
  path: string;
  content: string;
  message: string;
}

/** REQ-4-4: per-field rejection reasons of a file-editor submission. */
export interface FileWriteErrors {
  path?: string;
  message?: string;
  branch?: string;
}

export type FileWriteResult =
  | {
      ok: true;
      branch: { name: string; headCommitId: string };
      commit: RepositoryCommit;
      file: RepositoryFileEntry;
    }
  | { ok: false; status: number; message: string; errors?: FileWriteErrors };


// ---- REQ-4-2-1 commit history and commit detail ----

/** REQ-4-2-2: one line of a line-by-line diff (context, addition, deletion). */
export interface RepositoryDiffLine {
  type: 'context' | 'add' | 'del';
  text: string;
}

/**
 * REQ-4-2-2: one changed file of a commit/compare diff. Only files whose
 * content differs between the base and compare revisions appear; each carries
 * the compare-side content (null for deleted files), the exact added/deleted
 * line counts and the ordered line-by-line diff.
 */
export interface RepositoryDiffFile {
  path: string;
  content: string | null;
  additions: number;
  deletions: number;
  lines: RepositoryDiffLine[];
}

/** REQ-4-2-2: a revision identifier shown on a diff page. */
export interface RepositoryRevisionRef {
  id: string;
  shortId: string;
  message: string;
}

/**
 * REQ-4-2-1/REQ-4-2-2: commit detail page payload. Carries the parent
 * revision references and the read-only diff of this commit versus its first
 * parent (base), including only the changed files (path + compare content +
 * per-file line counts + diff lines) and the aggregate additions/deletions.
 */
export interface RepositoryCommitDetail {
  id: string;
  shortId: string;
  message: string;
  author: string | null;
  createdAt: string;
  parents: RepositoryRevisionRef[];
  /** The base revision of the shown diff (the first parent) or null. */
  base: RepositoryRevisionRef | null;
  files: RepositoryDiffFile[];
  additions: number;
  deletions: number;
}

export type RepositoryCommitDetailResult =
  | { ok: true; commit: RepositoryCommitDetail }
  | { ok: false; status: number; message: string };

/**
 * REQ-4-2-2: result of comparing two readable commits of a repository. The
 * payload carries the base and compare revision identifiers, only the changed
 * files (per-file added/deleted line counts + line diff), and the aggregate
 * additions/deletions. A null base means an empty tree (e.g. the root commit).
 */
export type RepositoryCompareResult =
  | {
      ok: true;
      base: RepositoryRevisionRef | null;
      compare: RepositoryRevisionRef;
      files: RepositoryDiffFile[];
      additions: number;
      deletions: number;
    }
  | { ok: false; status: number; message: string };

// ---- REQ-3-1 global repository search ----

export interface SearchRepository {
  owner: string;
  ownerType: 'user' | 'organization';
  name: string;
  description: string;
  visibility: 'public' | 'private';
  updatedAt: string;
}

export type RepositorySearchResult =
  | { ok: true; repositories: SearchRepository[] }
  | { ok: false; status: number; message: string };

// ---- REQ-4-2-3 repository code search ----

/**
 * REQ-4-2-3: one matching file of a repository code search. `name` is the
 * exact file name (used as the result link's accessible name), `path` the
 * full path, `line` the 1-based line of the first match, `snippet` that line
 * (the query is visible as a complete text value), and `branch` the branch
 * context of the hit.
 */
export interface RepositoryCodeSearchHit {
  path: string;
  name: string;
  line: number;
  snippet: string;
  branch: string;
}

export type RepositoryCodeSearchResult =
  | {
      ok: true;
      repository: { owner: string; name: string };
      branch: RepositoryBranchInfo | null;
      query: string;
      path: string;
      language: string;
      languages: string[];
      results: RepositoryCodeSearchHit[];
    }
  | { ok: false; status: number; message: string };

// ---- REQ-2-3 repository access management ----

export type RepoRole = 'read' | 'triage' | 'write' | 'maintain' | 'admin';

export interface RepoAccessGrant {
  subjectType: 'user' | 'team';
  subjectName: string;
  role: RepoRole;
  grantedBy: string | null;
  updatedAt: string;
}

export interface GrantRepoAccessPayload {
  subjectType: 'user' | 'team';
  subjectName: string;
  role: RepoRole;
}

export interface RepoAccessErrors {
  subjectType?: string;
  subjectName?: string;
  role?: string;
}

export type RepoAccessListResult =
  | { ok: true; grants: RepoAccessGrant[] }
  | { ok: false; status: number; message: string };

export type GrantRepoAccessResult =
  | { ok: true; grants: RepoAccessGrant[] }
  | { ok: false; errors: RepoAccessErrors };

export type UpdateRepoAccessResult =
  | { ok: true; grants: RepoAccessGrant[] }
  | { ok: false; status: number; errors?: RepoAccessErrors; message?: string };

// ---- REQ-3-4 repository visibility ----

export interface UpdateRepositoryVisibilityPayload {
  visibility: 'public' | 'private';
  confirmation: string;
}

export interface UpdateRepositoryVisibilityErrors {
  visibility?: string;
  confirmation?: string;
}

export type UpdateRepositoryVisibilityResult =
  | { ok: true; repository: RepositoryOverview }
  | { ok: false; errors: UpdateRepositoryVisibilityErrors };

// ---- REQ-5-1-1 issue discovery and details ----

/**
 * REQ-5-1-1: one issue row of the Issues list page / issue detail page. The
 * number is the persisted unique issue number within its repository; state is
 * the Open/Closed status; labels are the pre-existing repository labels
 * attached to the issue; milestone is the pre-existing goal-classification
 * item or null; body is included in list rows too because the keyword filter
 * matches title or body (filtering only changes displayed rows, it never
 * writes or deletes issues).
 */
export interface IssueSummary {
  number: number;
  title: string;
  state: 'open' | 'closed';
  author: string | null;
  body: string;
  labels: string[];
  milestone: { title: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** REQ-5-1-2: one saved comment of an issue (author, body, time). REQ-5-2-3:
 * the saved comment also carries its reaction groups. */
export interface IssueComment {
  id: string;
  author: string | null;
  body: string;
  createdAt: string;
  reactions?: IssueReactionGroup[];
}

/**
 * REQ-5-2-3: one reaction group of a target (the issue itself or one of its
 * comments): the reaction type, how many accounts reacted, and whether the
 * signed-in account is among them (for the toggle state).
 */
export interface IssueReactionGroup {
  reaction: string;
  count: number;
  reactedByMe: boolean;
}

/**
 * REQ-5-1-2: the kind of one append-only activity-timeline event of an
 * issue. This read view ships the creation and comment events; later
 * features append edits, assignment, labels, milestone, and status changes.
 */
export type IssueActivityType =
  | 'created'
  | 'commented'
  | 'edited'
  | 'closed'
  | 'reopened'
  | 'assigned'
  | 'unassigned'
  | 'labeled'
  | 'unlabeled'
  | 'milestoned'
  | 'demilestoned';

/** REQ-5-1-2: one activity-timeline record (actor, time, kind, optional body
 * for comments). REQ-5-2-3: commented records link their stored comment id
 * so the page can attach the comment's reactions. The page renders them in
 * the chronological order returned by the server. */
export interface IssueActivityEvent {
  type: IssueActivityType;
  actor: string | null;
  createdAt: string;
  body?: string | null;
  commentId?: string | null;
}

/**
 * REQ-5-1-2: the issue detail page payload (list fields plus closedAt and
 * the discussion data: assignees, comments, and the activity timeline).
 * REQ-5-2-3: the issue itself also carries its own reaction group (comments
 * carry theirs on each comment record).
 */
export interface IssueDetail extends IssueSummary {
  closedAt: string | null;
  assignees: string[];
  comments: IssueComment[];
  activity: IssueActivityEvent[];
  reactions?: IssueReactionGroup[];
}

export type IssuesResult =
  | { ok: true; issues: IssueSummary[]; labels: string[]; role: string | null }
  | { ok: false; status: number; message: string };

export type IssueDetailResult =
  | { ok: true; issue: IssueDetail; role: string | null }
  | { ok: false; status: number; message: string };

/** REQ-5-2-2: the issue edit payload (title and description are separate actions). */
export interface IssueEditPayload {
  title?: string;
  body?: string;
}

/** REQ-5-2-2: field errors of a rejected issue edit submission. */
export interface IssueEditErrors {
  title?: string;
  body?: string;
}

export type IssueEditResult =
  | { ok: true; issue: IssueDetail }
  | {
      ok: false;
      status: number;
      errors?: IssueEditErrors;
      message?: string;
    };

/** REQ-5-2-1: the issue-creation form payload (Title + optional Description). */
export interface CreateIssuePayload {
  title: string;
  body: string;
}

/** REQ-5-2-1: field errors of a rejected issue-creation submission. */
export interface CreateIssueErrors {
  title?: string;
  body?: string;
}

export type CreateIssueResult =
  | { ok: true; issue: IssueDetail }
  | {
      ok: false;
      status: number;
      errors?: CreateIssueErrors;
      message?: string;
    };

/** REQ-5-2-3: the comment-editor payload (the comment text). */
export interface IssueCommentPayload {
  body: string;
}

/** REQ-5-2-3: field errors of a rejected comment submission. */
export interface IssueCommentErrors {
  body?: string;
}

export type IssueCommentResult =
  | { ok: true; issue: IssueDetail; role: string | null }
  | {
      ok: false;
      status: number;
      errors?: IssueCommentErrors;
      message?: string;
    };

/** REQ-5-2-3: result of toggling a reaction on the issue or a comment. */
export type IssueReactionResult =
  | { ok: true; issue: IssueDetail; role: string | null }
  | { ok: false; status: number; message: string };

/**
 * REQ-5-3-1: the assignee-options payload of one issue — the exact usernames
 * of the accounts assignable in the current repository (effective repository
 * role at least Triage; the server filters so non-assignable users never
 * appear). The selector combines these options with the issue's current
 * assignees to render the checked state.
 */
export type IssueAssigneeOptionsResult =
  | { ok: true; assignable: string[] }
  | { ok: false; status: number; message: string };

/** REQ-5-3-1: result of assigning or unassigning one participant. */
export type IssueAssigneeResult =
  | { ok: true; issue: IssueDetail; role: string | null }
  | { ok: false; status: number; message: string };

/**
 * REQ-5-3-2: the label-options payload of one issue — the exact names of the
 * current repository's pre-existing labels (the only labels the selector may
 * offer). The server scopes the list to the current repository: labels stored
 * for any other repository (even with the same name) never appear. The
 * selector combines these options with the issue's current labels to render
 * the checked state.
 */
export type IssueLabelOptionsResult =
  | { ok: true; labels: string[] }
  | { ok: false; status: number; message: string };

/** REQ-5-3-2: result of applying or removing one label. */
export type IssueLabelResult =
  | { ok: true; issue: IssueDetail; role: string | null }
  | { ok: false; status: number; message: string };

/**
 * REQ-5-3-3: the milestone-options payload of one issue — the exact titles
 * of the current repository's pre-existing milestones (the only milestones
 * the picker may offer). The server scopes the list to the current
 * repository: a milestone stored for any other repository never appears.
 * The picker combines these options with the “None” removal option and the
 * issue's current milestone to render the selected state.
 */
export type IssueMilestoneOptionsResult =
  | { ok: true; milestones: string[] }
  | { ok: false; status: number; message: string };

/** REQ-5-3-3: result of setting or removing an issue's milestone. */
export type IssueMilestoneResult =
  | { ok: true; issue: IssueDetail; role: string | null }
  | { ok: false; status: number; message: string };

/** REQ-5-4: result of closing or reopening an issue. */
export type IssueStateResult =
  | { ok: true; issue: IssueDetail; role: string | null }
  | { ok: false; status: number; message: string };

// ---- REQ-6-1 pull requests and branch protection ----

/**
 * REQ-6-1: the persisted status of a pull request. Normal creation produces
 * Open, draft creation produces Draft, Closed and Merged are the remaining
 * valid states; Merged is terminal. The list and detail pages render the
 * exact status word as visible text.
 */
export type PullRequestStatus = 'draft' | 'open' | 'closed' | 'merged';

/**
 * REQ-6-2-1: the review status of a pull request on its current compare
 * commit — the value the list's review-status filter reads. `approved`
 * means a valid Approve decision exists, `changes_requested` means a valid
 * Request changes decision exists (which takes precedence), and
 * `review_required` means there is no valid Approve/Request changes
 * decision (only comments or no reviews at all).
 */
export type PullRequestReviewStatus =
  | 'approved'
  | 'changes_requested'
  | 'review_required';

/**
 * REQ-6-1: one pull request row of the Pull requests list. Carries the
 * repository-scoped number, the persisted title (the row link's accessible
 * name), the author, the source/target branch names, the status, and
 * (REQ-6-2-1) the review status of the current compare commit.
 */
export interface PullRequestSummary {
  number: number;
  title: string;
  author: string | null;
  status: PullRequestStatus;
  baseBranch: string;
  compareBranch: string;
  reviewStatus: PullRequestReviewStatus;
  createdAt: string;
  updatedAt: string;
}

/** REQ-6-1: one append-only activity record of a pull request. */
export interface PullRequestActivityEvent {
  type: string;
  actor: string | null;
  createdAt: string;
  body?: string | null;
}

/**
 * REQ-6-3-1: one ordinary (non-inline) discussion comment of a pull
 * request — the author, the verbatim body, and the time. Conversation
 * displays these comments as part of the discussion timeline.
 */
export interface PullRequestComment {
  id: string;
  author: string | null;
  body: string;
  createdAt: string;
}

/**
 * REQ-6-3-3: one inline review comment anchored to a changed (added or
 * deleted) line of the Files changed view. It stores the target PR, the
 * file path, the compare commit it was created on, the diff line position,
 * the author, the body, and the publication state. `pending === true` is a
 * Start-a-review draft that is not public until the review is submitted
 * (visible only to its author); `outdated === true` means the compare
 * commit the comment was made on is no longer the PR's current compare
 * commit (published comments are retained but marked Outdated, drafts are
 * never published automatically).
 */
export interface PullRequestInlineComment {
  id: string;
  filePath: string;
  line: number;
  body: string;
  author: string | null;
  commitId: string;
  createdAt: string;
  pending: boolean;
  outdated: boolean;
}

/**
 * REQ-6-3-1: one review-decision summary shown in the Conversation
 * timeline — the reviewer, the decision (approve, request_changes, or
 * comment), the explanation, the compare commit it was made on, and the
 * time. A new compare commit makes old decisions stale for merge counting
 * but the summaries stay in the timeline.
 */
export interface PullRequestReviewSummary {
  id: string;
  reviewer: string | null;
  decision: 'approve' | 'request_changes' | 'comment';
  explanation: string;
  commitId: string;
  createdAt: string;
}

/**
 * REQ-6-1: the `test` check attached to the PR's current compare commit.
 * The status is pending, success, or failure; the setter and time are stored
 * when an Admin updates the status from the Checks area.
 */
export interface PullRequestCheck {
  status: 'pending' | 'success' | 'failure';
  setter: string | null;
  updatedAt: string | null;
}

/**
 * REQ-6-1: the pull request detail page payload — the list row plus the
 * description, the creation-time and current compare commits, the activity
 * timeline, the ordinary discussion comments and review summaries
 * (REQ-6-3-1 Conversation), the commits on the compare branch relative to
 * base, the per-file diff of the base versus the current compare commit,
 * the Checks area, and the merge eligibility (a PR without 1 valid
 * non-author approval, with any valid Request changes, or with `test` not
 * equal to success is unmergeable).
 */
export interface PullRequestDetail extends PullRequestSummary {
  description: string;
  baseCommitId: string | null;
  compareCommitId: string;
  currentCompareCommitId: string | null;
  activity: PullRequestActivityEvent[];
  comments: PullRequestComment[];
  /** REQ-6-3-3: inline review comments anchored to changed lines of the
   * Files changed view. Published comments are visible to every viewer;
   * a pending Start-a-review draft is visible only to its author. */
  inlineComments: PullRequestInlineComment[];
  /** REQ-6-4: the requested reviewers of the PR — the usernames of its
   * pending-review request relationships, shown in the Reviewers area on
   * the right side of the detail page. A reviewer request is not the same
   * as a submitted review decision. */
  reviewers: string[];
  reviews: PullRequestReviewSummary[];
  commits: RepositoryCommit[];
  filesChanged: RepositoryDiffFile[];
  additions: number;
  deletions: number;
  checks: Record<string, PullRequestCheck>;
  mergeable: boolean;
  blockedReasons: string[];
  /** REQ-6-5: the per-condition satisfaction list displayed by the merge
   * confirmation area — each applicable merge condition (no conflicts, no
   * valid Request changes, and the enabled branch-protection requirements)
   * with its satisfied/unsatisfied state. */
  mergeConditions?: { label: string; satisfied: boolean }[];
  /** REQ-6-5: the merger username, merge time, and resulting merge commit
   * identifier stored when the PR is merged (Merged is terminal). */
  mergedBy?: string | null;
  mergedAt?: string | null;
  mergeCommitId?: string | null;
}

export type PullRequestsResult =
  | { ok: true; pulls: PullRequestSummary[]; role: string | null }
  | { ok: false; status: number; message: string };

export type PullRequestDetailResult =
  | { ok: true; pull: PullRequestDetail; role: string | null }
  | { ok: false; status: number; message: string };

/**
 * REQ-6-5: the result of the merge confirmation. The merge POST re-reads
 * the target branch head, the current compare commit, the merge-conflict
 * state, and the protection rules at confirmation time; an unsatisfied
 * condition returns the verbatim reasons (e.g. `Review required by branch
 * protection`) without changing the target branch or the PR.
 */
export type PullRequestMergeResult =
  | { ok: true; pull: PullRequestDetail; role: string | null }
  | { ok: false; status: number; message: string; reasons: string[] };


/**
 * REQ-6-2-2: one branch reference of the PR comparison page — the exact
 * branch name and the commit the branch currently points to. The comparison
 * is read-only: base is the target branch that receives the merge result,
 * compare is the source branch that provides the changes.
 */
export interface PullRequestBranchRef {
  name: string;
  headCommitId: string | null;
}

/**
 * REQ-6-2-2: the read-only branch-comparison result of the PR creation
 * flow. The system calculates the comparable commits (commits on the
 * compare branch relative to the base branch), the changed files with the
 * per-file line diff, and the aggregate additions/deletions based on the
 * commits the two branches currently point to. Comparison never saves a PR,
 * commit, or branch change.
 */
export interface PullRequestBranchCompare {
  base: PullRequestBranchRef;
  compare: PullRequestBranchRef;
  commitCount: number;
  commits: RepositoryCommit[];
  files: RepositoryDiffFile[];
  additions: number;
  deletions: number;
}

export type PullRequestBranchCompareResult =
  | { ok: true; role: string | null; compare: PullRequestBranchCompare }
  | { ok: false; status: number; message: string };

/** REQ-6-2-3/REQ-6-2-4: the pull-request-creation form payload (Title +
 * optional Description, plus the confirmed distinct base/compare branches).
 * `draft: true` creates the PR in Draft state (REQ-6-2-4); omitting it
 * creates an Open PR. */
export interface CreatePullRequestPayload {
  title: string;
  description: string;
  base: string;
  compare: string;
  draft?: boolean;
}

/** REQ-6-2-3: field errors of a rejected pull-request creation. `general`
 * carries cross-cutting rejections (same branches / no differences / an
 * existing Open or Draft PR for the pair). */
export interface CreatePullRequestErrors {
  title?: string;
  description?: string;
  base?: string;
  compare?: string;
  general?: string;
}

/** REQ-6-2-3: result of submitting a pull-request creation. On success the
 * page opens the new PR by its returned repository-scoped number; rejected
 * or failed submissions (insufficient permission, same branches, no
 * differences, duplicate pair, blank/over-long fields, persistence failure)
 * create neither a PR nor a number. */
export type CreatePullRequestResult =
  | { ok: true; pull: PullRequestDetail; role: string | null }
  | {
      ok: false;
      status: number;
      message: string;
      errors?: CreatePullRequestErrors;
    };

/** REQ-6-1: the Checks-area status update payload. */
export interface UpdatePullCheckPayload {
  status: 'pending' | 'success' | 'failure';
}

/** REQ-6-3-3: an inline review-comment submission payload — the target file
 * path, the diff line position, the body, and whether it stays a pending
 * Start-a-review draft (`pending: true`) or is published immediately. */
export interface AddPullRequestInlineCommentPayload {
  filePath: string;
  line: number;
  body: string;
  pending: boolean;
}

/** REQ-6-3-3: result of submitting an inline review comment. On success the
 * server returns the updated detail so the page can immediately show the
 * comment in the diff view and the Conversation; rejected or failed
 * submissions create no comment and are never displayed as published. */
export type AddPullRequestInlineCommentResult =
  | { ok: true; pull: PullRequestDetail; role: string | null }
  | {
      ok: false;
      status: number;
      message: string;
      errors?: Record<string, string>;
    };

/** REQ-6-1: result of updating the `test` status from the Checks area. */
export type UpdatePullCheckResult =
  | { ok: true; pull: PullRequestDetail; role: string | null }
  | { ok: false; status: number; message: string; errors?: Record<string, string> };

/** REQ-6-2-4: result of the Ready-for-review transition of a Draft PR. On
 * success the same PR number is Open with a `ready_for_review` activity;
 * rejected calls (not a draft, insufficient permission, persistence failure)
 * leave the PR unchanged. */
export type ReadyForReviewResult =
  | { ok: true; pull: PullRequestDetail; role: string | null }
  | { ok: false; status: number; message: string; errors?: Record<string, string> };

/** REQ-6-6: result of closing or reopening a pull request. On success the
 * returned detail shows the new status (Closed after “Close pull request”,
 * Open after “Reopen pull request”) with the appended `closed`/`reopened`
 * activity record; rejected calls (insufficient permission, merged PR,
 * invalid state, persistence failure) leave the PR unchanged. */
export type PullRequestStateResult =
  | { ok: true; pull: PullRequestDetail; role: string | null }
  | { ok: false; status: number; message: string; errors?: Record<string, string> };

/** REQ-6-3-4: the review decision of a pull-request review submission —
 * Comment, Approve, or Request changes. */
export type PullRequestReviewDecision =
  | 'comment'
  | 'approve'
  | 'request_changes';

/** REQ-6-3-4: the review form payload — the decision plus an optional
 * Summary (explanation). Approve without a summary is valid. */
export interface SubmitPullRequestReviewPayload {
  decision: PullRequestReviewDecision;
  explanation?: string;
}

/** REQ-6-3-4: result of submitting a pull-request review. On success the
 * returned detail carries the review summary in Conversation and the review
 * status used by the merge eligibility; a new decision by the same reviewer
 * replaces the reviewer's effective decision for the current compare commit
 * while preserving the old record. Rejected or failed submissions (no
 * permission, PR author, Draft PR, invalid decision, persistence failure)
 * persist nothing and are never displayed as published. */
export type SubmitPullRequestReviewResult =
  | { ok: true; pull: PullRequestDetail; role: string | null }
  | { ok: false; status: number; message: string; errors?: Record<string, string> };

/**
 * REQ-6-4: the eligible reviewer candidates of one pull request for the
 * Reviewers picker — every account with Write, Maintain, or Admin on the
 * repository who is not the PR author, sorted by username. Only the PR
 * author of an Open or Draft PR, Maintain, Admin, or the organization Owner
 * may load them (the server rejects 401/403 for everyone else).
 */
export type PullRequestReviewerOptionsResult =
  | { ok: true; eligible: string[] }
  | { ok: false; status: number; message: string };

/** REQ-6-4: result of requesting or removing one reviewer of a pull
 * request. On success the returned detail carries the updated request set
 * so the Reviewers area reflects it immediately and after reload; rejected
 * or failed calls (no permission, unknown user, ineligible candidate,
 * persistence failure) leave the requests unchanged. Removing a request
 * never touches reviews, comments, or activity records already submitted by
 * that reviewer. */
export type ManagePullRequestReviewerResult =
  | { ok: true; pull: PullRequestDetail; role: string | null }
  | { ok: false; status: number; message: string; errors?: Record<string, string> };

/**
 * REQ-6-1: one persisted branch protection rule — the exact branch name it
 * is bound to and the two independently selectable requirement toggles.
 */
export interface BranchProtectionRule {
  branchName: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
  updatedAt: string;
}

/** REQ-6-1: the rule-form payload (exact branch name + requirement toggles). */
export interface BranchProtectionRulePayload {
  branchName: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
}

export interface BranchProtectionRuleErrors {
  branchName?: string;
}

export type BranchProtectionRulesResult =
  | { ok: true; rules: BranchProtectionRule[] }
  | { ok: false; status: number; message: string };

export type SaveBranchProtectionRuleResult =
  | { ok: true; rules: BranchProtectionRule[] }
  | {
      ok: false;
      status: number;
      message: string;
      errors?: BranchProtectionRuleErrors;
    };

// ---- REQ-4-3-3 repository default branch ----

/**
 * REQ-4-3-3: the result of changing a repository's default branch. The server
 * returns the updated repository (its defaultBranch reflects the saved
 * value); rejected requests (unauthenticated, non-Admin, or an unknown
 * branch) leave the saved default branch unchanged.
 */
export type UpdateRepositoryDefaultBranchResult =
  | { ok: true; repository: RepositoryOverview }
  | { ok: false; status: number; message: string };
