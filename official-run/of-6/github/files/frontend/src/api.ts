import type {
  AddOrganizationMemberErrors,
  AddOrganizationMemberPayload,
  AddOrganizationMemberResult,
  AddPullRequestInlineCommentPayload,
  AddPullRequestInlineCommentResult,
  AddTeamMemberErrors,
  AddTeamMemberResult,
  BranchProtectionRule,
  BranchProtectionRuleErrors,
  BranchProtectionRulePayload,
  BranchProtectionRulesResult,
  SaveBranchProtectionRuleResult,
  ChangePasswordErrors,
  ChangePasswordPayload,
  ChangePasswordResult,
  CreateOrganizationErrors,
  CreateOrganizationPayload,
  CreateOrganizationResult,
  CreateBranchErrors,
  CreateBranchPayload,
  CreateBranchResult,
  CreatePullRequestErrors,
  CreatePullRequestPayload,
  CreatePullRequestResult,
  CreateRepositoryErrors,
  CreateRepositoryPayload,
  CreateRepositoryResult,
  CreateIssueErrors,
  CreateIssuePayload,
  CreateIssueResult,
  CreateTeamErrors,
  CreateTeamPayload,
  CreateTeamResult,
  ForkRepositoryErrors,
  ForkRepositoryPayload,
  ForkRepositoryResult,
  FileWriteErrors,
  FileWritePayload,
  FileWriteResult,
  GrantRepoAccessPayload,
  GrantRepoAccessResult,
  IssueDetail,
  IssueDetailResult,
  IssueEditPayload,
  IssueEditResult,
  IssueCommentErrors,
  IssueCommentPayload,
  IssueCommentResult,
  IssueReactionResult,
  IssueAssigneeOptionsResult,
  IssueAssigneeResult,
  IssueLabelOptionsResult,
  IssueLabelResult,
  IssueMilestoneOptionsResult,
  IssueMilestoneResult,
  IssueStateResult,
  PullRequestBranchCompareResult,
  PullRequestBranchRef,
  PullRequestDetail,
  PullRequestDetailResult,
  PullRequestMergeResult,
  PullRequestReviewerOptionsResult,
  ManagePullRequestReviewerResult,
  PullRequestSummary,
  PullRequestsResult,
  ReadyForReviewResult,
  PullRequestStateResult,
  UpdatePullCheckResult,
  SubmitPullRequestReviewPayload,
  SubmitPullRequestReviewResult,
  IssueSummary,
  IssuesResult,
  OrganizationMember,
  OrganizationSummary,
  OrganizationTeamsResult,
  OrganizationResult,
  OrganizationsResult,
  OrganizationPeopleResult,
  OrganizationRepositoriesResult,
  RecoveryErrors,
  RecoveryRequestResult,
  RecoveryResetResult,
  RegisterErrors,
  RegisterPayload,
  RegisterResult,
  RemoveTeamMemberResult,
  RepoAccessErrors,
  RepoAccessListResult,
  RepoSummary,
  RepositoryBranchInfo,
  RepositoryBranchesResult,
  RepositoryCommit,
  RepositoryCodeSearchHit,
  RepositoryCodeSearchResult,
  RepositoryCommitDetail,
  RepositoryCommitDetailResult,
  RepositoryCommitsResult,
  RepositoryCompareResult,
  RepositoryDiffFile,
  RepositoryRevisionRef,
  RepositoryContentsResult,
  RepositoryFileCommit,
  RepositoryFileEntry,
  RepositoryFileResult,
  RepositoryOverview,
  RepositoryResult,
  RepositoryTreeEntry,
  RepositoryTreeResult,
  RemoveOrganizationMemberResult,
  RepositorySearchResult,
  RepositorySummary,
  SearchRepository,
  SessionResult,
  SignInResult,
  TeamCore,
  TeamDetail,
  TeamDetailResult,
  TeamMembersResult,
  TeamSummary,
  UpdateRepoAccessResult,
  UpdateRepositoryDefaultBranchResult,
  UpdateRepositoryVisibilityErrors,
  UpdateRepositoryVisibilityPayload,
  UpdateRepositoryVisibilityResult,
  UpdateTeamParentPayload,
  UpdateTeamParentResult,
  UserRepositoriesResult,
} from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface ErrorBody {
  errors?: Record<string, string>;
  message?: string;
  error?: string;
  username?: string;
  email?: string;
  emailVerified?: boolean;
  ok?: boolean;
}

async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

function errorsFrom(body: ErrorBody): Record<string, string> {
  return body.errors ?? {};
}

export async function apiRegister(payload: RegisterPayload): Promise<RegisterResult> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await parseJson<ErrorBody>(res);
  if (res.ok) {
    return {
      ok: true,
      username: String(body.username ?? ''),
      email: String(body.email ?? ''),
      emailVerified: body.emailVerified === true,
    };
  }
  return { ok: false, errors: errorsFrom(body) as RegisterErrors };
}

