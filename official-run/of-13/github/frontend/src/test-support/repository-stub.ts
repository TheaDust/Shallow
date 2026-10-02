// Repository fixtures for the same-origin API stand-in used by component
// tests: the personal and organization repository records, the name rules, the
// identity payload and the fork copy. The issue fixtures (labels, milestones,
// issues, comments and activity) live in `issue-stub.ts`. These mirror the
// server's observable answers without importing production code.

export interface StubLabel {
  name: string;
  color?: string;
  description?: string;
}

export interface StubMilestone {
  title: string;
  state?: string;
}

/** One stored reaction of a fixture: the reaction type and its account. */
export interface StubReaction {
  reaction: string;
  username: string;
}

/** One stored comment of a fixture issue, with its own reactions. */
export interface StubComment {
  /** Stable identifier; derived from the position when absent. */
  id?: string;
  author: string;
  body: string;
  createdAt: string;
  reactions?: StubReaction[];
}

/** One store of an issue fixture; `labelNames`/`milestone` are repository records. */
export interface StubIssue {
  number: number;
  title: string;
  body?: string;
  state: "open" | "closed";
  author: string;
  assignees?: string[];
  labels?: string[];
  milestone?: string | null;
  createdAt: string;
  updatedAt?: string;
  closedAt?: string | null;
  closedBy?: string | null;
  reactions?: StubReaction[];
  comments?: StubComment[];
  events?: Array<{
    id?: string;
    type: string;
    actor: string;
    createdAt: string;
    data?: Record<string, unknown>;
  }>;
}

export interface StubPullRequestReview {
  reviewer: string;
  decision: "approved" | "changes_requested" | "commented" | string;
  body?: string;
  /** The compare commit the decision belongs to. */
  commitId?: string | null;
  /** A review of an earlier compare commit never counts for the decision. */
  stale?: boolean;
  /** Replaced by a newer decision of the same reviewer on the same commit. */
  superseded?: boolean;
  createdAt?: string;
}

export interface StubPullRequestCheck {
  name: string;
  /** `pending`, `success` or `failure`. */
  status?: string;
  conclusion?: string | null;
  /** The compare commit the check belongs to; defaults to the recorded one. */
  commitSha?: string | null;
  /** The account that stored the result, and when. */
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export interface StubPullRequestComment {
  author: string;
  body: string;
  path?: string | null;
  line?: number | null;
  /** The compare commit the inline comment was anchored to. */
  commitId?: string | null;
  outdated?: boolean;
  /** A `Start a review` draft, visible to its author until the review is sent. */
  pending?: boolean;
  createdAt?: string;
}

/** One stored pull request of a fixture repository. */
export interface StubPullRequest {
  number: number;
  title: string;
  description?: string;
  author: string;
  status: "draft" | "open" | "closed" | "merged";
  sourceBranch: string;
  targetBranch: string;
  reviewers?: string[];
  reviews?: StubPullRequestReview[];
  comments?: StubPullRequestComment[];
  checks?: StubPullRequestCheck[];
  events?: Array<{
    type: string;
    actor: string;
    createdAt: string;
    data?: Record<string, unknown>;
  }>;
  baseCommitSha?: string | null;
  compareCommitSha?: string | null;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  mergedAt?: string | null;
  /** The account that merged the record, or null. */
  mergedBy?: string | null;
  /** The merge commit the target branch points at after the merge. */
  mergeCommitSha?: string | null;
}

/** One branch protection rule of a fixture repository. */
export interface StubBranchProtectionRule {
  /** The exact branch name the rule is bound to, stored verbatim. */
  branchName: string;
  requireApproval?: boolean;
  requireStatusCheck?: boolean;
}

export interface StubRepository {
  name: string;
  description: string;
  visibility: "public" | "private";
  updatedAt?: string;
  defaultBranch?: string;
  branches?: string[];
  files?: Array<{ path: string; content: string }>;
  /** Explicit commit graph; without it one commit is derived from `files`. */
  commits?: StubCommit[];
  /** Branch name → commit sha; every branch points at the derived commit. */
  branchHeads?: Record<string, string>;
  /** The stored branch protection rules of this repository. */
  branchProtectionRules?: StubBranchProtectionRule[];
  source?: { owner: string; name: string } | null;
  /** Repository-scoped issue classification records and work items. */
  labels?: StubLabel[];
  milestones?: StubMilestone[];
  issues?: StubIssue[];
  /** Repository-scoped pull requests with their reviews and checks. */
  pullRequests?: StubPullRequest[];
  grants?: Array<{
    subjectType: "account" | "team";
    subjectName: string;
    role: string;
  }>;
}

/** One stored commit of a stub repository, with its complete file snapshot. */
export interface StubCommit {
  sha: string;
  message: string;
  author: string;
  createdAt: string;
  parentSha: string | null;
  files: Array<{ path: string; content: string }>;
}

/** A repository owned by an account instead of an organization. */
export interface StubPersonalRepository extends StubRepository {
  owner: string;
}

/** The resolved shape every repository stub route renders from. */
export interface StubRepositoryView {
  name: string;
  description: string;
  visibility: "public" | "private";
  updatedAt: string;
  defaultBranch: string;
  branches: string[];
  files: Array<{ path: string; content: string }>;
  commits: StubCommit[];
  branchHeads: Record<string, string>;
  source: { owner: string; name: string } | null;
  labels: StubLabel[];
  milestones: StubMilestone[];
  issues: StubIssue[];
  pullRequests: StubPullRequest[];
  branchProtectionRules: StubBranchProtectionRule[];
}

export const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export const STUB_REPOSITORY_TIMESTAMP = "2024-02-01T00:00:00.000Z";

export const REPOSITORY_MESSAGES = {
  nameRequired: "Repository name is required",
  nameFormat: "Repository name format is invalid",
  nameExists: "Repository name already exists",
  ownerInvalid: "Owner is invalid",
  ownerDenied: "You do not have permission to create a repository for this owner",
};

/** Directory entries of one revision, derived from the file snapshot. */
export function stubEntries(
  files: Array<{ path: string; content: string }>,
  directoryPath: string,
) {
  const prefix = directoryPath.length > 0 ? `${directoryPath}/` : "";
  const directories = new Set<string>();
  const entries: Array<{ name: string; path: string; type: "file" | "directory" }> = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) entries.push({ name: rest, path: file.path, type: "file" });
    else directories.add(rest.slice(0, slash));
  }
  const directoryEntries = [...directories]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      name,
      path: directoryPath.length > 0 ? `${directoryPath}/${name}` : name,
      type: "directory" as const,
    }));
  return [
    ...directoryEntries,
    ...entries.sort((left, right) => left.name.localeCompare(right.name)),
  ];
}

