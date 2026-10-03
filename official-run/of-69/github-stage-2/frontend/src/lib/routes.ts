/**
 * Hash-route table. Every page that the product documents is reachable by URL
 * so it can be opened directly and survives a refresh.
 */
export type Route =
  | { view: "home" }
  | { view: "search" }
  | { view: "signin" }
  | { view: "signup" }
  | { view: "recover" }
  | { view: "workspace" }
  | { view: "repositories-new" }
  | { view: "settings" }
  | { view: "settings-password" }
  | { view: "organizations" }
  | { view: "organizations-new" }
  | { view: "organization-overview"; organization: string }
  | { view: "organization-repositories"; organization: string }
  | { view: "repository-overview"; organization: string; repository: string }
  | { view: "user-repository-overview"; username: string; repository: string }
  | {
      view: "repository-commits";
      ownerType: RepositoryOwnerType;
      owner: string;
      repository: string;
    }
  | {
      view: "repository-commit";
      ownerType: RepositoryOwnerType;
      owner: string;
      repository: string;
      commitId: string;
    }
  | {
      view: "repository-search";
      ownerType: RepositoryOwnerType;
      owner: string;
      repository: string;
    }
  | { view: "repository-settings"; organization: string; repository: string }
  | { view: "repository-settings-branches"; organization: string; repository: string }
  | {
      view: "repository-new-file";
      ownerType: RepositoryOwnerType;
      owner: string;
      repository: string;
    }
  | { view: "repository-access"; organization: string; repository: string }
  | { view: "organization-people"; organization: string }
  | { view: "organization-teams"; organization: string }
  | { view: "organization-team-new"; organization: string }
  | { view: "team-overview"; organization: string; team: string }
  | { view: "team-members"; organization: string; team: string }
  | { view: "team-settings"; organization: string; team: string };

const SIMPLE_ROUTES: Record<string, Route> = {
  signin: { view: "signin" },
  signup: { view: "signup" },
  recover: { view: "recover" },
  workspace: { view: "workspace" },
  settings: { view: "settings" },
};

export function matchRoute(path: string): Route {
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (segments.length === 1 && segments[0] === "search") return { view: "search" };
  if (segments.length === 1 && SIMPLE_ROUTES[segments[0]]) return SIMPLE_ROUTES[segments[0]];
  if (segments.length === 2 && segments[0] === "settings" && segments[1] === "password") {
    return { view: "settings-password" };
  }
  if (segments.length === 2 && segments[0] === "repositories" && segments[1] === "new") {
    return { view: "repositories-new" };
  }
  // Personal repositories live under /users/:username/repositories/:repo, the
  // organization form stays under /organizations/:org/repositories/:repo. Both
  // carry the same read-only code views: the code page itself, the commit
  // history, one commit's difference and the repository code search.
  if (segments[0] === "users") {
    if (segments.length >= 4 && segments[2] === "repositories") {
      const repository = segments[3];
      if (segments.length === 4) return { view: "user-repository-overview", username: segments[1], repository };
      if (segments.length === 5 && segments[4] === "commits") {
        return { view: "repository-commits", ownerType: "user", owner: segments[1], repository };
      }
      if (segments.length === 5 && segments[4] === "search") {
        return { view: "repository-search", ownerType: "user", owner: segments[1], repository };
      }
      if (segments.length === 5 && segments[4] === "new") {
        return { view: "repository-new-file", ownerType: "user", owner: segments[1], repository };
      }
      if (segments.length === 6 && segments[4] === "commit") {
        return {
          view: "repository-commit",
          ownerType: "user",
          owner: segments[1],
          repository,
          commitId: segments[5],
        };
      }
    }
    return { view: "home" };
  }
  if (segments[0] !== "organizations") return { view: "home" };

  if (segments.length === 1) return { view: "organizations" };
  if (segments.length === 2 && segments[1] === "new") return { view: "organizations-new" };
  if (segments.length === 2) return { view: "organization-overview", organization: segments[1] };

  const [, organization, section, child, grandChild] = segments;
  if (segments.length === 3) {
    if (section === "repositories") return { view: "organization-repositories", organization };
    if (section === "people") return { view: "organization-people", organization };
    if (section === "teams") return { view: "organization-teams", organization };
    return { view: "home" };
  }
  if (section === "repositories") {
    if (segments.length === 4) return { view: "repository-overview", organization, repository: child };
    if (segments.length === 5 && grandChild === "commits") {
      return { view: "repository-commits", ownerType: "organization", owner: organization, repository: child };
    }
    if (segments.length === 5 && grandChild === "search") {
      return { view: "repository-search", ownerType: "organization", owner: organization, repository: child };
    }
    if (segments.length === 5 && grandChild === "new") {
      return { view: "repository-new-file", ownerType: "organization", owner: organization, repository: child };
    }
    if (segments.length === 5 && grandChild === "settings") {
      return { view: "repository-settings", organization, repository: child };
    }
    if (segments.length === 6 && grandChild === "settings" && segments[5] === "branches") {
      return { view: "repository-settings-branches", organization, repository: child };
    }
    if (segments.length === 6 && grandChild === "commit") {
      return {
        view: "repository-commit",
        ownerType: "organization",
        owner: organization,
        repository: child,
        commitId: segments[5],
      };
    }
    if (segments.length === 6 && grandChild === "settings" && segments[5] === "access") {
      return { view: "repository-access", organization, repository: child };
    }
    return { view: "home" };
  }
  if (section === "teams") {
    if (segments.length === 4 && child === "new") return { view: "organization-team-new", organization };
    if (segments.length === 4) return { view: "team-overview", organization, team: child };
    if (segments.length === 5 && grandChild === "members") return { view: "team-members", organization, team: child };
    if (segments.length === 5 && grandChild === "settings") return { view: "team-settings", organization, team: child };
  }
  return { view: "home" };
}