export async function apiSignIn(payload: {
  identifier: string;
  password: string;
}): Promise<SignInResult> {
  const res = await fetch('/api/auth/signin', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await parseJson<ErrorBody>(res);
  if (res.ok) {
    return { ok: true, username: String(body.username ?? ''), email: String(body.email ?? '') };
  }
  return { ok: false, message: body.message ?? 'Invalid credentials' };
}

export async function apiSession(): Promise<SessionResult> {
  const res = await fetch('/api/auth/session');
  return parseJson<SessionResult>(res);
}

export async function apiSignOut(): Promise<void> {
  await fetch('/api/auth/signout', { method: 'POST', headers: JSON_HEADERS });
}

export async function apiRecoveryRequest(payload: { email: string }): Promise<RecoveryRequestResult> {
  const res = await fetch('/api/auth/recovery/request', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  return parseJson<RecoveryRequestResult>(res);
}

export async function apiRecoveryReset(payload: {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<RecoveryResetResult> {
  const res = await fetch('/api/auth/recovery/reset', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await parseJson<ErrorBody>(res);
  if (res.ok) {
    return { ok: true, message: body.message ?? 'Password updated' };
  }
  return { ok: false, errors: errorsFrom(body) as RecoveryErrors };
}

export async function apiChangePassword(
  payload: ChangePasswordPayload
): Promise<ChangePasswordResult> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await parseJson<ErrorBody>(res);
  if (res.ok) {
    return { ok: true, message: body.message ?? 'Password updated' };
  }
  return { ok: false, errors: errorsFrom(body) as ChangePasswordErrors };
}

// ---- REQ-2-1 organizations and repositories ----

interface OrganizationsBody {
  organizations?: OrganizationSummary[];
}

interface OrganizationBody {
  organization?: OrganizationSummary;
  role?: string | null;
}

interface TeamBody {
  team?: TeamCore;
}

interface TeamDetailBody {
  team?: TeamDetail;
}

interface TeamMembersBody {
  members?: { username: string }[];
}

interface OrganizationRepositoriesBody {
  repositories?: RepoSummary[];
}

interface OrganizationPeopleBody {
  members?: OrganizationMember[];
}

interface AddOrganizationMemberBody {
  member?: { username: string; role: 'owner' | 'member' };
}

interface OrganizationTeamsBody {
  teams?: TeamSummary[];
}

interface RepositoryBody {
  repository?: RepositoryOverview;
}

interface RepositoryListBody {
  repositories?: RepositorySummary[];
}

interface RepositoryContentsBody {
  branch?: RepositoryBranchInfo | null;
  files?: RepositoryFileEntry[];
  entries?: RepositoryTreeEntry[];
}

interface RepositoryCommitsBody {
  branch?: RepositoryBranchInfo | null;
  commits?: RepositoryCommit[];
}

interface RepositoryCommitDetailBody {
  commit?: RepositoryCommitDetail;
}

interface RepositoryCompareBody {
  base?: RepositoryRevisionRef | null;
  compare?: RepositoryRevisionRef;
  files?: RepositoryDiffFile[];
  additions?: number;
  deletions?: number;
}

interface RepositoryTreeBody {
  branch?: RepositoryBranchInfo | null;
  path?: string;
  entries?: RepositoryTreeEntry[];
  role?: string | null;
}

interface RepositoryBranchesBody {
  defaultBranch?: string;
  canCreate?: boolean;
  branches?: RepositoryBranchInfo[];
}

interface RepositoryFileBody {
  branch?: string;
  file?: RepositoryFileEntry;
  commit?: RepositoryFileCommit | null;
  role?: string | null;
}

interface RepositoryIssuesBody {
  issues?: IssueSummary[];
  labels?: string[];
  /** REQ-5-2-1: the signed-in caller's effective repository role (the Issues page gates its “New issue” link on it). */
  role?: string | null;
}

interface RepositoryIssueBody {
  issue?: IssueDetail;
  /** REQ-5-2-2: the detail response carries the caller's effective repository role so the detail page can gate its edit controls. */
  role?: string | null;
}

/** REQ-5-2-1: error payload of a rejected issue creation. */
interface RepositoryIssueErrorsBody {
  errors?: CreateIssueErrors;
}

interface RepoAccessBody {
  grants?: import('./types').RepoAccessGrant[];
}

function statusMessage(body: ErrorBody, fallback: string): string {
  return body.error ?? body.message ?? fallback;
}

export async function apiOrganizations(): Promise<OrganizationsResult> {
  const res = await fetch('/api/organizations');
  const body = await parseJson<OrganizationsBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, organizations: body.organizations ?? [] };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'Authentication required') };
}

export async function apiCreateOrganization(
  payload: CreateOrganizationPayload
): Promise<CreateOrganizationResult> {
  const res = await fetch('/api/organizations', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await parseJson<OrganizationBody & ErrorBody>(res);
  if (res.ok && body.organization) {
    return { ok: true, organization: body.organization };
  }
  return { ok: false, errors: errorsFrom(body) as CreateOrganizationErrors };
}

export async function apiOrganization(name: string): Promise<OrganizationResult> {
  const res = await fetch(`/api/organizations/${encodeURIComponent(name)}`);
  const body = await parseJson<OrganizationBody & ErrorBody>(res);
  if (res.ok && body.organization) {
    return { ok: true, organization: body.organization, role: body.role ?? null };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'Organization not found') };
}

export async function apiOrganizationRepositories(name: string): Promise<OrganizationRepositoriesResult> {
  const res = await fetch(`/api/organizations/${encodeURIComponent(name)}/repositories`);
  const body = await parseJson<OrganizationRepositoriesBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, repositories: body.repositories ?? [] };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'Organization not found') };
}

export async function apiOrganizationPeople(name: string): Promise<OrganizationPeopleResult> {
  const res = await fetch(`/api/organizations/${encodeURIComponent(name)}/people`);
  const body = await parseJson<OrganizationPeopleBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, members: body.members ?? [] };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'Organization not found') };
}

/**
 * REQ-2-2-3: an organization Owner directly adds an existing account (by
 * username or verified email) as Member or Owner on the People page. The
 * membership relationship is stored atomically; failures keep the form open
 * with the field errors so the identifier can be corrected and resubmitted.
 */
export async function apiAddOrganizationMember(
  name: string,
  payload: AddOrganizationMemberPayload
): Promise<AddOrganizationMemberResult> {
  const res = await fetch(`/api/organizations/${encodeURIComponent(name)}/people`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await parseJson<AddOrganizationMemberBody & ErrorBody>(res);
  if (res.ok && body.member) {
    return { ok: true, member: body.member };
  }
  return { ok: false, errors: errorsFrom(body) as AddOrganizationMemberErrors };
}

export async function apiOrganizationTeams(name: string): Promise<OrganizationTeamsResult> {
  const res = await fetch(`/api/organizations/${encodeURIComponent(name)}/teams`);
  const body = await parseJson<OrganizationTeamsBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, teams: body.teams ?? [] };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'Organization not found') };
}

export async function apiRepository(owner: string, name: string): Promise<RepositoryResult> {
  const res = await fetch(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  const body = await parseJson<RepositoryBody & ErrorBody>(res);
  if (res.ok && body.repository) {
    return { ok: true, repository: body.repository };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'Repository not found') };
}

// ---- REQ-3-2-1 repository creation and content ----

/**
 * REQ-3-2-1: creates a repository in a personal or organization namespace.
 * The server verifies namespace permission, name uniqueness and visibility;
 * initialization atomically stores the initial branch, README file, and
 * initial commit. Field errors are shown next to the corresponding input and
 * rejected attempts leave no repository behind.
 */
export async function apiCreateRepository(
  payload: CreateRepositoryPayload
): Promise<CreateRepositoryResult> {
  const res = await fetch('/api/repositories', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await parseJson<RepositoryBody & ErrorBody>(res);
  if (res.ok && body.repository) {
    return { ok: true, repository: body.repository };
  }
  return { ok: false, errors: errorsFrom(body) as CreateRepositoryErrors };
}

/**
 * REQ-3-2-2: forks a readable source repository into a target personal or
 * organization namespace. The server validates Read-or-higher access on the
 * source, creation permission in the target namespace, name uniqueness, and
 * the visibility rule (a private source can only be forked as Private). The
 * fork records the source-repository link and a copy of the accessible
 * default-branch history; a rejected request leaves no fork behind.
 */
export async function apiForkRepository(
  sourceOwner: string,
  sourceName: string,
  payload: ForkRepositoryPayload
): Promise<ForkRepositoryResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(sourceOwner)}/${encodeURIComponent(sourceName)}/forks`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<RepositoryBody & ErrorBody>(res);
  if (res.ok && body.repository) {
    return { ok: true, repository: body.repository };
  }
  return { ok: false, errors: errorsFrom(body) as ForkRepositoryErrors };
}

/**
 * REQ-3-2-1: lists the personal (user-owned) repositories of a username that
 * are visible to the signed-in caller; the server filters by visibility.
 */
export async function apiUserRepositories(username: string): Promise<UserRepositoriesResult> {
  const res = await fetch(`/api/repositories?owner=${encodeURIComponent(username)}`);
  const body = await parseJson<RepositoryListBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, repositories: body.repositories ?? [] };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'User not found') };
}

/**
 * REQ-3-2-1/REQ-4-1: files (and REQ-4-1 top-level entries with exact names)
 * reachable at a branch head of a repository. Without a branch argument the
 * default branch is used (used by the overview page); passing a branch reads
 * that branch's root listing.
 */
export async function apiRepositoryContents(
  owner: string,
  name: string,
  branch?: string
): Promise<RepositoryContentsResult> {
  const query =
    branch && branch.trim() !== '' ? `?branch=${encodeURIComponent(branch)}` : '';
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents${query}`
  );
  const body = await parseJson<RepositoryContentsBody & ErrorBody>(res);
  if (res.ok) {
    return {
      ok: true,
      branch: body.branch ?? null,
      files: body.files ?? [],
      entries: body.entries ?? [],
    };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Repository not found'),
  };
}

