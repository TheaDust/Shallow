import { repositoryPath, repositoryBlobSuffix, repositoryTreeSuffix } from "./routes";
import type { RepositoryDirectoryEntry, RepositoryOwnerKind } from "./types";

export interface RepositoryFileListProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  branch: string;
  entries: readonly RepositoryDirectoryEntry[];
  /** Shown while the current path holds no entry at all. */
  emptyLabel?: string;
}

/**
 * Files and directories at one path on one branch, used by the repository Code
 * area and by every directory page of the branch. Directory and file entries
 * are links with their exact accessible names: the visible trailing slash of a
 * directory stays out of the accessible name, and a directory links to the
 * listing of the path it identifies.
 */
export function RepositoryFileList({
  ownerKind,
  owner,
  name,
  branch,
  entries,
  emptyLabel = "This repository does not contain any file yet.",
}: RepositoryFileListProps) {
  if (entries.length === 0) {
    return <p className="repository-code__empty">{emptyLabel}</p>;
  }
  return (
    <ul className="repository-files">
      {entries.map((entry) => (
        <li key={entry.path} className="repository-files__item">
          <a
            className="repository-files__name"
            href={`#${repositoryPath(
              ownerKind,
              owner,
              name,
              entry.kind === "directory"
                ? repositoryTreeSuffix(branch, entry.path)
                : repositoryBlobSuffix(branch, entry.path),
            )}`}
          >
            {entry.name}
            {entry.kind === "directory" ? (
              <span className="repository-files__marker" aria-hidden="true">/</span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