/** Views that require a signed-in account before they can render. */
export function isProtectedView(route: Route): boolean {
  switch (route.view) {
    case "workspace":
    case "repositories-new":
    case "settings":
    case "settings-password":
    case "organizations":
    case "organizations-new":
    case "organization-team-new":
    case "repository-new-file":
      return true;
    default:
      return false;
  }
}

/** Canonical route path for an organization page (also used by `navigate`). */
export function organizationPath(organization: string, ...rest: string[]): string {
  return `/organizations/${[organization, ...rest].map(encodeURIComponent).join("/")}`;
}

export function organizationUrl(organization: string, ...rest: string[]): string {
  return `#${organizationPath(organization, ...rest)}`;
}

/** A repository owner reference; a missing `type` is an organization. */
export interface RepositoryOwnerRef {
  type?: "user" | "organization";
  name: string;
}

/** The kind of namespace a repository lives in. */
export type RepositoryOwnerType = "user" | "organization";

/** One repository of a view: its namespace, its owner and its name. */
export interface RepositoryContext {
  ownerType: RepositoryOwnerType;
  owner: string;
  repository: string;
}

/**
 * The repository a path belongs to, whatever its code view. The top searchbox
 * uses this to keep a query scoped to the repository the viewer is browsing.
 */
export function repositoryContextForPath(path: string): RepositoryContext | null {
  const route = matchRoute(path);
  switch (route.view) {
    case "repository-overview":
    case "repository-settings":
    case "repository-access":
    case "repository-settings-branches":
      return { ownerType: "organization", owner: route.organization, repository: route.repository };
    case "repository-commits":
    case "repository-commit":
    case "repository-search":
      return { ownerType: route.ownerType, owner: route.owner, repository: route.repository };
    case "repository-new-file":
      return { ownerType: route.ownerType, owner: route.owner, repository: route.repository };
    case "user-repository-overview":
      return { ownerType: "user", owner: route.username, repository: route.repository };
    default:
      return null;
  }
}

/** Canonical path of a repository (personal or organization) plus any suffix. */
export function repositoryPath(owner: RepositoryOwnerRef, repository: string, ...rest: string[]): string {
  const namespace = owner.type === "user" ? "users" : "organizations";
  return `/${namespace}/${[owner.name, "repositories", repository, ...rest].map(encodeURIComponent).join("/")}`;
}

export function repositoryUrl(owner: RepositoryOwnerRef, repository: string, ...rest: string[]): string {
  return `#${repositoryPath(owner, repository, ...rest)}`;
}

