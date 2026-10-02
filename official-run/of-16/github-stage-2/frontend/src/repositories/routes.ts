import type { RepositoryOwnerKind } from "./types";

/**
 * Hash paths of the repository area. An organization repository lives under
 * `/organizations/<slug>/repositories/<name>`, a personal one under
 * `/users/<username>/repositories/<name>`, so an owner kind is always explicit
 * and a repository can be opened by a direct link.
 */
export function repositoryPath(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  suffix = "",
): string {
  const base = ownerKind === "organization"
    ? `/organizations/${encodeURIComponent(owner)}/repositories/${encodeURIComponent(name)}`
    : `/users/${encodeURIComponent(owner)}/repositories/${encodeURIComponent(name)}`;
  return `${base}${suffix}`;
}

export function repositoryHash(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  suffix = "",
): string {
  return `#${repositoryPath(ownerKind, owner, name, suffix)}`;
}

/** Profile page of the owning account or the organization overview. */
export function ownerProfilePath(ownerKind: RepositoryOwnerKind, owner: string): string {
  return ownerKind === "organization"
    ? `/organizations/${encodeURIComponent(owner)}`
    : `/users/${encodeURIComponent(owner)}`;
}

export const NEW_REPOSITORY_PATH = "/new";

export const REPOSITORY_SECTIONS = ["issues", "pull-requests"] as const;
export type RepositorySectionName = (typeof REPOSITORY_SECTIONS)[number];

/** Sections of the repository Settings area offered by the Settings nav. */
export const REPOSITORY_SETTINGS_SECTIONS = ["general", "branches", "manage-access"] as const;

export type RepositoryRouteView =
  | "overview"
  | "fork"
  | "settings"
  | "section"
  | "blob"
  | "tree"
  | "commits"
  | "commit"
  | "search"
  | "new-file";

export interface RepositoryRouteMatch {
  view: RepositoryRouteView;
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  section?: string;
  branch?: string;
  path?: string;
  commitId?: string;
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Directory listing of one path on one branch, below the repository address. */
export function repositoryTreeSuffix(branch: string, path = ""): string {
  const encoded = encodePathSegments(path);
  return `/tree/${encodeURIComponent(branch)}${encoded.length > 0 ? `/${encoded}` : ""}`;
}

/** Read-only file address of one path on one branch. */
export function repositoryBlobSuffix(branch: string, path = ""): string {
  return `/blob/${encodeURIComponent(branch)}/${encodePathSegments(path)}`;
}

/** Commit history of one branch, optionally narrowed to one file path. */
export function repositoryCommitsSuffix(branch = "", path = ""): string {
  const encodedBranch = branch.length > 0 ? `/${encodeURIComponent(branch)}` : "";
  const encoded = encodePathSegments(path);
  return `/commits${encodedBranch}${encoded.length > 0 ? `/${encoded}` : ""}`;
}

/** Comparison page of one commit. */
export function repositoryCommitSuffix(commitId: string): string {
  return `/commit/${encodeURIComponent(commitId)}`;
}

/** Editor address of a new file on one branch. */
export function repositoryNewFileSuffix(branch: string): string {
  return `/new/${encodeURIComponent(branch)}`;
}

/** Code search results of the current repository. */
export const REPOSITORY_SEARCH_SUFFIX = "/search";

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Matches every repository address of both owner families: the overview, the
 * fork form, the Settings area, the read-only file page and the placeholder
 * sections. Returns null for any other address so the caller can fall through
 * to the remaining routes.
 */
export function matchRepositoryRoute(path: string): RepositoryRouteMatch | null {
  const segments = path.split("/").filter(Boolean);
  let ownerKind: RepositoryOwnerKind;
  let owner: string;
  let name: string;
  let rest: string[];
  if (segments[0] === "organizations" && segments[2] === "repositories" && segments.length >= 4) {
    ownerKind = "organization";
    owner = segments[1];
    name = segments[3];
    rest = segments.slice(4);
  } else if (segments[0] === "users" && segments[2] === "repositories" && segments.length >= 4) {
    ownerKind = "account";
    owner = segments[1];
    name = segments[3];
    rest = segments.slice(4);
  } else {
    return null;
  }

  const base = { ownerKind, owner: safeDecode(owner), name: safeDecode(name) };
  const tail = rest.map(safeDecode);
  if (tail.length === 0) return { ...base, view: "overview" };
  if (tail.length === 1 && tail[0] === "fork") return { ...base, view: "fork" };
  if (tail.length === 1 && (REPOSITORY_SECTIONS as readonly string[]).includes(tail[0])) {
    return { ...base, view: "section", section: tail[0] };
  }
  if (tail[0] === "settings") {
    // Settings exist for organization and personal repositories alike; the
    // page itself decides from the stored repository whether the viewer manages
    // it. Only the offered sections resolve, everything else is not found.
    if (tail.length === 1) return { ...base, view: "settings" };
    if (tail.length === 2 && (REPOSITORY_SETTINGS_SECTIONS as readonly string[]).includes(tail[1])) {
      return { ...base, view: "settings", section: tail[1] };
    }
    return null;
  }
  if (tail[0] === "blob" && tail.length >= 3) {
    return { ...base, view: "blob", branch: tail[1], path: tail.slice(2).join("/") };
  }
  // Directory browsing, commit history, one commit and the repository code
  // search all carry the repository context in their own address, so every
  // read-only view can be opened directly and survives a reload.
  if (tail[0] === "tree" && tail.length >= 2) {
    return { ...base, view: "tree", branch: tail[1], path: tail.slice(2).join("/") };
  }
  if (tail[0] === "commits" && tail.length <= 4) {
    return { ...base, view: "commits", branch: tail[1] ?? "", path: tail.slice(2).join("/") };
  }
  if (tail[0] === "commit" && tail.length === 2) {
    return { ...base, view: "commit", commitId: tail[1] };
  }
  // The new-file editor carries the branch it writes to, so the address can be
  // opened directly and survives a reload of the form.
  if (tail[0] === "new" && tail.length === 2) {
    return { ...base, view: "new-file", branch: tail[1] };
  }
  if (tail[0] === "search" && tail.length === 1) {
    return { ...base, view: "search" };
  }
  return null;
}