/**
 * REQ-3-2-1/REQ-4-2-1: commit history of a branch (the default branch unless
 * `branch` is given) or of a single file path on that branch (when `path` is
 * given), newest first. Each record carries the short hash, message, author,
 * time, parent references, and changed file paths.
 */
export async function apiRepositoryCommits(
  owner: string,
  name: string,
  branch?: string,
  path?: string
): Promise<RepositoryCommitsResult> {
  const params = new URLSearchParams();
  if (branch && branch.trim() !== '') {
    params.set('branch', branch);
  }
  if (path && path.trim() !== '') {
    params.set('path', path);
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits${query}`
  );
  const body = await parseJson<RepositoryCommitsBody & ErrorBody>(res);
  if (res.ok) {
    return {
      ok: true,
      branch: body.branch ?? null,
      commits: body.commits ?? [],
    };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Repository not found'),
  };
}

/**
 * REQ-4-2-1: commit detail of a repository. The payload includes the parent
 * revision references and the changed files (path + content) so the commit
 * page can display the corresponding parent revision and changed files.
 */
export async function apiRepositoryCommitDetail(
  owner: string,
  name: string,
  commitId: string
): Promise<RepositoryCommitDetailResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(commitId)}`
  );
  const body = await parseJson<RepositoryCommitDetailBody & ErrorBody>(res);
  if (res.ok && body.commit) {
    return { ok: true, commit: body.commit };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Commit not found'),
  };
}

/**
 * REQ-4-2-2: read-only diff of two readable commits of a repository (base is
 * the earlier/target revision, compare the newer one; an omitted base means
 * the empty tree, e.g. the root commit's diff). The server returns the base
 * and compare identifiers, only the changed files with per-file added/deleted
 * line counts and the line-by-line diff, plus the aggregate numbers.
 */
export async function apiRepositoryCompare(
  owner: string,
  name: string,
  base: string,
  compare: string
): Promise<RepositoryCompareResult> {
  const params = new URLSearchParams();
  if (base && base.trim() !== '') {
    params.set('base', base);
  }
  params.set('compare', compare);
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare?${params.toString()}`
  );
  const body = await parseJson<RepositoryCompareBody & ErrorBody>(res);
  if (res.ok && body.compare) {
    return {
      ok: true,
      base: body.base ?? null,
      compare: body.compare,
      files: body.files ?? [],
      additions: body.additions ?? 0,
      deletions: body.deletions ?? 0,
    };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Commit not found'),
  };
}

/**
 * REQ-3-2-1/REQ-4-1: single file content at a branch head (the file-content
 * page). REQ-4-1: the response also carries the most recent commit of the
 * file on that branch so the page can display it.
 */
export async function apiRepositoryFile(
  owner: string,
  name: string,
  branch: string,
  path: string
): Promise<RepositoryFileResult> {
  const pathPart = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodeURIComponent(branch)}/${pathPart}`
  );
  const body = await parseJson<RepositoryFileBody & ErrorBody>(res);
  if (res.ok && body.file) {
    return {
      ok: true,
      branch: body.branch ?? branch,
      file: body.file,
      commit: body.commit ?? null,
      role: body.role ?? null,
    };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'File not found'),
  };
}

/**
 * REQ-5-1-1: every issue row of the current repository under the same
 * repository-view rule as the overview (public repositories are open,
 * private repositories require an effective role). The response carries the
 * issue rows (number, title, state, author, labels, milestone, body, update
 * time) and the repository's label names (the label-filter options). The
 * request is read-only; the list page filters rows locally as the user
 * types / selects.
 */
export async function apiRepositoryIssues(
  owner: string,
  name: string
): Promise<IssuesResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`
  );
  const body = await parseJson<RepositoryIssuesBody & ErrorBody>(res);
  if (res.ok) {
    return {
      ok: true,
      issues: body.issues ?? [],
      labels: body.labels ?? [],
      role: body.role ?? null,
    };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Repository not found'),
  };
}

/**
 * REQ-5-2-1: submits a repository issue creation (Title + optional
 * Description). Only Write, Maintain, Admin, or organization Owner may
 * submit; the server trims and validates the fields, assigns the next
 * repository-scoped number, and persists the issue plus its creation
 * activity in one atomic write. On success the page opens the new issue by
 * its returned number; rejected or failed submissions (insufficient
 * permission, blank/over-long fields, persistence failure) create neither an
 * issue nor a number.
 */
export async function apiCreateIssue(
  owner: string,
  name: string,
  payload: CreateIssuePayload
): Promise<CreateIssueResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<RepositoryIssueBody & RepositoryIssueErrorsBody & ErrorBody>(
    res
  );
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue };
  }
  return {
    ok: false,
    status: res.status,
    errors: body.errors ?? undefined,
    message: statusMessage(body, 'The issue could not be saved'),
  };
}

/**
 * REQ-5-1-1: the detail record of one persisted issue number in the current
 * repository (the same record the list page displays). An unknown number is
 * a 404 so the detail page can show that the issue does not exist.
 */
export async function apiRepositoryIssue(
  owner: string,
  name: string,
  number: number
): Promise<IssueDetailResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Issue not found'),
  };
}

/**
 * REQ-5-2-2: edits the title and/or description of one persisted issue. Only
 * Write, Maintain, Admin, or organization Owner may submit (Read and Triage
 * only view; the server rejects their submissions). Saving the title and
 * saving the description are separate actions: the payload carries only the
 * changed field. The server trims and validates a provided title (1–256
 * non-empty characters) and a provided description (≤65536 characters) and
 * persists the new value together with an `edited` activity record in one
 * atomic write; on success the returned detail carries the updated fields and
 * timeline. Rejected submissions (insufficient permission, empty/over-long
 * input, persistence failure) change nothing.
 */
export async function apiEditIssue(
  owner: string,
  name: string,
  number: number,
  payload: IssueEditPayload
): Promise<IssueEditResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<RepositoryIssueBody & RepositoryIssueErrorsBody & ErrorBody>(
    res
  );
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue };
  }
  return {
    ok: false,
    status: res.status,
    errors: body.errors ?? undefined,
    message: statusMessage(body, 'The issue could not be saved'),
  };
}

/**
 * REQ-5-2-3: appends a discussion comment to an issue. Only a signed-in
 * user with Write, Maintain, or Admin may submit (Read and Triage only
 * view; the server rejects their submissions). The server trims and
 * validates the text (1–65536 non-empty characters; a blank/whitespace-only
 * comment reports “Comment is required”) and persists the comment together
 * with its `commented` activity record in one atomic write; on success the
 * returned detail carries the appended comment and timeline entry. Rejected
 * submissions (insufficient permission, blank/over-long input, persistence
 * failure) append no comment and no timeline record.
 */
export async function apiAddIssueComment(
  owner: string,
  name: string,
  number: number,
  body: string
): Promise<IssueCommentResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/comments`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body } satisfies IssueCommentPayload),
    }
  );
  const bodyJson = await parseJson<RepositoryIssueBody & RepositoryIssueErrorsBody & ErrorBody>(
    res
  );
  if (res.ok && bodyJson.issue) {
    return { ok: true, issue: bodyJson.issue, role: bodyJson.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    errors: (bodyJson.errors ?? undefined) as IssueCommentErrors | undefined,
    message: statusMessage(bodyJson, 'The comment could not be saved'),
  };
}