export function repositoryNameError(name: string): string | null {
  if (name.length === 0) return REPOSITORY_MESSAGES.nameRequired;
  if (name.length > 100 || !REPOSITORY_NAME_PATTERN.test(name)) {
    return REPOSITORY_MESSAGES.nameFormat;
  }
  if (name === "." || name === "..") return REPOSITORY_MESSAGES.nameFormat;
  return null;
}

export const STUB_COMMIT_SHA = "abc1234";

/**
 * Normalizes one repository fixture into the shape the stub routes read:
 * explicit commits when the fixture has them, otherwise a single commit that
 * carries the fixture `files` for every branch.
 */
export function createRepositoryView(repository: StubRepository): StubRepositoryView {
  const updatedAt = repository.updatedAt ?? "2024-01-01T00:00:00.000Z";
  const defaultBranch = repository.defaultBranch ?? "main";
  // A fresh array per view: writes in the stub (creating a branch) must never
  // mutate the shared fixture.
  const branches = [...(repository.branches ?? [defaultBranch])];
  const files = (repository.files ?? []).map((file) => ({ ...file }));
  const commits =
    repository.commits !== undefined
      ? repository.commits.map((commit) => ({
          ...commit,
          files: commit.files.map((file) => ({ ...file })),
        }))
      : [
          {
            sha: STUB_COMMIT_SHA,
            message: "Initial commit",
            author: "alice-dev",
            createdAt: updatedAt,
            parentSha: null,
            files: files.map((file) => ({ ...file })),
          },
        ];
  const branchHeads: Record<string, string> = { ...(repository.branchHeads ?? {}) };
  for (const branch of branches) {
    branchHeads[branch] ??= repository.commits === undefined ? STUB_COMMIT_SHA : commits[0].sha;
  }
  return {
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility,
    updatedAt,
    defaultBranch,
    branches,
    files,
    commits,
    branchHeads,
    source: repository.source ?? null,
    // A fresh copy per view: a stub write must never mutate the fixture.
    labels: (repository.labels ?? []).map((label) => ({ ...label })),
    milestones: (repository.milestones ?? []).map((milestone) => ({ ...milestone })),
    issues: (repository.issues ?? []).map((issue) => ({
      ...issue,
      assignees: [...(issue.assignees ?? [])],
      labels: [...(issue.labels ?? [])],
      reactions: (issue.reactions ?? []).map((reaction) => ({ ...reaction })),
      comments: (issue.comments ?? []).map((comment) => ({
        ...comment,
        reactions: (comment.reactions ?? []).map((reaction) => ({ ...reaction })),
      })),
      events: (issue.events ?? []).map((event) => ({ ...event, data: { ...event.data } })),
    })),
    pullRequests: (repository.pullRequests ?? []).map((pullRequest) => ({
      ...pullRequest,
      reviewers: [...(pullRequest.reviewers ?? [])],
      reviews: (pullRequest.reviews ?? []).map((review) => ({ ...review })),
      comments: (pullRequest.comments ?? []).map((comment) => ({ ...comment })),
      checks: (pullRequest.checks ?? []).map((check) => ({ ...check })),
      events: (pullRequest.events ?? []).map((event) => ({
        ...event,
        data: { ...(event.data ?? {}) },
      })),
    })),
    branchProtectionRules: (repository.branchProtectionRules ?? []).map((rule) => ({ ...rule })),
  };
}

