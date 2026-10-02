import { apiRequest } from "../lib/api";
import { fetchMyOrganizations } from "../organizations/api";
import type { RepositoryVisibility } from "../organizations/types";
import type {
  CreateRepositoryFileInput,
  CreateRepositoryInput,
  ForkRepositoryInput,
  RepositoryCodeSearch,
  RepositoryCommitDetail,
  RepositoryCommitHistory,
  RepositoryDirectory,
  RepositoryFileContent,
  RepositoryListItem,
  RepositoryNamespace,
  RepositoryOwnerKind,
  RepositoryOwnerList,
  RepositoryView,
} from "./types";

function ownerBase(ownerKind: RepositoryOwnerKind, owner: string): string {
  return ownerKind === "organization"
    ? `/api/organizations/${encodeURIComponent(owner)}`
    : `/api/users/${encodeURIComponent(owner)}`;
}

/**
 * One repository overview; both owner families return the same payload. A
 * non-empty `branch` reads the browsing snapshot of that branch, while an empty
 * one reads the repository default branch.
 */
export async function fetchRepositoryView(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  branch = "",
): Promise<RepositoryView> {
  const query = branch.length > 0 ? `?branch=${encodeURIComponent(branch)}` : "";
  const body = await apiRequest<{ repository: RepositoryView }>(
    `${ownerBase(ownerKind, owner)}/repositories/${encodeURIComponent(name)}${query}`,
  );
  return body.repository;
}

/**
 * Creates a named branch at the head of `baseBranch` (the default branch when
 * omitted) and returns the repository view of the new branch. The server decides
 * the write permission and the branch name rule again, so a rejected submission
 * reports the field error and creates nothing.
 */
export async function createBranch(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  branch: string,
  baseBranch = "",
): Promise<RepositoryView> {
  const body = await apiRequest<{ repository: RepositoryView }>("/api/repositories/branches", {
    method: "POST",
    body: JSON.stringify({ ownerKind, owner, name, branch, baseBranch }),
  });
  return body.repository;
}

/**
 * Points the repository default branch at an existing branch. Only the
 * repository administrator is accepted; the previous branch, its commits and
 * its files are left untouched.
 */
export async function changeDefaultBranch(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  branch: string,
): Promise<RepositoryView> {
  const body = await apiRequest<{ repository: RepositoryView }>("/api/repositories/default-branch", {
    method: "POST",
    body: JSON.stringify({ ownerKind, owner, name, branch }),
  });
  return body.repository;
}

/** Public repository directory of the home page. */
export async function fetchExploreRepositories(): Promise<RepositoryListItem[]> {
  const body = await apiRequest<{ repositories: RepositoryListItem[] }>("/api/explore/repositories");
  return body.repositories;
}

/**
 * Global repository search of the top search box. The server only returns
 * repositories the current viewer may read, so private repositories of other
 * owners never reach the result list.
 */
export async function searchRepositories(query: string): Promise<RepositoryListItem[]> {
  const params = new URLSearchParams({ q: query });
  const body = await apiRequest<{ repositories: RepositoryListItem[] }>(
    `/api/search/repositories?${params.toString()}`,
  );
  return body.repositories;
}

/** Personal repositories of one account that the current viewer may read. */
export async function fetchUserRepositories(username: string): Promise<RepositoryOwnerList> {
  return apiRequest<RepositoryOwnerList>(`/api/users/${encodeURIComponent(username)}/repositories`);
}

/**
 * The owner namespaces a signed-in account may create repositories in: its own
 * personal namespace plus every organization it owns.
 */
export async function fetchOwnerNamespaces(username: string): Promise<RepositoryNamespace[]> {
  const namespaces: RepositoryNamespace[] = [
    { kind: "account", id: username, label: username },
  ];
  const organizations = await fetchMyOrganizations();
  for (const organization of organizations) {
    if (organization.role !== "owner") continue;
    namespaces.push({ kind: "organization", id: organization.slug, label: organization.displayName });
  }
  return namespaces;
}

