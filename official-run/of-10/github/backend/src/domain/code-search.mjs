/**
 * Code search (REQ-4-2-3).
 *
 * Only file contents of branches the viewer may read are searched: a search in
 * one repository never carries content of another one, and a viewer without
 * access to a repository gets no result from it. The result describes the same
 * revision the Code page shows, so searching never writes and never disagrees
 * with a file read.
 */

import { branchHead, revisionFiles } from "./commit-graph.mjs";
import { splitLines } from "./line-diff.mjs";
import { canViewRepository, resolveBranch, toRepositorySummary } from "./repositories.mjs";

/** Upper bound of one search answer, so an unscoped search stays bounded. */
export const MAX_CODE_RESULTS = 50;

/** Results of one repository, or null when the viewer may not read it. */
export function searchRepositoryCode(state, viewer, repository, query, { branch, path } = {}) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle || !repository || !canViewRepository(state, repository, viewer)) return null;
  const resolvedBranch = resolveBranch(repository, branch);
  if (!resolvedBranch) return null;
  const head = branchHead(repository, resolvedBranch);
  const scope = String(path ?? "").trim().toLowerCase();
  const results = [];
  if (!head) return { branch: resolvedBranch, results };

  for (const file of revisionFiles(repository, head.id)) {
    if (scope && !file.path.toLowerCase().includes(scope)) continue;
    const lines = splitLines(file.content);
    const matches = [];
    lines.forEach((text, index) => {
      if (text.toLowerCase().includes(needle)) matches.push({ text, line: index + 1 });
    });
    if (matches.length === 0) continue;
    results.push({
      path: file.path,
      name: file.path.split("/").pop(),
      branch: resolvedBranch,
      line: matches[0].line,
      snippet: matches[0].text.trim(),
      matches: matches.length,
      repository: {
        owner: repository.owner.login,
        name: repository.name,
        fullName: `${repository.owner.login}/${repository.name}`,
      },
    });
  }
  return { branch: resolvedBranch, results };
}

/**
 * Code search of one repository the caller named, or — when no repository is
 * named — of every repository the viewer may read. Both answer the same shape:
 * `repository` describes the single searched repository of a scoped search and
 * `null` for the unscoped one.
 */
export function searchCode(state, viewer, repositories, query, { branch, path, repository } = {}) {
  const scanner = Array.isArray(repositories) ? repositories : [repositories];
  const needle = String(query ?? "").trim();
  const empty = { repository: null, results: [] };
  if (!needle) return empty;

  if (repository) {
    const found = searchRepositoryCode(state, viewer, repository, needle, { branch, path });
    return {
      repository: found ? { ...toRepositorySummary(repository, state), branch: found.branch } : null,
      results: found ? found.results : [],
    };
  }

  const results = [];
  for (const candidate of scanner) {
    if (results.length >= MAX_CODE_RESULTS) break;
    const found = searchRepositoryCode(state, viewer, candidate, needle, { path });
    if (found) results.push(...found.results);
  }
  return { repository: null, results: results.slice(0, MAX_CODE_RESULTS) };
}
