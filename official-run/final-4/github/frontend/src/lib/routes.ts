// Hash-route parser: one place that maps the current hash path to a view.

export type OrganizationTab = "repositories" | "people" | "teams";
export type TeamTab = "members" | "settings";

export type AppRoute =
  | { name: "home" }
  | { name: "workspace" }
  | { name: "sign-in" }
  | { name: "sign-up" }
  | { name: "search" }
  | { name: "forgot-password" }
  | { name: "settings" }
  | { name: "password-settings" }
  | { name: "active-sessions" }
  | { name: "your-organizations" }
  | { name: "new-organization" }
  | { name: "organization"; organizationId: string; tab: OrganizationTab }
  | { name: "organization-audit-log"; organizationId: string }
  | { name: "new-team"; organizationId: string }
  | { name: "team"; organizationId: string; teamName: string; tab: TeamTab }
  | { name: "repository"; owner: string; repositoryName: string }
  | { name: "new-repository" }
  | { name: "repository-fork"; owner: string; repositoryName: string }
  | { name: "repository-code"; owner: string; repositoryName: string; path: string }
  | { name: "repository-file"; owner: string; repositoryName: string; path: string }
  | { name: "repository-commits"; owner: string; repositoryName: string }
  | { name: "repository-commit"; owner: string; repositoryName: string; commitId: string }
  | { name: "repository-search"; owner: string; repositoryName: string }
  | { name: "repository-settings"; owner: string; repositoryName: string }
  | { name: "repository-branches"; owner: string; repositoryName: string }
  | { name: "repository-new-file"; owner: string; repositoryName: string }
  | { name: "repository-access"; owner: string; repositoryName: string }
  | { name: "repository-issues"; owner: string; repositoryName: string }
  | { name: "repository-new-issue"; owner: string; repositoryName: string }
  | { name: "repository-issue"; owner: string; repositoryName: string; issueNumber: string }
  | { name: "repository-pulls"; owner: string; repositoryName: string }
  | { name: "repository-pull-new"; owner: string; repositoryName: string }
  | { name: "repository-pull"; owner: string; repositoryName: string; pullNumber: string }
  | { name: "repository-pull-commits"; owner: string; repositoryName: string; pullNumber: string }
  | { name: "repository-pull-files"; owner: string; repositoryName: string; pullNumber: string }
  | { name: "repository-pull-checks"; owner: string; repositoryName: string; pullNumber: string }
  | { name: "repository-releases"; owner: string; repositoryName: string }
  | { name: "repository-new-release"; owner: string; repositoryName: string }
  | { name: "repository-release"; owner: string; repositoryName: string; tag: string }
  | { name: "not-found" };

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseRoute(path: string): AppRoute {
  const segments = path.split("/").filter(Boolean).map(decodeSegment);
  if (segments.length === 0) return { name: "home" };

  if (segments.length === 1) {
    switch (segments[0]) {
      case "workspace":
        return { name: "workspace" };
      case "sign-in":
        return { name: "sign-in" };
      case "sign-up":
        return { name: "sign-up" };
      case "forgot-password":
        return { name: "forgot-password" };
      case "settings":
        return { name: "settings" };
      case "search":
        // The query itself lives in the hash search string (`#/search?q=`), so
        // the results view is part of the reloadable address.
        return { name: "search" };
      default:
        return { name: "not-found" };
    }
  }

  if (segments[0] === "settings") {
    if (segments.length === 2 && segments[1] === "password") return { name: "password-settings" };
    // REQ-1-4: the security page that lists the account's browser sessions.
    if (segments.length === 2 && segments[1] === "sessions") return { name: "active-sessions" };
    if (segments[1] === "organizations") {
      if (segments.length === 2) return { name: "your-organizations" };
      if (segments.length === 3 && segments[2] === "new") return { name: "new-organization" };
    }
    return { name: "not-found" };
  }

  if (segments[0] === "orgs" && segments[1]) {
    const organizationId = segments[1];
    if (segments.length === 2) return { name: "organization", organizationId, tab: "repositories" };
    if (segments.length === 3) {
      if (segments[2] === "repositories" || segments[2] === "people" || segments[2] === "teams") {
        return { name: "organization", organizationId, tab: segments[2] };
      }
      // REQ-2-4: the organization audit log the Owner opens from the overview.
      if (segments[2] === "audit-log") return { name: "organization-audit-log", organizationId };
      return { name: "not-found" };
    }
    if (segments[2] === "teams") {
      const teamName = segments[3];
      if (!teamName) return { name: "not-found" };
      if (segments.length === 4 && teamName === "new") return { name: "new-team", organizationId };
      if (segments.length === 4) return { name: "team", organizationId, teamName, tab: "members" };
      if (segments.length === 5 && segments[4] === "members") {
        return { name: "team", organizationId, teamName, tab: "members" };
      }
      if (segments.length === 5 && segments[4] === "settings") {
        return { name: "team", organizationId, teamName, tab: "settings" };
      }
    }
    return { name: "not-found" };
  }

  if (segments[0] === "repositories" && segments.length >= 2) {
    if (segments.length === 2 && segments[1] === "new") return { name: "new-repository" };
    if (segments.length < 3) return { name: "not-found" };
    const owner = segments[1];
    const repositoryName = segments[2];
    if (segments.length === 3) return { name: "repository", owner, repositoryName };
    if (segments[3] === "fork" && segments.length === 4) {
      return { name: "repository-fork", owner, repositoryName };
    }
    if (segments[3] === "commits" && segments.length === 4) {
      return { name: "repository-commits", owner, repositoryName };
    }
    // The web editor that adds one file to a branch.
    if (segments[3] === "new" && segments.length === 4) {
      return { name: "repository-new-file", owner, repositoryName };
    }
    // The repository-scoped code search results; the query travels in the hash
    // search string so the view is restored on reload or direct link.
    if (segments[3] === "search" && segments.length === 4) {
      return { name: "repository-search", owner, repositoryName };
    }
    // One commit compared with its parent revision.
    if (segments[3] === "commit" && segments.length === 5) {
      return { name: "repository-commit", owner, repositoryName, commitId: segments[4] };
    }
    // The file path travels as one encoded segment, so "src/index.js" stays a
    // single route segment and can be reloaded directly.
    if (segments[3] === "code") {
      return {
        name: "repository-code",
        owner,
        repositoryName,
        path: segments.slice(4).join("/"),
      };
    }
    if (segments[3] === "blob" && segments.length >= 5) {
      return {
        name: "repository-file",
        owner,
        repositoryName,
        path: segments.slice(4).join("/"),
      };
    }
    if (segments[3] === "issues") {
      if (segments.length === 4) return { name: "repository-issues", owner, repositoryName };
      if (segments.length === 5 && segments[4] === "new") {
        return { name: "repository-new-issue", owner, repositoryName };
      }
      if (segments.length === 5) {
        return { name: "repository-issue", owner, repositoryName, issueNumber: segments[4] };
      }
      return { name: "not-found" };
    }
    // The Pull requests list, the comparison page and the four views of one
    // pull request. `new` is a literal segment, so it can never be a number.
    if (segments[3] === "pulls") {
      if (segments.length === 4) return { name: "repository-pulls", owner, repositoryName };
      if (segments.length === 5 && segments[4] === "new") {
        return { name: "repository-pull-new", owner, repositoryName };
      }
      if (segments.length === 5) {
        return { name: "repository-pull", owner, repositoryName, pullNumber: segments[4] };
      }
      if (segments.length === 6) {
        const pullNumber = segments[4];
        if (segments[5] === "commits") {
          return { name: "repository-pull-commits", owner, repositoryName, pullNumber };
        }
        if (segments[5] === "files") {
          return { name: "repository-pull-files", owner, repositoryName, pullNumber };
        }
        if (segments[5] === "checks") {
          return { name: "repository-pull-checks", owner, repositoryName, pullNumber };
        }
      }
      return { name: "not-found" };
    }
    // REQ-4-5: the Releases page and the release detail of one repository. The
    // tag travels as one encoded segment, so a published release can be opened
    // directly and restored after a reload.
    if (segments[3] === "releases") {
      if (segments.length === 4) return { name: "repository-releases", owner, repositoryName };
      if (segments.length === 5 && segments[4] === "new") {
        return { name: "repository-new-release", owner, repositoryName };
      }
      if (segments.length === 5) {
        return { name: "repository-release", owner, repositoryName, tag: segments[4] };
      }
      return { name: "not-found" };
    }
    if (segments[3] === "settings") {
      if (segments.length === 4) return { name: "repository-settings", owner, repositoryName };
      if (segments.length === 5 && segments[4] === "general") {
        return { name: "repository-settings", owner, repositoryName };
      }
      if (segments.length === 5 && segments[4] === "access") {
        return { name: "repository-access", owner, repositoryName };
      }
      if (segments.length === 5 && segments[4] === "branches") {
        return { name: "repository-branches", owner, repositoryName };
      }
    }
    return { name: "not-found" };
  }

  return { name: "not-found" };
}