/**
 * REQ-5-2-3: toggles a reaction on the issue itself. Any signed-in user who
 * can view the issue may add or remove their own reaction: for the same
 * user, target, and reaction only one association is stored, and selecting
 * it a second time removes it. On success the returned detail carries the
 * updated reaction groups.
 */
export async function apiToggleIssueReaction(
  owner: string,
  name: string,
  number: number,
  reaction: string
): Promise<IssueReactionResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/reactions`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ reaction }),
    }
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The reaction could not be saved'),
  };
}

/**
 * REQ-5-2-3: toggles a reaction on one of the issue's comments (same
 * toggle semantics as the issue reaction). An unknown comment identifier is
 * a 404 so the page keeps the previously loaded discussion unchanged.
 */
export async function apiToggleCommentReaction(
  owner: string,
  name: string,
  number: number,
  commentId: string,
  reaction: string
): Promise<IssueReactionResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/comments/${encodeURIComponent(commentId)}/reactions`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ reaction }),
    }
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The reaction could not be saved'),
  };
}

/**
 * REQ-4-4: submits one file-path + content change with a commit message on
 * the current branch. Only Write, Maintain, Admin, or organization Owner may
 * submit; the server validates the path and message rules and rejects a
 * protected branch or a persistence failure, leaving the file, branch head,
 * and commit history unchanged. A successful submission returns the new
 * commit and the written file so the page can open the saved view.
 */
export async function apiWriteRepositoryFile(
  owner: string,
  name: string,
  payload: FileWritePayload
): Promise<FileWriteResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<
    ErrorBody & {
      branch?: { name: string; headCommitId: string };
      commit?: RepositoryCommit;
      file?: RepositoryFileEntry;
    }
  >(res);
  if (res.ok && body.commit && body.file) {
    return {
      ok: true,
      branch: body.branch ?? { name: payload.branch, headCommitId: body.commit.id },
      commit: body.commit,
      file: body.file,
    };
  }
  const errors = (body.errors ?? {}) as FileWriteErrors;
  return {
    ok: false,
    status: res.status,
    message:
      errors.path ??
      errors.message ??
      errors.branch ??
      body.error ??
      statusMessage(body, 'The file could not be saved'),
    errors,
  };
}

/**
 * REQ-4-1: directory listing of a branch path ('' for the branch root). The
 * entries carry exact names and types so the directory page can render links
 * whose accessible names are the entry names.
 */
export async function apiRepositoryTree(
  owner: string,
  name: string,
  branch: string,
  path: string
): Promise<RepositoryTreeResult> {
  const pathPart =
    path === ''
      ? ''
      : `/${path
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')}`;
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree/${encodeURIComponent(branch)}${pathPart}`
  );
  const body = await parseJson<RepositoryTreeBody & ErrorBody>(res);
  if (res.ok && body.branch) {
    return {
      ok: true,
      branch: body.branch,
      path: body.path ?? '',
      entries: body.entries ?? [],
      role: body.role ?? null,
    };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Path not found'),
  };
}

/**
 * REQ-4-3-1: the branch list of a repository used by the Code page branch
 * selector. Read permission follows the same rule as the file browser
 * (public repositories are open, private repositories require an effective
 * role); the default branch is returned first and the branch names are the
 * exact stored names. REQ-4-3-2: `canCreate` is derived server-side from the
 * session's effective repository role (Write/Maintain/Admin/organization
 * Owner), so the selector can gate the create entry without trusting the
 * client's role.
 */
export async function apiRepositoryBranches(
  owner: string,
  name: string
): Promise<RepositoryBranchesResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`
  );
  const body = await parseJson<RepositoryBranchesBody & ErrorBody>(res);
  if (res.ok) {
    return {
      ok: true,
      defaultBranch: body.defaultBranch ?? '',
      canCreate: body.canCreate === true,
      branches: body.branches ?? [],
    };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Repository not found'),
  };
}

/**
 * REQ-4-3-2: creates a branch at the head of the given base branch. Only a
 * signed-in user with Write, Maintain, Admin, or organization Owner status is
 * authorized; the server validates the name rules, rejects duplicates, and
 * stores the new reference atomically. Field errors ("Invalid branch",
 * "Branch already exists", "Base branch not found") are returned as
 * per-field errors so the selector can render them next to the create entry.
 */
export async function apiCreateBranch(
  owner: string,
  name: string,
  payload: CreateBranchPayload
): Promise<CreateBranchResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<
    ErrorBody & { branch?: RepositoryBranchInfo }
  >(res);
  if (res.ok && body.branch) {
    return { ok: true, branch: body.branch };
  }
  const errors = (body.errors ?? {}) as CreateBranchErrors;
  const message =
    errors.name ??
    errors.base ??
    body.error ??
    statusMessage(body, 'Branch could not be created');
  return { ok: false, status: res.status, message, errors };
}

// ---- REQ-2-2 organization teams ----

/**
 * REQ-2-2-1: creates a team inside an organization. Only an organization
 * Owner is authorized; the server rejects missing/malformed/duplicate names
 * and parents outside the organization.
 */
export async function apiCreateTeam(
  orgName: string,
  payload: CreateTeamPayload
): Promise<CreateTeamResult> {
  const res = await fetch(`/api/organizations/${encodeURIComponent(orgName)}/teams`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await parseJson<TeamBody & ErrorBody>(res);
  if (res.ok && body.team) {
    return { ok: true, team: body.team };
  }
  return { ok: false, errors: errorsFrom(body) as CreateTeamErrors };
}

export async function apiTeam(orgName: string, teamName: string): Promise<TeamDetailResult> {
  const res = await fetch(
    `/api/organizations/${encodeURIComponent(orgName)}/teams/${encodeURIComponent(teamName)}`
  );
  const body = await parseJson<TeamDetailBody & ErrorBody>(res);
  if (res.ok && body.team) {
    return { ok: true, team: body.team };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'Team not found') };
}

export async function apiTeamMembers(orgName: string, teamName: string): Promise<TeamMembersResult> {
  const res = await fetch(
    `/api/organizations/${encodeURIComponent(orgName)}/teams/${encodeURIComponent(teamName)}/members`
  );
  const body = await parseJson<TeamMembersBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, members: body.members ?? [] };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'Team not found') };
}

export async function apiUpdateTeamParent(
  orgName: string,
  teamName: string,
  payload: UpdateTeamParentPayload
): Promise<UpdateTeamParentResult> {
  const res = await fetch(
    `/api/organizations/${encodeURIComponent(orgName)}/teams/${encodeURIComponent(teamName)}`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<TeamBody & ErrorBody>(res);
  if (res.ok && body.team) {
    return { ok: true, team: body.team };
  }
  return { ok: false, errors: errorsFrom(body) as CreateTeamErrors };
}

// ---- REQ-2-2-2 team members ----

interface AddTeamMemberBody {
  member?: { username: string };
}

/**
 * REQ-2-2-2: an organization Owner adds a current organization member to a
 * team on the team's Members tab. Non-members of the organization are
 * rejected with a field error on the server.
 */
export async function apiAddTeamMember(
  orgName: string,
  teamName: string,
  username: string
): Promise<AddTeamMemberResult> {
  const res = await fetch(
    `/api/organizations/${encodeURIComponent(orgName)}/teams/${encodeURIComponent(teamName)}/members`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username }),
    }
  );
  const body = await parseJson<AddTeamMemberBody & ErrorBody>(res);
  if (res.ok && body.member) {
    return { ok: true, member: body.member };
  }
  return { ok: false, errors: errorsFrom(body) as AddTeamMemberErrors };
}

