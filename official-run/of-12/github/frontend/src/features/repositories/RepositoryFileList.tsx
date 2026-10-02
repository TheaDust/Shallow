import type { RepositoryDirectoryEntry, RepositorySummary } from "./repository-api";
import { blobHref, treeHref } from "./repository-links";

export interface RepositoryFileListProps {
  repository: RepositorySummary;
  entries: RepositoryDirectoryEntry[];
  /** The branch the listing was read from; the default branch when omitted. */
  branch?: string | null;
}

/**
 * Branch listing of a Code page (REQ-3-3, REQ-4-1): every row names one file or
 * directory of the current directory, the entry link accessible name is exactly
 * the directory or file name, and a file name opens the read-only file page of
 * the current branch.
 */
export function RepositoryFileList({ repository, entries, branch }: RepositoryFileListProps) {
  const currentBranch = branch ?? repository.defaultBranch ?? "main";
  return (
    <section className="repository-files" aria-label="Files">
      <ul className="repository-files__list">
        {entries.map((entry) => (
          <li key={entry.path} className="repository-files__row" aria-label={entry.path}>
            <a
              className="repository-files__name"
              href={
                entry.type === "directory"
                  ? treeHref(repository, currentBranch, entry.path)
                  : blobHref(repository, currentBranch, entry.path)
              }
            >
              {entry.name}
            </a>
            <span className="repository-files__type">{entry.type === "directory" ? "Directory" : "File"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