export const organizationHash = (organizationId: string, tab?: OrganizationTab): string =>
  tab ? `#/orgs/${encodeURIComponent(organizationId)}/${tab}` : `#/orgs/${encodeURIComponent(organizationId)}`;

/**
 * The organization audit log (REQ-2-4). The selected action filter travels in
 * the hash search string, so a reload restores the same filtered list.
 */
export const organizationAuditLogHash = (organizationId: string, action = ""): string => {
  const trimmed = action.trim();
  const query = trimmed ? `?${new URLSearchParams({ action: trimmed }).toString()}` : "";
  return `#/orgs/${encodeURIComponent(organizationId)}/audit-log${query}`;
};

export const teamHash = (organizationId: string, teamName: string, tab?: TeamTab): string =>
  `#/orgs/${encodeURIComponent(organizationId)}/teams/${encodeURIComponent(teamName)}${tab ? `/${tab}` : ""}`;

export const repositoryHash = (owner: string, name: string): string =>
  `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

export const newRepositoryHash = "#/repositories/new";

export const forkRepositoryHash = (owner: string, name: string): string =>
  `${repositoryHash(owner, name)}/fork`;

/**
 * Hash search string of a repository view: the branch a view reads travels in
 * the address, so reloading the page or opening the link directly restores the
 * same branch snapshot. An empty branch means the repository default branch.
 */
function repositoryQuery(branch?: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  const value = branch?.trim();
  if (value) params.set("branch", value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const repositoryCodeHash = (owner: string, name: string, path = "", branch?: string): string =>
  `${repositoryHash(owner, name)}/code${path ? `/${encodeURIComponent(path)}` : ""}${repositoryQuery(branch)}`;

export const repositoryBlobHash = (
  owner: string,
  name: string,
  path: string,
  branch?: string,
): string => `${repositoryHash(owner, name)}/blob/${encodeURIComponent(path)}${repositoryQuery(branch)}`;

export const repositoryCommitsHash = (
  owner: string,
  name: string,
  path = "",
  branch?: string,
): string =>
  `${repositoryHash(owner, name)}/commits${repositoryQuery(branch, path ? { path } : {})}`;

export const repositoryNewFileHash = (owner: string, name: string, branch?: string): string =>
  `${repositoryHash(owner, name)}/new${repositoryQuery(branch)}`;

export const repositoryCommitHash = (owner: string, name: string, commitId: string): string =>
  `${repositoryHash(owner, name)}/commit/${encodeURIComponent(commitId)}`;

export const repositorySearchHash = (owner: string, name: string, query: string): string =>
  `${repositoryHash(owner, name)}/search?${new URLSearchParams({ q: query }).toString()}`;

/**
 * The repository Issues list. `state` selects the Open/Closed view and stays in
 * the address, so the selected view survives a reload or a direct link.
 */
export const repositoryIssuesHash = (
  owner: string,
  name: string,
  query: { state?: string; q?: string } = {},
): string => {
  const params = new URLSearchParams();
  if (query.state) params.set("state", query.state);
  const trimmed = query.q?.trim();
  if (trimmed) params.set("q", trimmed);
  const search = params.toString();
  return `${repositoryHash(owner, name)}/issues${search ? `?${search}` : ""}`;
};

export const repositoryNewIssueHash = (owner: string, name: string): string =>
  `${repositoryHash(owner, name)}/issues/new`;

export const repositoryIssueHash = (owner: string, name: string, number: string | number): string =>
  `${repositoryHash(owner, name)}/issues/${encodeURIComponent(String(number))}`;

/**
 * The repository Pull requests list. `state` selects the Open/Closed view and
 * stays in the address, so the selected view survives a reload or a direct
 * link; the filter only changes what the browser displays.
 */
export const repositoryPullsHash = (
  owner: string,
  name: string,
  query: { state?: string } = {},
): string => {
  const params = new URLSearchParams();
  if (query.state) params.set("state", query.state);
  const search = params.toString();
  return `${repositoryHash(owner, name)}/pulls${search ? `?${search}` : ""}`;
};

/** The comparison page that "New pull request" opens. */
export const repositoryNewPullHash = (owner: string, name: string): string =>
  `${repositoryHash(owner, name)}/pulls/new`;

/** One pull request: Conversation by default, then Commits, files and checks. */
export const repositoryPullHash = (owner: string, name: string, number: string | number): string =>
  `${repositoryHash(owner, name)}/pulls/${encodeURIComponent(String(number))}`;

export const repositoryPullCommitsHash = (
  owner: string,
  name: string,
  number: string | number,
): string => `${repositoryPullHash(owner, name, number)}/commits`;

export const repositoryPullFilesHash = (
  owner: string,
  name: string,
  number: string | number,
): string => `${repositoryPullHash(owner, name, number)}/files`;

export const repositoryPullChecksHash = (
  owner: string,
  name: string,
  number: string | number,
): string => `${repositoryPullHash(owner, name, number)}/checks`;

export const repositorySettingsHash = (owner: string, name: string): string =>
  `${repositoryHash(owner, name)}/settings`;

/**
 * The repository Releases list (REQ-4-5). The tag of one release travels as one
 * encoded segment, so the detail view is part of the reloadable address.
 */
export const repositoryReleasesHash = (owner: string, name: string): string =>
  `${repositoryHash(owner, name)}/releases`;

/** The "New release" form of one repository. */
export const repositoryNewReleaseHash = (owner: string, name: string): string =>
  `${repositoryReleasesHash(owner, name)}/new`;

export const repositoryReleaseHash = (owner: string, name: string, tag: string): string =>
  `${repositoryReleasesHash(owner, name)}/${encodeURIComponent(tag)}`;

export const repositoryBranchesHash = (owner: string, name: string): string =>
  `${repositoryHash(owner, name)}/settings/branches`;

export const repositoryGeneralHash = (owner: string, name: string): string =>
  `${repositorySettingsHash(owner, name)}/general`;

export const repositoryAccessHash = (owner: string, name: string): string =>
  `${repositoryHash(owner, name)}/settings/access`;

export const searchHash = (query: string): string => `#/search?q=${encodeURIComponent(query)}`;

/** The security page listing the current browser session and the others. */
export const activeSessionsHash = "#/settings/sessions";

/**
 * The repository a view belongs to, when the current route is inside one. The
 * header search box uses this to search the current repository instead of all
 * repositories, which is what makes it "the repository Search box".
 */
export function routeRepository(
  route: AppRoute,
): { owner: string; repositoryName: string } | null {
  switch (route.name) {
    case "repository":
    case "repository-code":
    case "repository-file":
    case "repository-commits":
    case "repository-commit":
    case "repository-search":
    case "repository-settings":
    case "repository-branches":
    case "repository-new-file":
    case "repository-access":
    case "repository-issues":
    case "repository-new-issue":
    case "repository-issue":
    case "repository-pulls":
    case "repository-pull-new":
    case "repository-pull":
    case "repository-pull-commits":
    case "repository-pull-files":
    case "repository-pull-checks":
    case "repository-releases":
    case "repository-new-release":
    case "repository-release":
      return { owner: route.owner, repositoryName: route.repositoryName };
    default:
      return null;
  }
}