/**
 * REQ-2-2-2: an organization Owner removes a direct team member immediately
 * (no confirmation step). Only this team's membership relationship is removed.
 */
export async function apiRemoveTeamMember(
  orgName: string,
  teamName: string,
  username: string
): Promise<RemoveTeamMemberResult> {
  const res = await fetch(
    `/api/organizations/${encodeURIComponent(orgName)}/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(username)}`,
    { method: 'DELETE' }
  );
  const body = await parseJson<ErrorBody>(res);
  if (res.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    status: res.status,
    message: body.error ?? body.message ?? 'Request failed',
  };
}

/**
 * REQ-2-2-4: an organization Owner removes a member from the organization
 * via the member action menu and the confirmation dialog. The server
 * atomically deletes the membership, the account's team memberships in this
 * organization, and its direct grants on the organization's repositories;
 * the last Owner cannot be removed and a non-Owner is rejected with
 * "Access denied".
 */
export async function apiRemoveOrganizationMember(
  orgName: string,
  username: string
): Promise<RemoveOrganizationMemberResult> {
  const res = await fetch(
    `/api/organizations/${encodeURIComponent(orgName)}/people/${encodeURIComponent(username)}`,
    { method: 'DELETE' }
  );
  const body = await parseJson<ErrorBody>(res);
  if (res.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    status: res.status,
    message: body.error ?? body.message ?? 'Request failed',
  };
}

interface RepositorySearchBody {
  repositories?: SearchRepository[];
}

// ---- REQ-3-1 global repository search ----

/**
 * REQ-3-1: global repository search. The server filters results by the
 * caller's session: visitors see only public repositories, signed-in accounts
 * see every repository they are authorized to view. An empty query returns no
 * results.
 */
export async function apiSearchRepositories(query: string): Promise<RepositorySearchResult> {
  const res = await fetch(`/api/search/repositories?q=${encodeURIComponent(query)}`);
  const body = await parseJson<RepositorySearchBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, repositories: body.repositories ?? [] };
  }
  return { ok: false, status: res.status, message: statusMessage(body, 'Search failed') };
}

interface RepositoryCodeSearchBody {
  repository?: { owner: string; name: string };
  branch?: RepositoryBranchInfo | null;
  query?: string;
  path?: string;
  language?: string;
  languages?: string[];
  results?: RepositoryCodeSearchHit[];
}

/**
 * REQ-4-2-3: repository-scoped code search. The server searches only the file
 * content of the current repository (its default branch snapshot) under the
 * same access rule as the Code page, so results never leak across
 * repositories. An optional path prefix and language restrict the hits; the
 * search is read-only. Each hit carries the exact file name, full path, line
 * number, matching snippet, and branch context.
 */
export async function apiRepositoryCodeSearch(
  owner: string,
  name: string,
  params: { q: string; path?: string; lang?: string }
): Promise<RepositoryCodeSearchResult> {
  const search = new URLSearchParams();
  if (params.q && params.q.trim() !== '') {
    search.set('q', params.q);
  }
  if (params.path && params.path.trim() !== '') {
    search.set('path', params.path);
  }
  if (params.lang && params.lang.trim() !== '') {
    search.set('lang', params.lang);
  }
  const query = search.toString();
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/search${query ? `?${query}` : ''}`
  );
  const body = await parseJson<RepositoryCodeSearchBody & ErrorBody>(res);
  if (res.ok) {
    return {
      ok: true,
      repository: body.repository ?? { owner, name },
      branch: body.branch ?? null,
      query: body.query ?? '',
      path: body.path ?? '',
      language: body.language ?? '',
      languages: body.languages ?? [],
      results: body.results ?? [],
    };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Repository not found'),
  };
}

/**
 * REQ-2-3: lists the authorization grants of a repository. Only an
 * organization Owner or repository Admin is allowed; the server rejects
 * everyone else with "Access denied".
 */
export async function apiRepoAccess(
  owner: string,
  name: string
): Promise<RepoAccessListResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/access`
  );
  const body = await parseJson<RepoAccessBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, grants: body.grants ?? [] };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Repository not found'),
  };
}

/**
 * REQ-2-3: grants (or replaces) a repository role for an organization member
 * or team. Exactly one direct role grant per subject+repository is stored;
 * saving the same role again updates the existing record.
 */
export async function apiGrantRepoAccess(
  owner: string,
  name: string,
  payload: GrantRepoAccessPayload
): Promise<GrantRepoAccessResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/access`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<RepoAccessBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, grants: body.grants ?? [] };
  }
  return { ok: false, errors: errorsFrom(body) as RepoAccessErrors };
}

/**
 * REQ-3-4: a repository Admin changes a repository's visibility. The server
 * rejects non-Admins and a confirmation text that does not match the
 * repository name; a successful change is persisted and immediately enforced
 * by every read path (overview, search, lists, direct links).
 */
export async function apiUpdateRepositoryVisibility(
  owner: string,
  name: string,
  payload: UpdateRepositoryVisibilityPayload
): Promise<UpdateRepositoryVisibilityResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/visibility`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<RepositoryBody & ErrorBody>(res);
  if (res.ok && body.repository) {
    return { ok: true, repository: body.repository };
  }
  return {
    ok: false,
    errors: errorsFrom(body) as UpdateRepositoryVisibilityErrors,
  };
}

/**
 * REQ-4-3-3: a repository Admin or organization Owner changes the default
 * branch of a repository. The server validates the role, requires an existing
 * branch of the repository, and stores the new default branch together with
 * the operator and time in one atomic write; the previous default branch and
 * every branch's commits are never deleted or rewritten. Rejected requests
 * (401 unauthenticated, 403 non-Admin, 400 unknown branch) leave the saved
 * default branch unchanged.
 */
export async function apiUpdateRepositoryDefaultBranch(
  owner: string,
  name: string,
  branch: string
): Promise<UpdateRepositoryDefaultBranchResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/default-branch`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ branch }),
    }
  );
  const body = await parseJson<RepositoryBody & ErrorBody>(res);
  if (res.ok && body.repository) {
    return { ok: true, repository: body.repository };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The default branch could not be updated'),
  };
}

/**
 * REQ-2-3: an existing grant row's Save button replaces the stored role;
 * only one authorization record is retained for the subject.
 */
export async function apiUpdateRepoAccess(
  owner: string,
  name: string,
  subjectType: 'user' | 'team',
  subjectName: string,
  role: GrantRepoAccessPayload['role']
): Promise<UpdateRepoAccessResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/access/${subjectType}/${encodeURIComponent(subjectName)}`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ role }),
    }
  );
  const body = await parseJson<RepoAccessBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, grants: body.grants ?? [] };
  }
  return {
    ok: false,
    status: res.status,
    errors: errorsFrom(body) as RepoAccessErrors,
    message: statusMessage(body, 'Request failed'),
  };
}