export function createPersonalRepositoryRecords(
  repositories: readonly StubPersonalRepository[],
) {
  return repositories.map((repository) => ({
    ...createRepositoryView(repository),
    owner: repository.owner,
  }));
}

export type StubPersonalRepositoryRecord = ReturnType<
  typeof createPersonalRepositoryRecords
>[number];

export function repositoryViewFromInput(input: {
  name: string;
  description: string;
  visibility: "public" | "private";
  initializeReadme: boolean;
}): StubRepositoryView {
  return createRepositoryView({
    name: input.name,
    description: input.description,
    visibility: input.visibility,
    updatedAt: STUB_REPOSITORY_TIMESTAMP,
    defaultBranch: "main",
    branches: ["main"],
    files: input.initializeReadme ? [{ path: "README.md", content: `# ${input.name}\n` }] : [],
    source: null,
  });
}

/** A fork copies the source view and records where it was copied from. */
export function forkedRepositoryView(
  source: StubRepositoryView,
  input: { name: string; visibility: "public" | "private"; sourceOwner: string },
): StubRepositoryView {
  return {
    ...source,
    name: input.name,
    visibility: source.visibility === "private" ? "private" : input.visibility,
    updatedAt: STUB_REPOSITORY_TIMESTAMP,
    branches: [...source.branches],
    files: source.files.map((file) => ({ ...file })),
    commits: source.commits.map((commit) => ({
      ...commit,
      files: commit.files.map((file) => ({ ...file })),
    })),
    branchHeads: { ...source.branchHeads },
    source: { owner: input.sourceOwner, name: source.name },
    labels: source.labels.map((label) => ({ ...label })),
    milestones: source.milestones.map((milestone) => ({ ...milestone })),
    branchProtectionRules: source.branchProtectionRules.map((rule) => ({ ...rule })),
    issues: source.issues.map((issue) => ({
      ...issue,
      assignees: [...(issue.assignees ?? [])],
      labels: [...(issue.labels ?? [])],
      reactions: (issue.reactions ?? []).map((reaction) => ({ ...reaction })),
      comments: (issue.comments ?? []).map((comment) => ({
        ...comment,
        reactions: (comment.reactions ?? []).map((reaction) => ({ ...reaction })),
      })),
      events: (issue.events ?? []).map((event) => ({ ...event, data: { ...event.data } })),
    })),
    pullRequests: source.pullRequests.map((pullRequest) => ({
      ...pullRequest,
      reviewers: [...(pullRequest.reviewers ?? [])],
      reviews: (pullRequest.reviews ?? []).map((review) => ({ ...review })),
      comments: (pullRequest.comments ?? []).map((comment) => ({ ...comment })),
      checks: (pullRequest.checks ?? []).map((check) => ({ ...check })),
      events: (pullRequest.events ?? []).map((event) => ({
        ...event,
        data: { ...(event.data ?? {}) },
      })),
    })),
  };
}

export function organizationRepositoryPayload(
  owner: string,
  view: StubRepositoryView,
) {
  return {
    owner,
    ownerType: "organization" as const,
    ...view,
  };
}

export function explicitForkVisibility(
  sourceVisibility: "public" | "private",
  requested: unknown,
): "public" | "private" {
  if (sourceVisibility === "private") return "private";
  return requested === "private" ? "private" : "public";
}
