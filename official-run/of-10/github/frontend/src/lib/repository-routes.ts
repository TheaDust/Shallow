import { makeHash } from "./hash-route";

/**
 * Repository addresses. The canonical overview address is `#/repos/<owner>/<name>`;
 * the GitHub-style `#/<owner>/<name>` spelling is accepted as an alias so a
 * directly typed repository link resolves to the same view.
 *
 * Code and version-control views (REQ-4) live under the repository address:
 * `tree/<branch>/<path>` lists a directory, `blob/<branch>/<path>` reads a file,
 * `commits/<branch>[/<path>]` is the commit history of a branch or file,
 * `commit/<id>` is one commit with its diff and `compare` compares revisions.
 */
export const RESERVED_PREFIXES = new Set([
  "repos",
  "repositories",
  "search",
  "signin",
  "signup",
  "settings",
  "password-reset",
  "workspace",
  "users",
  "orgs",
  "organizations",
  "teams",
  "issues",
  "pulls",
  "new",
]);

export interface RepositoryOverviewRoute {
  kind: "overview";
  owner: string;
  name: string;
}

export interface RepositoryTreeRoute {
  kind: "tree";
  owner: string;
  name: string;
  branch: string;
  path: string;
}

export interface RepositoryBlobRoute {
  kind: "blob";
  owner: string;
  name: string;
  branch: string;
  path: string;
}

export interface RepositoryCommitsRoute {
  kind: "commits";
  owner: string;
  name: string;
  branch: string;
  path: string;
}

export interface RepositoryCommitRoute {
  kind: "commit";
  owner: string;
  name: string;
  commitId: string;
}

export interface RepositoryCompareRoute {
  kind: "compare";
  owner: string;
  name: string;
}

export interface RepositorySettingsRoute {
  kind: "settings";
  owner: string;
  name: string;
}

export interface RepositoryGeneralSettingsRoute {
  kind: "settings-general";
  owner: string;
  name: string;
}

export interface RepositoryAccessSettingsRoute {
  kind: "settings-access";
  owner: string;
  name: string;
}

export interface RepositoryBranchesSettingsRoute {
  kind: "settings-branches";
  owner: string;
  name: string;
}

/** The list of the repository's issues (REQ-5-1-1). */
export interface RepositoryIssuesRoute {
  kind: "issues";
  owner: string;
  name: string;
}

/** The list of the repository's pull requests (REQ-6-2-1). */
export interface RepositoryPullRequestsRoute {
  kind: "pulls";
  owner: string;
  name: string;
}

/** The comparison page that opens the pull-request creation flow (REQ-6-2-2). */
export interface RepositoryNewPullRequestRoute {
  kind: "pull-new";
  owner: string;
  name: string;
}

/** One pull request of a repository, addressed by its repository-scoped number. */
export interface RepositoryPullRequestRoute {
  kind: "pull";
  owner: string;
  name: string;
  number: number;
}

/** The issue creation form (REQ-5-2-1). */
export interface RepositoryNewIssueRoute {
  kind: "issue-new";
  owner: string;
  name: string;
}

/** One issue of a repository, addressed by its repository-scoped number. */
export interface RepositoryIssueRoute {
  kind: "issue";
  owner: string;
  name: string;
  number: number;
}

/** The file editor: creating a file (no path) or editing one on a branch. */
export interface RepositoryEditorRoute {
  kind: "editor";
  owner: string;
  name: string;
  branch: string;
  path: string;
}

export type RepositoryRoute =
  | RepositoryOverviewRoute
  | RepositoryTreeRoute
  | RepositoryBlobRoute
  | RepositoryCommitsRoute
  | RepositoryCommitRoute
  | RepositoryCompareRoute
  | RepositorySettingsRoute
  | RepositoryGeneralSettingsRoute
  | RepositoryAccessSettingsRoute
  | RepositoryBranchesSettingsRoute
  | RepositoryIssuesRoute
  | RepositoryPullRequestsRoute
  | RepositoryNewPullRequestRoute
  | RepositoryPullRequestRoute
  | RepositoryNewIssueRoute
  | RepositoryIssueRoute
  | RepositoryEditorRoute;