export async function createRepository(input: CreateRepositoryInput): Promise<RepositoryView> {
  const body = await apiRequest<{ repository: RepositoryView }>("/api/repositories", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.repository;
}

/**
 * Changes the visibility of one repository. The server decides whether the
 * signed-in account administers the repository; a rejected change leaves the
 * stored repository untouched.
 */
export async function changeRepositoryVisibility(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  visibility: RepositoryVisibility,
): Promise<RepositoryView> {
  const body = await apiRequest<{ repository: RepositoryView }>("/api/repositories/visibility", {
    method: "POST",
    body: JSON.stringify({ ownerKind, owner, name, visibility }),
  });
  return body.repository;
}

/** Creates an independent fork of a readable source repository. */
export async function forkRepository(
  sourceOwnerKind: RepositoryOwnerKind,
  sourceOwner: string,
  sourceName: string,
  input: ForkRepositoryInput,
): Promise<RepositoryView> {
  const body = await apiRequest<{ repository: RepositoryView }>(
    `${ownerBase(sourceOwnerKind, sourceOwner)}/repositories/${encodeURIComponent(sourceName)}/fork`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return body.repository;
}

/** Read-only content of one file on one branch of one repository. */
export async function fetchRepositoryFile(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  branch: string,
  path: string,
): Promise<RepositoryFileContent> {
  const query = new URLSearchParams({
    ownerKind,
    owner,
    name,
    branch,
    path,
  });
  const body = await apiRequest<{ file: RepositoryFileContent }>(`/api/repositories/files?${query.toString()}`);
  return body.file;
}

/**
 * Adds one file to the current branch through a single new commit and returns
 * the stored file. The server decides the write permission and the path and
 * commit-message rules again, so a rejected submission reports the reasons and
 * stores nothing.
 */
export async function createRepositoryFile(
  input: CreateRepositoryFileInput,
): Promise<RepositoryFileContent> {
  const body = await apiRequest<{ file: RepositoryFileContent }>("/api/repositories/files", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.file;
}

/** Directory listing of the current path on the current branch. */
export async function fetchRepositoryDirectory(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  branch: string,
  path: string,
): Promise<RepositoryDirectory> {
  const query = repositoryQuery(ownerKind, owner, name, { branch, path });
  const body = await apiRequest<{ directory: RepositoryDirectory }>(`/api/repositories/tree?${query}`);
  return body.directory;
}

/** Commit history of one branch, optionally narrowed to one file path. */
export async function fetchCommitHistory(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  branch: string,
  path = "",
): Promise<RepositoryCommitHistory> {
  const query = repositoryQuery(ownerKind, owner, name, { branch, path });
  const body = await apiRequest<{ history: RepositoryCommitHistory }>(`/api/repositories/commits?${query}`);
  return body.history;
}

/** Comparison of one commit with its parent revision. */
export async function fetchCommitDetail(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  commitId: string,
): Promise<RepositoryCommitDetail> {
  const query = repositoryQuery(ownerKind, owner, name, { id: commitId });
  const body = await apiRequest<{ commit: RepositoryCommitDetail }>(`/api/repositories/commit?${query}`);
  return body.commit;
}

/** Code search inside the current repository and branch. */
export async function searchRepositoryCode(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  query: string,
  branch = "",
): Promise<RepositoryCodeSearch> {
  const params = repositoryQuery(ownerKind, owner, name, { branch, q: query });
  const body = await apiRequest<{ search: RepositoryCodeSearch }>(`/api/repositories/code-search?${params}`);
  return body.search;
}

/** Query string that addresses one repository for the read-only views. */
function repositoryQuery(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  extra: Record<string, string>,
): string {
  const params = new URLSearchParams({ ownerKind, owner, name });
  for (const [key, value] of Object.entries(extra)) {
    if (value.length > 0) params.set(key, value);
  }
  return params.toString();
}

/** Read-only clone value shown in the repository Code popover. */
export function cloneValue(
  protocol: "https" | "ssh",
  owner: string,
  name: string,
  origin: string,
): string {
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    host = origin;
  }
  const path = `${owner}/${name}`;
  return protocol === "ssh" ? `git@${host}:${path}.git` : `${origin}/${path}.git`;
}
