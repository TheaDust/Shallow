// Code search inside one repository.
//
// Only the file content of a revision of the requested repository is read, and
// only after the viewer passed the repository-read rule, so a private
// repository can neither be searched nor leak a snippet into another
// repository's results. Searching never creates commits or changes files.

import {
  branchByName,
  branchNamesOf,
  commitById,
  filesOfCommit,
  normalizePath,
  publicRepositoryPayload,
  resolveRepositoryForViewer,
} from "./repository-code.mjs";

const LANGUAGE_BY_EXTENSION = new Map([
  [".md", "Markdown"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".js", "JavaScript"],
  [".json", "JSON"],
  [".txt", "Text"],
  [".css", "CSS"],
  [".html", "HTML"],
]);

export function languageOfPath(path) {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "Other";
  return LANGUAGE_BY_EXTENSION.get(path.slice(dot).toLowerCase()) ?? "Other";
}

/** The first matching line of a file, plus the number it sits on. */
function matchInContent(content, term) {
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLowerCase().includes(term)) {
      return { line: index + 1, snippet: lines[index] };
    }
  }
  return null;
}

export function createRepositoryCodeSearchService(store) {
  /**
   * Searches the readable file content of one repository revision. An empty
   * query answers with an empty result set, never with the whole file list.
   */
  async function searchForViewer(owner, repositoryName, options, accountId) {
    const state = await store.read();
    const resolved = resolveRepositoryForViewer(state, owner, repositoryName, accountId);
    if (resolved.status !== "ok") return resolved;
    const repository = resolved.repository;

    const branch = branchByName(
      state,
      repository.id,
      options?.branch ?? repository.defaultBranch,
    );
    if (!branch) return { status: "branch-not-found" };

    const path = normalizePath(options?.path ?? "");
    if (path === null) return { status: "not-found" };

    const language = typeof options?.language === "string" ? options.language.trim() : "";
    const term = typeof options?.q === "string" ? options.q.trim().toLowerCase() : "";
    const commit = commitById(state, branch.commitId);

    const files = filesOfCommit(commit)
      .map((file) => ({
        path: String(file?.path ?? ""),
        content: typeof file?.content === "string" ? file.content : "",
      }))
      .filter((file) => file.path.length > 0)
      .sort((left, right) => left.path.localeCompare(right.path));

    const results = [];
    for (const file of files) {
      if (path.length > 0 && !file.path.startsWith(path)) continue;
      const fileLanguage = languageOfPath(file.path);
      if (language.length > 0 && fileLanguage !== language) continue;
      if (term.length === 0) continue;
      const match = matchInContent(file.content, term);
      if (!match) continue;
      results.push({
        name: file.path.split("/").pop(),
        path: file.path,
        branch: branch.name,
        language: fileLanguage,
        line: match.line,
        snippet: match.snippet,
      });
    }

    return {
      status: "ok",
      codeSearch: {
        repository: publicRepositoryPayload(state, repository, accountId),
        branch: branch.name,
        branches: branchNamesOf(state, repository),
        query: typeof options?.q === "string" ? options.q.trim() : "",
        path,
        language,
        languages: [...new Set(files.map((file) => languageOfPath(file.path)))].sort((left, right) =>
          left.localeCompare(right),
        ),
        results,
      },
    };
  }

  return { searchForViewer };
}