/**
 * REQ-5-3-1: the assignable-member options of one issue. Only a signed-in
 * user with Triage, Maintain, or Admin receives the list (Read/Write/visitors
 * are rejected by the server); the returned usernames are exactly the
 * accounts with an effective repository role of at least Triage, so
 * non-assignable users never appear in the search results.
 */
export async function apiIssueAssigneeOptions(
  owner: string,
  name: string,
  number: number
): Promise<IssueAssigneeOptionsResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/assignees`
  );
  const body = await parseJson<ErrorBody & { assignable?: string[] }>(res);
  if (res.ok) {
    return { ok: true, assignable: body.assignable ?? [] };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Assignees could not be loaded'),
  };
}

/**
 * REQ-5-3-1: assigns one participant to an issue. Only a signed-in user with
 * Triage, Maintain, or Admin is authorized; the server stores the
 * issue-account relationship, the operator, and the time together with an
 * `assigned` activity record in one atomic write. Assigning an
 * already-assigned account is a no-op. On success the returned detail carries
 * the updated Assignees metadata and the appended timeline record.
 */
export async function apiAssignIssue(
  owner: string,
  name: string,
  number: number,
  username: string
): Promise<IssueAssigneeResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/assignees/${encodeURIComponent(username)}`,
    {
      method: 'PUT',
      headers: JSON_HEADERS,
    }
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The assignment could not be saved'),
  };
}

/**
 * REQ-5-3-1: removes the issue-account assignment. Only the issue
 * relationship is deleted — the member account and its repository grant stay
 * untouched — together with an `unassigned` activity record in one atomic
 * write. Unassigning an account that is not assigned is a no-op. On success
 * the returned detail carries the updated Assignees metadata and the appended
 * timeline record.
 */
export async function apiUnassignIssue(
  owner: string,
  name: string,
  number: number,
  username: string
): Promise<IssueAssigneeResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/assignees/${encodeURIComponent(username)}`,
    {
      method: 'DELETE',
      headers: JSON_HEADERS,
    }
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The assignment could not be saved'),
  };
}

/**
 * REQ-5-3-2: the label options of one issue — the exact names of the current
 * repository's pre-existing labels. Only a signed-in user with Triage,
 * Maintain, or Admin receives the list (Read/Write/visitors are rejected by
 * the server); the list is repository-scoped so labels stored for any other
 * repository never appear. The selector combines these options with the
 * issue's current labels to render the checked state.
 */
export async function apiIssueLabelOptions(
  owner: string,
  name: string,
  number: number
): Promise<IssueLabelOptionsResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/labels`
  );
  const body = await parseJson<ErrorBody & { labels?: string[] }>(res);
  if (res.ok) {
    return { ok: true, labels: body.labels ?? [] };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Labels could not be loaded'),
  };
}

/**
 * REQ-5-3-2: applies one existing repository label to an issue. Only a
 * signed-in user with Triage, Maintain, or Admin is authorized; the server
 * resolves the label in the current repository only (it never creates a
 * label and never associates a label from another repository) and stores the
 * issue-label relationship, the operator, and the time together with a
 * `labeled` activity record in one atomic write. Applying an already-applied
 * label is a no-op. On success the returned detail carries the updated Labels
 * metadata and the appended timeline record.
 */
export async function apiAddIssueLabel(
  owner: string,
  name: string,
  number: number,
  labelName: string
): Promise<IssueLabelResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/labels/${encodeURIComponent(labelName)}`,
    {
      method: 'PUT',
      headers: JSON_HEADERS,
    }
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The label could not be saved'),
  };
}

/**
 * REQ-5-3-2: removes the issue-label association. Only the issue
 * relationship is deleted — the label record stays in the repository —
 * together with an `unlabeled` activity record in one atomic write.
 * Removing a label that is not applied is a no-op. On success the returned
 * detail carries the updated Labels metadata and the appended timeline
 * record.
 */
export async function apiRemoveIssueLabel(
  owner: string,
  name: string,
  number: number,
  labelName: string
): Promise<IssueLabelResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/labels/${encodeURIComponent(labelName)}`,
    {
      method: 'DELETE',
      headers: JSON_HEADERS,
    }
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The label could not be saved'),
  };
}

/**
 * REQ-5-3-3: the milestone options of one issue — the exact titles of the
 * current repository's pre-existing milestones. Only a signed-in user with
 * Triage, Maintain, or Admin receives the list (Read/Write/visitors are
 * rejected by the server); the list is repository-scoped so a milestone
 * stored for any other repository never appears. The picker combines these
 * options with the “None” removal option and the issue's current milestone
 * to render the selected state.
 */
export async function apiIssueMilestoneOptions(
  owner: string,
  name: string,
  number: number
): Promise<IssueMilestoneOptionsResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/milestones`
  );
  const body = await parseJson<ErrorBody & { milestones?: string[] }>(res);
  if (res.ok) {
    return { ok: true, milestones: body.milestones ?? [] };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Milestones could not be loaded'),
  };
}

/**
 * REQ-5-3-3: associates an issue with one milestone of the current
 * repository. Only a signed-in user with Triage, Maintain, or Admin is
 * authorized; the server resolves the milestone in the current repository
 * only (it never creates a milestone and never associates a milestone from
 * another repository) and stores the issue-milestone association, the
 * operator, and the time together with a `milestoned` activity record in one
 * atomic write. At most one milestone per work item — selecting a different
 * milestone replaces the previous association. Setting the
 * already-associated milestone is a no-op. On success the returned detail
 * carries the updated Milestone metadata and the appended timeline record.
 */
export async function apiSetIssueMilestone(
  owner: string,
  name: string,
  number: number,
  milestoneTitle: string
): Promise<IssueMilestoneResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/milestones/${encodeURIComponent(milestoneTitle)}`,
    {
      method: 'PUT',
      headers: JSON_HEADERS,
    }
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The milestone could not be saved'),
  };
}

/**
 * REQ-5-3-3: removes the issue-milestone association (the picker's “None”
 * selection). Only the issue association is deleted — the milestone record
 * stays in the repository — together with a `demilestoned` activity record
 * in one atomic write. Clearing an issue that has no milestone is a no-op.
 * On success the returned detail carries the updated Milestone metadata and
 * the appended timeline record.
 */
export async function apiClearIssueMilestone(
  owner: string,
  name: string,
  number: number
): Promise<IssueMilestoneResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/milestones`,
    {
      method: 'DELETE',
      headers: JSON_HEADERS,
    }
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The milestone could not be saved'),
  };
}

/**
 * REQ-5-4: closes or reopens one persisted issue from the detail view. Only
 * a signed-in user with Triage, Maintain, or Admin is authorized; Write and
 * Read users may only view the status (the server rejects their
 * submissions). The server stores the new Open/Closed status together with
 * the operator and the time and appends a `closed`/`reopened` activity
 * record in one atomic write; the transition never modifies the title,
 * description, comments, labels, assignees, or milestone. On success the
 * returned detail carries the updated status and the appended timeline
 * record. Rejected submissions (insufficient permission, invalid state,
 * persistence failure) change nothing.
 */
export async function apiSetIssueState(
  owner: string,
  name: string,
  number: number,
  state: 'open' | 'closed'
): Promise<IssueStateResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/state`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ state }),
    }
  );
  const body = await parseJson<RepositoryIssueBody & ErrorBody>(res);
  if (res.ok && body.issue) {
    return { ok: true, issue: body.issue, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The issue could not be saved'),
  };
}