/** The addressable parts of the code page: branch, directory path and file. */
export interface CodePageParams {
  branch?: string;
  path?: string;
  file?: string;
}

function codePageQuery(params: CodePageParams): string {
  const search = new URLSearchParams();
  if (params.branch) search.set("branch", params.branch);
  if (params.path) search.set("path", params.path);
  if (params.file) search.set("file", params.file);
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * The code page of a repository: the branch selector, the directory at `path`
 * and the optionally opened file are all carried by the URL, so the view is
 * directly openable and survives a reload.
 */
export function repositoryCodePath(
  owner: RepositoryOwnerRef,
  repository: string,
  params: CodePageParams = {},
): string {
  return `${repositoryPath(owner, repository)}${codePageQuery(params)}`;
}

export function repositoryCodeUrl(
  owner: RepositoryOwnerRef,
  repository: string,
  params: CodePageParams = {},
): string {
  return `#${repositoryCodePath(owner, repository, params)}`;
}

/**
 * The new-file editor of a repository. The branch the file is committed to is
 * carried by the address, so the page can be opened and refreshed directly.
 */
export function repositoryNewFilePath(
  owner: RepositoryOwnerRef,
  repository: string,
  params: { branch?: string } = {},
): string {
  return `${repositoryPath(owner, repository, "new")}${codePageQuery({ branch: params.branch })}`;
}

export function repositoryNewFileUrl(
  owner: RepositoryOwnerRef,
  repository: string,
  params: { branch?: string } = {},
): string {
  return `#${repositoryNewFilePath(owner, repository, params)}`;
}

/** The Settings → Branches page of an organization repository. */
export function repositoryBranchesSettingsPath(organization: string, repository: string): string {
  return organizationPath(organization, "repositories", repository, "settings", "branches");
}

export function repositoryBranchesSettingsUrl(organization: string, repository: string): string {
  return `#${repositoryBranchesSettingsPath(organization, repository)}`;
}

/** The commit history of a repository (optionally of one branch or file path). */
export function repositoryCommitsPath(
  ownerType: RepositoryOwnerType,
  owner: string,
  repository: string,
  params: { branch?: string; path?: string } = {},
): string {
  const query = codePageQuery({ branch: params.branch, path: params.path });
  const namespace = ownerType === "user" ? "users" : "organizations";
  return `/${namespace}/${[owner, "repositories", repository, "commits"]
    .map(encodeURIComponent)
    .join("/")}${query}`;
}

export function repositoryCommitsUrl(
  ownerType: RepositoryOwnerType,
  owner: string,
  repository: string,
  params: { branch?: string; path?: string } = {},
): string {
  return `#${repositoryCommitsPath(ownerType, owner, repository, params)}`;
}

/** One commit and its difference against the parent revision. */
export function repositoryCommitPath(
  ownerType: RepositoryOwnerType,
  owner: string,
  repository: string,
  commitId: string,
): string {
  const namespace = ownerType === "user" ? "users" : "organizations";
  return `/${namespace}/${[owner, "repositories", repository, "commit", commitId]
    .map(encodeURIComponent)
    .join("/")}`;
}

export function repositoryCommitUrl(
  ownerType: RepositoryOwnerType,
  owner: string,
  repository: string,
  commitId: string,
): string {
  return `#${repositoryCommitPath(ownerType, owner, repository, commitId)}`;
}

/** The code search results of one repository, carrying the query in the URL. */
export function repositoryCodeSearchPath(
  ownerType: RepositoryOwnerType,
  owner: string,
  repository: string,
  query: string,
  params: { branch?: string; path?: string } = {},
): string {
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (params.branch) search.set("branch", params.branch);
  if (params.path) search.set("path", params.path);
  const namespace = ownerType === "user" ? "users" : "organizations";
  const suffix = search.toString();
  return `/${namespace}/${[owner, "repositories", repository, "search"]
    .map(encodeURIComponent)
    .join("/")}${suffix ? `?${suffix}` : ""}`;
}

export function repositoryCodeSearchUrl(
  ownerType: RepositoryOwnerType,
  owner: string,
  repository: string,
  query: string,
  params: { branch?: string; path?: string } = {},
): string {
  return `#${repositoryCodeSearchPath(ownerType, owner, repository, query, params)}`;
}
