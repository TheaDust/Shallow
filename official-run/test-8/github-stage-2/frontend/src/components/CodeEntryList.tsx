import type { RepositoryTreeEntry } from "../api/organizations";
import { makeHash } from "../lib/hash-route";
import { blobPath, treePath } from "../lib/repository-paths";

export interface CodeEntryListProps {
  ownerLogin: string;
  repositoryName: string;
  branch: string;
  entries: RepositoryTreeEntry[];
}

/**
 * The files and directories at one path of a branch. A directory is only a path
 * hierarchy, so every entry is a link whose accessible name is exactly the
 * entry name — the trailing slash of a directory is drawn, never part of the
 * link text.
 */
export function CodeEntryList({ ownerLogin, repositoryName, branch, entries }: CodeEntryListProps) {
  if (entries.length === 0) {
    return <p className="code-list__empty">This repository is empty.</p>;
  }
  return (
    <ul className="code-list">
      {entries.map((entry) => (
        <li className={`code-list__item code-list__item--${entry.type}`} key={entry.path}>
          <a
            className="code-list__link"
            href={makeHash(
              entry.type === "directory"
                ? treePath(ownerLogin, repositoryName, branch, entry.path)
                : blobPath(ownerLogin, repositoryName, branch, entry.path),
            )}
          >
            {entry.name}
          </a>
        </li>
      ))}
    </ul>
  );
}