// ---- REQ-6-1 pull requests and branch protection ----

interface RepositoryPullsBody {
  pulls?: PullRequestSummary[];
  role?: string | null;
}

interface RepositoryPullBody {
  pull?: PullRequestDetail;
  role?: string | null;
}

interface PullRequestCompareBody {
  role?: string | null;
  base?: PullRequestBranchRef;
  compare?: PullRequestBranchRef;
  commitCount?: number;
  commits?: RepositoryCommit[];
  files?: RepositoryDiffFile[];
  additions?: number;
  deletions?: number;
}

interface BranchProtectionBody {
  rules?: BranchProtectionRule[];
}

/**
 * REQ-6-1: the Pull requests list page of a repository (number, title,
 * author, source/target branches, and status). The server applies the same
 * repository-view rule as the overview and returns the caller's effective
 * role for the list page.
 */
export async function apiRepositoryPulls(
  owner: string,
  name: string
): Promise<PullRequestsResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`
  );
  const body = await parseJson<RepositoryPullsBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, pulls: body.pulls ?? [], role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Pull requests could not be loaded'),
  };
}

/**
 * REQ-6-1: the pull request detail page of one repository-scoped number. The
 * payload carries the conversation data, the commits on the compare branch
 * relative to base, the files-changed diff, the Checks area (the `test`
 * status on the current compare commit with its setter and time), and the
 * merge eligibility.
 */
export async function apiRepositoryPull(
  owner: string,
  name: string,
  number: number
): Promise<PullRequestDetailResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Pull request not found'),
  };
}

/**
 * REQ-6-2-2: the read-only PR comparison result of the creation flow. The
 * server resolves both branches by their exact names and returns the
 * comparable commits, the changed files with the per-file diff, and the
 * aggregate additions/deletions based on the commits the branches currently
 * point to. Only a signed-in user with Write, Maintain, Admin, or
 * organization Owner status may compare (the server rejects 401/403); the
 * request never saves a PR, commit, or branch change.
 */
export async function apiPullRequestCompare(
  owner: string,
  name: string,
  base: string,
  compare: string
): Promise<PullRequestBranchCompareResult> {
  const params = new URLSearchParams();
  params.set('base', base);
  params.set('compare', compare);
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/compare?${params.toString()}`
  );
  const body = await parseJson<PullRequestCompareBody & ErrorBody>(res);
  if (res.ok && body.base && body.compare) {
    return {
      ok: true,
      role: body.role ?? null,
      compare: {
        base: body.base,
        compare: body.compare,
        commitCount: body.commitCount ?? 0,
        commits: body.commits ?? [],
        files: body.files ?? [],
        additions: body.additions ?? 0,
        deletions: body.deletions ?? 0,
      },
    };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The branches could not be compared'),
  };
}

/**
 * REQ-6-2-3/REQ-6-2-4: submits a pull-request creation from a valid
 * comparison. Only a signed-in user with Write, Maintain, Admin, or
 * organization Owner status may create; the server re-validates the distinct
 * base/compare branches, the differences (comparable commits and changed
 * files), the duplicate-pair rule (a Draft or Open PR with the same
 * source/target pair blocks creation), and the Title (1–256 non-empty
 * characters after trimming) and optional Description (≤65536 characters)
 * rules, then persists the PR with its creation activity in one atomic
 * write. `payload.draft === true` stores the PR in Draft state (REQ-6-2-4),
 * otherwise it is created Open. On success the page opens the new PR by its
 * returned repository-scoped number; rejected or failed submissions create
 * neither a PR nor a number.
 */
export async function apiCreatePullRequest(
  owner: string,
  name: string,
  payload: CreatePullRequestPayload
): Promise<CreatePullRequestResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  const errors = (body.errors ?? {}) as CreatePullRequestErrors;
  return {
    ok: false,
    status: res.status,
    message:
      errors.general ??
      Object.values(errors)[0] ??
      body.error ??
      body.message ??
      'The pull request could not be saved',
    errors,
  };
}

/**
 * REQ-6-1: updates the `test` status of a PR's Checks area (only a
 * repository Admin may submit). The server stores the status with the setter
 * and time on the PR's current compare commit; the returned detail carries
 * the updated Checks area and merge eligibility.
 */
export async function apiUpdatePullCheck(
  owner: string,
  name: string,
  number: number,
  status: 'pending' | 'success' | 'failure'
): Promise<UpdatePullCheckResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/checks`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status }),
    }
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  const errors = (body.errors ?? {}) as Record<string, string>;
  return {
    ok: false,
    status: res.status,
    message:
      Object.values(errors)[0] ??
      statusMessage(body, 'The check could not be saved'),
    errors,
  };
}

/**
 * REQ-6-3-3: submits an inline review comment anchored to a changed line of
 * the Files changed view. Only a signed-in user with Write, Maintain, or
 * Admin who is not the PR author may comment on an Open PR; the server
 * validates the file path (must be part of the current diff), the line
 * position (must be an added or deleted line), and the body, then stores the
 * comment with the current compare commit in one atomic write. `pending:
 * true` keeps the comment as a Start-a-review draft that is not public until
 * the review is submitted; otherwise it is published immediately. On success
 * the returned detail carries the updated inline comments (the diff view and
 * Conversation reflect it immediately); rejected or failed submissions
 * create no comment and never display as published.
 */
export async function apiAddPullRequestInlineComment(
  owner: string,
  name: string,
  number: number,
  payload: AddPullRequestInlineCommentPayload
): Promise<AddPullRequestInlineCommentResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/inline-comments`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  const errors = (body.errors ?? {}) as Record<string, string>;
  return {
    ok: false,
    status: res.status,
    message:
      Object.values(errors)[0] ??
      statusMessage(body, 'The comment could not be saved'),
    errors,
  };
}

/**
 * REQ-6-3-4: submits one pull-request review decision (Comment, Approve, or
 * Request changes) with an optional Summary. Only a signed-in user with
 * Write, Maintain, or Admin who is not the PR author may review an Open PR;
 * the server re-checks the role, the author, and the Open status, validates
 * the decision, and stores the review — decision, reviewer, current compare
 * commit, explanation, and time — in one atomic write. A new decision by the
 * same reviewer replaces the reviewer's effective decision for the current
 * compare commit while preserving the old record; Approve without a summary
 * is valid. On success the returned detail carries the updated review
 * summary (Conversation) and review status (merge eligibility); rejected or
 * failed submissions persist nothing and are never displayed as published.
 */
export async function apiSubmitPullRequestReview(
  owner: string,
  name: string,
  number: number,
  payload: SubmitPullRequestReviewPayload
): Promise<SubmitPullRequestReviewResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviews`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  const errors = (body.errors ?? {}) as Record<string, string>;
  return {
    ok: false,
    status: res.status,
    message:
      Object.values(errors)[0] ??
      statusMessage(body, 'The review could not be saved'),
    errors,
  };
}

/**
 * REQ-6-4: the eligible reviewer candidates of one pull request for the
 * Reviewers picker — every account with Write, Maintain, or Admin on the
 * repository who is not the PR author (sorted by username). Only the PR
 * author of an Open or Draft PR, Maintain, Admin, or the organization Owner
 * may load them; the server rejects 401/403 for everyone else. Read-only.
 */
export async function apiPullRequestReviewerOptions(
  owner: string,
  name: string,
  number: number
): Promise<PullRequestReviewerOptionsResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviewers`
  );
  const body = await parseJson<{ eligible?: string[] } & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, eligible: body.eligible ?? [] };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Reviewers could not be loaded'),
  };
}