export function repositoryOverviewPath(owner: string, name: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function repositoryTreePath(
  owner: string,
  name: string,
  branch: string,
  path = "",
): string {
  const suffix = encodePath(path);
  return `${repositorySubPath(owner, name, `tree/${encodeURIComponent(branch)}`)}${suffix ? `/${suffix}` : ""}`;
}

export function repositoryBlobPath(
  owner: string,
  name: string,
  branch: string,
  path: string,
): string {
  return `${repositorySubPath(owner, name, `blob/${encodeURIComponent(branch)}`)}/${encodePath(path)}`;
}

export function repositoryCommitsPath(
  owner: string,
  name: string,
  branch: string,
  path = "",
): string {
  const suffix = encodePath(path);
  return `${repositorySubPath(owner, name, `commits/${encodeURIComponent(branch)}`)}${suffix ? `/${suffix}` : ""}`;
}

export function repositoryCommitPath(owner: string, name: string, commitId: string): string {
  return repositorySubPath(owner, name, `commit/${encodeURIComponent(commitId)}`);
}

export function repositoryComparePath(owner: string, name: string): string {
  return repositorySubPath(owner, name, "compare");
}

export function repositoryOverviewHref(owner: string, name: string): string {
  return makeHash(repositoryOverviewPath(owner, name));
}

export function repositorySubPath(owner: string, name: string, suffix: string): string {
  return `${repositoryOverviewPath(owner, name)}/${suffix}`;
}

/** Directory address on a branch; the branch root has no path segment. */
export function repositoryTreeHref(
  owner: string,
  name: string,
  branch: string,
  path = "",
): string {
  return makeHash(repositoryTreePath(owner, name, branch, path));
}

export function repositoryBlobHref(
  owner: string,
  name: string,
  branch: string,
  path: string,
): string {
  return makeHash(repositoryBlobPath(owner, name, branch, path));
}

/** Commit history of one branch, or of one file when `path` is given. */
export function repositoryCommitsHref(
  owner: string,
  name: string,
  branch: string,
  path = "",
): string {
  return makeHash(repositoryCommitsPath(owner, name, branch, path));
}

/** One commit entry, optionally limited to a single changed file's diff. */
export function repositoryCommitHref(
  owner: string,
  name: string,
  commitId: string,
  path = "",
): string {
  const search = new URLSearchParams();
  if (path) search.set("path", path);
  return makeHash(repositoryCommitPath(owner, name, commitId), search);
}

export function repositoryCompareHref(
  owner: string,
  name: string,
  base = "",
  compare = "",
  path = "",
): string {
  const search = new URLSearchParams();
  if (base) search.set("base", base);
  if (compare) search.set("compare", compare);
  if (path) search.set("path", path);
  return makeHash(repositoryComparePath(owner, name), search);
}

export function repositorySettingsPath(owner: string, name: string): string {
  return repositorySubPath(owner, name, "settings");
}

export function repositorySettingsHref(owner: string, name: string): string {
  return makeHash(repositorySettingsPath(owner, name));
}

export function repositoryGeneralSettingsHref(owner: string, name: string): string {
  return makeHash(repositorySubPath(owner, name, "settings/general"));
}

/** Repository settings → Branches (REQ-4-3-3, REQ-6-1). */
export function repositoryBranchesSettingsHref(owner: string, name: string): string {
  return makeHash(repositorySubPath(owner, name, "settings/branches"));
}

/**
 * Address of the file editor (REQ-4-4): `edit/<branch>` creates a file, while
 * `edit/<branch>/<path>` opens the stored content of an existing file.
 */
export function repositoryEditorPath(
  owner: string,
  name: string,
  branch: string,
  path = "",
): string {
  const suffix = encodePath(path);
  return `${repositorySubPath(owner, name, `edit/${encodeURIComponent(branch)}`)}${suffix ? `/${suffix}` : ""}`;
}

export function repositoryEditorHref(
  owner: string,
  name: string,
  branch: string,
  path = "",
): string {
  return makeHash(repositoryEditorPath(owner, name, branch, path));
}

/** Repository settings → Manage access (REQ-2-3). */
export function repositoryAccessSettingsHref(owner: string, name: string): string {
  return makeHash(repositorySubPath(owner, name, "settings/access"));
}

/**
 * Address of the repository's Issues list (REQ-5-1-1). The filter context is part
 * of the address, so refreshing the page keeps the chosen status, keyword and
 * label and the rows they select.
 */
export interface IssueFilterQuery {
  state?: string;
  q?: string;
  label?: string;
}

export function repositoryIssuesSearch(filters: IssueFilterQuery = {}): URLSearchParams {
  const search = new URLSearchParams();
  if (filters.state) search.set("state", filters.state);
  if (filters.q) search.set("q", filters.q);
  if (filters.label) search.set("label", filters.label);
  return search;
}

export function repositoryIssuesPath(owner: string, name: string): string {
  return repositorySubPath(owner, name, "issues");
}

/**
 * Address of the repository's Pull requests list (REQ-6-2-1). The filter context
 * is part of the address, so refreshing the page keeps the chosen status, author
 * and review status and the rows they select.
 */
export interface PullRequestFilterQuery {
  state?: string;
  author?: string;
  review?: string;
}

export function repositoryPullRequestsSearch(
  filters: PullRequestFilterQuery = {},
): URLSearchParams {
  const search = new URLSearchParams();
  if (filters.state) search.set("state", filters.state);
  if (filters.author) search.set("author", filters.author);
  if (filters.review) search.set("review", filters.review);
  return search;
}

export function repositoryPullRequestsPath(owner: string, name: string): string {
  return repositorySubPath(owner, name, "pulls");
}

export function repositoryPullRequestsHref(
  owner: string,
  name: string,
  filters: PullRequestFilterQuery = {},
): string {
  return makeHash(repositoryPullRequestsPath(owner, name), repositoryPullRequestsSearch(filters));
}

/**
 * The comparison page of the creation flow (REQ-6-2-2): the base and the compare
 * branch travel in the address, so a page entry can open the same flow with the
 * two branches already selected.
 */
export function repositoryNewPullRequestPath(owner: string, name: string): string {
  return `${repositoryPullRequestsPath(owner, name)}/new`;
}

export function repositoryNewPullRequestHref(
  owner: string,
  name: string,
  base = "",
  compare = "",
): string {
  const search = new URLSearchParams();
  if (base) search.set("base", base);
  if (compare) search.set("compare", compare);
  return makeHash(repositoryNewPullRequestPath(owner, name), search);
}

/** One pull request detail address, used by the list links and after a creation. */
export function repositoryPullRequestPath(owner: string, name: string, number: number): string {
  return `${repositoryPullRequestsPath(owner, name)}/${number}`;
}

/**
 * Address of one pull request. `tab` selects the section of the detail page
 * (Conversation, Commits, Files changed, Checks) and `path` selects one changed
 * file of the Files changed view without leaving the pull request.
 */
export function repositoryPullRequestHref(
  owner: string,
  name: string,
  number: number,
  tab = "",
  path = "",
): string {
  const search = new URLSearchParams();
  if (tab) search.set("tab", tab);
  if (path) search.set("path", path);
  return makeHash(repositoryPullRequestPath(owner, name, number), search);
}

export function repositoryIssuesHref(owner: string, name: string, filters: IssueFilterQuery = {}): string {
  return makeHash(repositoryIssuesPath(owner, name), repositoryIssuesSearch(filters));
}

/** Issue creation form of the current repository (REQ-5-2-1). */
export function repositoryNewIssuePath(owner: string, name: string): string {
  return `${repositoryIssuesPath(owner, name)}/new`;
}

export function repositoryNewIssueHref(owner: string, name: string): string {
  return makeHash(repositoryNewIssuePath(owner, name));
}

/** One issue detail address, used by the list links and after a creation. */
export function repositoryIssuePath(owner: string, name: string, number: number): string {
  return `${repositoryIssuesPath(owner, name)}/${number}`;
}

export function repositoryIssueHref(owner: string, name: string, number: number): string {
  return makeHash(repositoryIssuePath(owner, name, number));
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** `owner/name` reference of a repository address, or null for a non-repository one. */
export function repositoryScopeFromPath(path: string): string | null {
  const route = matchRepositoryRoute(path);
  if (!route) return null;
  return `${route.owner}/${route.name}`;
}

export function matchRepositoryRoute(path: string): RepositoryRoute | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (segments[0] !== "repos") {
    if (segments.length !== 2 || RESERVED_PREFIXES.has(segments[0])) return null;
    return {
      kind: "overview",
      owner: decode(segments[0]),
      name: decode(segments[1]),
    };
  }

  if (segments.length < 3) return null;
  const owner = decode(segments[1]);
  const name = decode(segments[2]);
  const rest = segments.slice(3);
  if (rest.length === 0) return { kind: "overview", owner, name };
  const remainder = rest.slice(1).map(decode);

  if (rest[0] === "settings") {
    if (remainder.length === 0) return { kind: "settings", owner, name };
    if (remainder.length === 1 && remainder[0] === "general") {
      return { kind: "settings-general", owner, name };
    }
    if (remainder.length === 1 && remainder[0] === "access") {
      return { kind: "settings-access", owner, name };
    }
    if (remainder.length === 1 && remainder[0] === "branches") {
      return { kind: "settings-branches", owner, name };
    }
    return null;
  }
  if (rest[0] === "edit" && remainder.length >= 1) {
    return {
      kind: "editor",
      owner,
      name,
      branch: remainder[0],
      path: remainder.slice(1).join("/"),
    };
  }
  if (rest[0] === "tree" && remainder.length >= 1) {
    return {
      kind: "tree",
      owner,
      name,
      branch: remainder[0],
      path: remainder.slice(1).join("/"),
    };
  }
  if (rest[0] === "blob" && remainder.length >= 2) {
    return {
      kind: "blob",
      owner,
      name,
      branch: remainder[0],
      path: remainder.slice(1).join("/"),
    };
  }
  if (rest[0] === "commits" && remainder.length >= 1) {
    return {
      kind: "commits",
      owner,
      name,
      branch: remainder[0],
      path: remainder.slice(1).join("/"),
    };
  }
  if (rest[0] === "commit" && remainder.length === 1) {
    return { kind: "commit", owner, name, commitId: remainder[0] };
  }
  if (rest[0] === "issues") {
    if (remainder.length === 0) return { kind: "issues", owner, name };
    if (remainder.length === 1 && remainder[0] === "new") {
      return { kind: "issue-new", owner, name };
    }
    if (remainder.length === 1 && /^\d+$/.test(remainder[0])) {
      return { kind: "issue", owner, name, number: Number(remainder[0]) };
    }
    return null;
  }
  if (rest[0] === "pulls") {
    if (remainder.length === 0) return { kind: "pulls", owner, name };
    if (remainder.length === 1 && remainder[0] === "new") {
      return { kind: "pull-new", owner, name };
    }
    if (remainder.length === 1 && /^\d+$/.test(remainder[0])) {
      return { kind: "pull", owner, name, number: Number(remainder[0]) };
    }
    return null;
  }
  if (rest[0] === "compare" && remainder.length === 0) {
    return { kind: "compare", owner, name };
  }
  return null;
}
