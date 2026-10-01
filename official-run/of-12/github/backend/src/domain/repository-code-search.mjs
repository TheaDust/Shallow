/**
 * Code search inside one repository (REQ-4-2-3).
 *
 * The search reads the stored file content of the repository's own branches —
 * the default branch first — and answers with the matching files, the matching
 * lines and the branch each match was read from. It is a read-only view: it
 * never writes a file, a commit or a branch, and it can only ever return
 * content of the repository it was asked about, so a private repository's
 * content cannot leak into another repository's results.
 */

import { branchFilePaths, findRepositoryCommit, repositoryBranchList } from "./repository-branches.mjs";
import { splitLines } from "./repository-diff.mjs";

/** How many matching lines of one file are handed to the results page. */
const SNIPPET_LINES = 3;

const LANGUAGE_BY_EXTENSION = new Map([
  ["md", "Markdown"],
  ["ts", "TypeScript"],
  ["tsx", "TypeScript"],
  ["js", "JavaScript"],
  ["mjs", "JavaScript"],
  ["json", "JSON"],
  ["css", "CSS"],
  ["html", "HTML"],
  ["yml", "YAML"],
  ["yaml", "YAML"],
  ["sh", "Shell"],
  ["txt", "Text"],
]);

/** The language a path belongs to, derived from its extension. */
export function fileLanguage(path) {
  const name = String(path ?? "");
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  return LANGUAGE_BY_EXTENSION.get(extension) ?? "Other";
}

/** The file name of a path, as the results page links it. */
export function fileName(path) {
  const segments = String(path ?? "").split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : String(path ?? "");
}

/** Every language the repository stores files in, sorted for the filter. */
export function repositoryLanguages(repository) {
  const languages = new Set();
  for (const branch of repositoryBranchList(repository)) {
    for (const path of branchFilePaths(repository, branch.name)) languages.add(fileLanguage(path));
  }
  return [...languages].sort();
}

function repositoryCommitOfBranch(repository, branchName) {
  const branch = repositoryBranchList(repository).find((candidate) => candidate.name === branchName);
  if (!branch) return null;
  return findRepositoryCommit(repository, branch.headId);
}

/**
 * The matching files of the repository, newest snapshot first: the default
 * branch is searched before the other branches and a path counts once, so the
 * same file is not listed twice.
 */
export function searchRepositoryCode(repository, { query, path, language } = {}) {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  const pathFilter = typeof path === "string" ? path.trim().toLowerCase() : "";
  const languageFilter = typeof language === "string" ? language.trim().toLowerCase() : "";
  const languages = repositoryLanguages(repository);
  if (!needle) return { query: query ?? "", path: path ?? "", language: language ?? "", languages, results: [] };

  const branches = repositoryBranchList(repository);
  const defaultBranch = repository?.defaultBranch;
  const ordered = [
    ...branches.filter((branch) => branch.name === defaultBranch),
    ...branches.filter((branch) => branch.name !== defaultBranch),
  ];

  const results = [];
  const matchedPaths = new Set();
  for (const branch of ordered) {
    const commit = repositoryCommitOfBranch(repository, branch.name);
    for (const file of Array.isArray(commit?.tree) ? commit.tree : []) {
      const filePath = String(file.path ?? "");
      if (!filePath || matchedPaths.has(filePath)) continue;
      if (pathFilter && !filePath.toLowerCase().includes(pathFilter)) continue;
      if (languageFilter && fileLanguage(filePath).toLowerCase() !== languageFilter) continue;
      const lines = splitLines(file.content)
        .map((text, index) => ({ number: index + 1, text }))
        .filter((line) => line.text.toLowerCase().includes(needle));
      if (lines.length === 0) continue;
      matchedPaths.add(filePath);
      results.push({
        path: filePath,
        name: fileName(filePath),
        branch: branch.name,
        language: fileLanguage(filePath),
        matches: lines.length,
        lines: lines.slice(0, SNIPPET_LINES),
        snippet: lines[0].text.trim(),
      });
    }
  }
  results.sort((left, right) => left.path.localeCompare(right.path));
  return { query, path: path ?? "", language: language ?? "", languages, results };
}