/**
 * REQ-6-4: requests one reviewer of a pull request, storing the
 * “PR-reviewer request” relationship together with the operator and time in
 * one atomic write. Only the PR author of an Open or Draft PR, Maintain,
 * Admin, or the organization Owner may request; the candidate must have
 * Write, Maintain, or Admin on the repository and must not be the PR
 * author. On success the returned detail carries the updated request set so
 * the Reviewers area shows the username immediately and after reload.
 */
export async function apiRequestPullRequestReviewer(
  owner: string,
  name: string,
  number: number,
  username: string
): Promise<ManagePullRequestReviewerResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviewers/${encodeURIComponent(username)}`,
    {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    }
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  const errors = (body.errors ?? {}) as Record<string, string>;
  return {
    ok: false,
    status: res.status,
    message:
      Object.values(errors)[0] ??
      statusMessage(body, 'The review request could not be saved'),
    errors,
  };
}

/**
 * REQ-6-4: removes one requested reviewer of a pull request immediately
 * (no confirmation step), deleting only the pending-review request
 * relationship. Removing a request never deletes reviews, comments, or
 * activity records already submitted by that reviewer and does not change
 * the reviewer's effective review decision. Only the PR author of an Open
 * or Draft PR, Maintain, Admin, or the organization Owner may remove;
 * on success the returned detail carries the updated request set.
 */
export async function apiRemovePullRequestReviewer(
  owner: string,
  name: string,
  number: number,
  username: string
): Promise<ManagePullRequestReviewerResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/reviewers/${encodeURIComponent(username)}`,
    {
      method: 'DELETE',
      headers: JSON_HEADERS,
    }
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  const errors = (body.errors ?? {}) as Record<string, string>;
  return {
    ok: false,
    status: res.status,
    message:
      Object.values(errors)[0] ??
      statusMessage(body, 'The review request could not be saved'),
    errors,
  };
}

/**
 * REQ-6-5: confirms the merge of an eligible pull request using the sole
 * supported “Create a merge commit” method. The server rereads the target
 * branch head, the current compare commit, the merge-conflict state, and
 * the protection rules at confirmation time; an unsatisfied condition
 * returns the verbatim reasons (e.g. `Review required by branch protection`)
 * and changes neither the target branch nor the PR. On success the returned
 * detail shows Merged with the merger, time, and resulting commit
 * identifier.
 */
export async function apiMergePullRequest(
  owner: string,
  name: string,
  number: number
): Promise<PullRequestMergeResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/merge`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    }
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  const reasons = Array.isArray((body as { reasons?: unknown }).reasons)
    ? ((body as { reasons?: unknown }).reasons as string[])
    : [];
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'The pull request could not be merged'),
    reasons,
  };
}

/**
 * REQ-6-2-4: marks a Draft pull request as ready for review, transitioning
 * the same PR number from Draft to Open and appending a `ready_for_review`
 * activity. Only the PR author, Maintain, Admin, or organization Owner may
 * submit; the server re-checks the role and that the PR is still a Draft,
 * then persists the transition atomically. On success the returned detail
 * shows Open (the Draft marker is gone, title and branches unchanged);
 * rejected calls leave the PR unchanged.
 */
export async function apiPullRequestReadyForReview(  owner: string,
  name: string,
  number: number
): Promise<ReadyForReviewResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/ready-for-review`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    }
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  const errors = (body.errors ?? {}) as Record<string, string>;
  return {
    ok: false,
    status: res.status,
    message:
      Object.values(errors)[0] ??
      statusMessage(body, 'The pull request could not be saved'),
    errors,
  };
}

/**
 * REQ-6-6: closes or reopens one unmerged pull request — “Close pull
 * request” posts `closed`, “Reopen pull request” posts `open`. Only the PR
 * author, Maintain, Admin, or organization Owner may submit; the server
 * re-checks the role and the current status, then persists the transition
 * atomically (the operator and time are stored with the activity record).
 * On success the returned detail shows the new status (Closed after Close,
 * Open after Reopen) and keeps the discussion, reviews, diff, and branch
 * references; rejected calls (viewer without permission, merged PR, invalid
 * state) leave the PR unchanged.
 */
export async function apiPullRequestState(
  owner: string,
  name: string,
  number: number,
  state: 'open' | 'closed'
): Promise<PullRequestStateResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/state`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ state }),
    }
  );
  const body = await parseJson<RepositoryPullBody & ErrorBody>(res);
  if (res.ok && body.pull) {
    return { ok: true, pull: body.pull, role: body.role ?? null };
  }
  const errors = (body.errors ?? {}) as Record<string, string>;
  return {
    ok: false,
    status: res.status,
    message:
      Object.values(errors)[0] ??
      statusMessage(body, 'The pull request could not be saved'),
    errors,
  };
}

/**
 * REQ-6-1: the branch protection rules of a repository (Settings → Branches).
 * Only a repository Admin or organization Owner may read the list; the page
 * gates the controls on the same role.
 */
export async function apiBranchProtectionRules(
  owner: string,
  name: string
): Promise<BranchProtectionRulesResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branch-protection`
  );
  const body = await parseJson<BranchProtectionBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, rules: body.rules ?? [] };
  }
  return {
    ok: false,
    status: res.status,
    message: statusMessage(body, 'Branch protection could not be loaded'),
  };
}

/**
 * REQ-6-1: creates a new branch protection rule bound to one exact branch
 * name with the two independently selectable requirements (the rule form's
 * “Create” action). Only a repository Admin or organization Owner may
 * submit; the server rejects duplicate rules and unknown branches.
 */
export async function apiCreateBranchProtectionRule(
  owner: string,
  name: string,
  payload: BranchProtectionRulePayload
): Promise<SaveBranchProtectionRuleResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branch-protection`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<BranchProtectionBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, rules: body.rules ?? [] };
  }
  const errors = (body.errors ?? {}) as BranchProtectionRuleErrors;
  return {
    ok: false,
    status: res.status,
    message:
      errors.branchName ??
      statusMessage(body, 'The rule could not be saved'),
    errors,
  };
}

/**
 * REQ-6-1: updates an existing branch protection rule (the rule form's
 * “Save changes” action). Only a repository Admin or organization Owner may
 * submit; the server stores the new requirement toggles atomically.
 */
export async function apiUpdateBranchProtectionRule(
  owner: string,
  name: string,
  branchName: string,
  payload: Pick<BranchProtectionRulePayload, 'requireApproval' | 'requireStatusCheck'>
): Promise<SaveBranchProtectionRuleResult> {
  const res = await fetch(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branch-protection/${encodeURIComponent(branchName)}`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }
  );
  const body = await parseJson<BranchProtectionBody & ErrorBody>(res);
  if (res.ok) {
    return { ok: true, rules: body.rules ?? [] };
  }
  const errors = (body.errors ?? {}) as BranchProtectionRuleErrors;
  return {
    ok: false,
    status: res.status,
    message:
      errors.branchName ??
      statusMessage(body, 'The rule could not be saved'),
    errors,
  };
}
