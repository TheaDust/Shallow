import { makeHash } from "../../lib/hash-route";
import type { RepositorySummary } from "./repository-api";

/**
 * Addresses of the Code page family (REQ-4-1, REQ-4-4): the Code page itself,
 * a directory, a file, the file editor and the commit history. A page entry
 * without a branch reads the default branch, so a repository address stays
 * stable; a selected branch travels in the address and therefore survives a
 * reload.
 */

export function repositoryBase(repository: RepositorySummary): string {
  return `#/${repository.owner}/${repository.name}`;
}

export function isDefaultBranch(repository: RepositorySummary, branch?: string | null): boolean {
  return !branch || branch === (repository.defaultBranch ?? "main");
}

/** The Code page of a branch; the default branch keeps the plain address. */
export function codeHref(repository: RepositorySummary, branch?: string | null): string {
  const base = repositoryBase(repository);
  if (isDefaultBranch(repository, branch)) return base;
  return `${base}/code/${encodeURIComponent(branch as string)}`;
}

export function treeHref(repository: RepositorySummary, branch: string, path: string): string {
  return `${repositoryBase(repository)}/tree/${encodeURIComponent(branch)}/${path}`;
}

export function blobHref(repository: RepositorySummary, branch: string, path: string): string {
  return `${repositoryBase(repository)}/blob/${encodeURIComponent(branch)}/${path}`;
}

export function newFileHref(repository: RepositorySummary, branch: string): string {
  return `${repositoryBase(repository)}/new/${encodeURIComponent(branch)}`;
}

export function editFileHref(repository: RepositorySummary, branch: string, path: string): string {
  return `${repositoryBase(repository)}/edit/${encodeURIComponent(branch)}/${path}`;
}

/** The branch history address, carrying the branch only when it is not the default one. */
export function commitsHref(repository: RepositorySummary, branch?: string | null): string {
  const base = `${repositoryBase(repository)}/commits`;
  return isDefaultBranch(repository, branch) ? base : `${base}?branch=${encodeURIComponent(branch as string)}`;
}

/**
 * The history address of one file of a branch (REQ-4-2-1): only the commits
 * that modified that file are readable there.
 */
export function fileHistoryHref(repository: RepositorySummary, branch: string, path: string): string {
  const params = new URLSearchParams();
  if (!isDefaultBranch(repository, branch)) params.set("branch", branch);
  params.set("path", path);
  return `${repositoryBase(repository)}/commits?${params.toString()}`;
}

/** The address of one commit entry and its comparison with its parent (REQ-4-2-2). */
export function commitHref(repository: RepositorySummary, commitId: string): string {
  return `${repositoryBase(repository)}/commit/${encodeURIComponent(commitId)}`;
}

/** The address of one changed file of a commit comparison. */
export function commitFileHref(repository: RepositorySummary, commitId: string, path: string): string {
  return `${commitHref(repository, commitId)}?file=${encodeURIComponent(path)}`;
}

/** The comparison address of the repository; revisions travel in the query. */
export function compareHref(repository: RepositorySummary, base?: string | null, compare?: string | null): string {
  const params = new URLSearchParams();
  if (base) params.set("base", base);
  if (compare) params.set("compare", compare);
  const query = params.toString();
  return `${repositoryBase(repository)}/compare${query ? `?${query}` : ""}`;
}

/**
 * The repository-scoped code search address (REQ-4-2-3). The results page reads
 * this address, so a search survives a reload and a query can be repeated.
 */
export function codeSearchHref(
  owner: string,
  name: string,
  options: { query: string; path?: string; language?: string },
): string {
  const params = new URLSearchParams();
  if (options.query) params.set("q", options.query);
  params.set("type", "code");
  params.set("repo", `${owner}/${name}`);
  if (options.path) params.set("path", options.path);
  if (options.language) params.set("language", options.language);
  return makeHash("/search", params);
}

/**
 * The pull-request addresses of a repository (REQ-6): the list page and one
 * pull request. The active section of a detail page travels in the query, so a
 * reload opens the same section again.
 */
export function pullsHref(repository: RepositorySummary): string {
  return `${repositoryBase(repository)}/pulls`;
}

export function pullHref(repository: RepositorySummary, number: number | string, tab?: string): string {
  const base = `${repositoryBase(repository)}/pulls/${encodeURIComponent(String(number))}`;
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
}
