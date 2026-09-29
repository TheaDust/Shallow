import { apiRequest } from "../lib/api";
import { postForm } from "../lib/api-form";
import { repositoryHash } from "../org/org-api";
import type {
  CloneProtocol,
  RepositoryCommit,
  RepositoryDetail,
  RepositoryFileContent,
  RepositoryFileEntry,
  RepositoryFormErrors,
  RepositoryFormValues,
  RepositoryOwnerOption,
  RepositorySummary,
} from "./types";

/**
 * Same-origin JSON calls of the repository module (REQ-3-2-1 creation, REQ-3-3
 * content, REQ-3-2-3 clone values). The server re-checks the session, the target
 * namespace and the file permissions of every request; these helpers only shape
 * the payloads and the hash addresses.
 */

export function newRepositoryHash(): string {
  return "#/new";
}

/** `#/repositories` — the personal repositories list of the signed-in account. */
export function yourRepositoriesHash(): string {
  return "#/repositories";
}

export function repositoryCodeHash(ownerName: string, repositoryName: string): string {
  return `${repositoryHash(ownerName, repositoryName)}/code`;
}

export function repositoryTreeHash(
  ownerName: string,
  repositoryName: string,
  branch: string,
  path: string,
): string {
  const suffix = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
  return `${repositoryHash(ownerName, repositoryName)}/tree/${encodeURIComponent(branch)}${suffix}`;
}

export function repositoryBlobHash(
  ownerName: string,
  repositoryName: string,
  branch: string,
  path: string,
): string {
  const suffix = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
  return `${repositoryHash(ownerName, repositoryName)}/blob/${encodeURIComponent(branch)}${suffix}`;
}

export function repositoryCommitsHash(ownerName: string, repositoryName: string): string {
  return `${repositoryHash(ownerName, repositoryName)}/commits`;
}

export function repositoryIssuesHash(ownerName: string, repositoryName: string): string {
  return `${repositoryHash(ownerName, repositoryName)}/issues`;
}

export function repositoryPullRequestsHash(ownerName: string, repositoryName: string): string {
  return `${repositoryHash(ownerName, repositoryName)}/pulls`;
}

function repositoryPath(ownerName: string, repositoryName: string, suffix = ""): string {
  return `/api/repositories/${encodeURIComponent(ownerName)}/${encodeURIComponent(repositoryName)}${suffix}`;
}

/**
 * REQ-3-2-3: the read-only clone address of the current repository. The HTTPS form
 * is a `https://` URL with the `.git` suffix, the SSH form uses the `git@host:`
 * colon syntax; both carry the owner and repository name.
 */
export function cloneValue(
  protocol: CloneProtocol,
  ownerName: string,
  repositoryName: string,
): string {
  const host =
    typeof window !== "undefined" && window.location.host ? window.location.host : "localhost";
  const path = `${ownerName}/${repositoryName}.git`;
  return protocol === "ssh" ? `git@${host}:${path}` : `https://${host}/${path}`;
}

/** Namespaces the signed-in account may create a repository in. */
export async function fetchRepositoryOwners(): Promise<RepositoryOwnerOption[]> {
  const body = await apiRequest<{ owners: RepositoryOwnerOption[] }>("/api/repository-owners");
  return body.owners;
}

/** The personal repositories of the signed-in account. */
export async function fetchMyRepositories(): Promise<RepositorySummary[]> {
  const body = await apiRequest<{ repositories: RepositorySummary[] }>(
    "/api/repositories?scope=mine",
  );
  return body.repositories;
}

/** REQ-3-2-1: creates the repository and, on request, its README initialization commit. */
export async function createRepository(
  values: RepositoryFormValues,
): Promise<{ ok: true; repository: RepositoryDetail } | { ok: false; errors: RepositoryFormErrors }> {
  const response = await postForm<{ repository: RepositoryDetail }, RepositoryFormErrors>(
    "/api/repositories",
    "POST",
    values,
  );
  return response.ok
    ? { ok: true, repository: response.result.repository }
    : { ok: false, errors: response.errors };
}

export async function fetchRepositoryContents(
  ownerName: string,
  repositoryName: string,
  options: { branch?: string; path?: string } = {},
): Promise<{ branch: string; path: string; entries: RepositoryFileEntry[] }> {
  const params = new URLSearchParams();
  if (options.branch) params.set("branch", options.branch);
  if (options.path) params.set("path", options.path);
  const query = params.toString();
  const body = await apiRequest<{ branch: string; path: string; entries: RepositoryFileEntry[] }>(
    repositoryPath(ownerName, repositoryName, `/contents${query ? `?${query}` : ""}`),
  );
  return {
    branch: body.branch,
    path: body.path ?? "",
    entries: body.entries ?? [],
  };
}

export async function fetchRepositoryFile(
  ownerName: string,
  repositoryName: string,
  options: { branch?: string; path: string },
): Promise<{ file: RepositoryFileContent; commit: RepositoryCommit | null }> {
  const params = new URLSearchParams();
  if (options.branch) params.set("branch", options.branch);
  params.set("path", options.path);
  const body = await apiRequest<{
    file: RepositoryFileContent;
    commit: { message: string; authorName: string; createdAt: string | null } | null;
  }>(repositoryPath(ownerName, repositoryName, `/file?${params.toString()}`));
  return {
    file: body.file,
    commit: body.commit
      ? { id: "", ...body.commit, changedPaths: [] }
      : null,
  };
}

export async function fetchRepositoryCommits(
  ownerName: string,
  repositoryName: string,
  options: { branch?: string } = {},
): Promise<{ branch: string; commits: RepositoryCommit[] }> {
  const params = new URLSearchParams();
  if (options.branch) params.set("branch", options.branch);
  const query = params.toString();
  const body = await apiRequest<{ branch: string; commits: RepositoryCommit[] }>(
    repositoryPath(ownerName, repositoryName, `/commits${query ? `?${query}` : ""}`),
  );
  return { branch: body.branch, commits: body.commits ?? [] };
}
