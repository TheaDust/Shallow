import { repositoryBlobHref, repositoryTreeHref } from "../lib/repository-routes";
import type { RepositoryEntry } from "../lib/repositories-api";

export interface RepositoryEntryListProps {
  owner: string;
  name: string;
  branch: string;
  entries: RepositoryEntry[];
}

/**
 * Files and directories at the current path. Every entry is a link whose
 * accessible name is exactly the directory or file name (REQ-4-1).
 */
export function RepositoryEntryList({ owner, name, branch, entries }: RepositoryEntryListProps) {
  if (entries.length === 0) {
    return <p className="repository-file-list__empty">This directory has no files yet.</p>;
  }
  return (
    <ul className="repository-file-list">
      {entries.map((entry) => (
        <li key={entry.path} className="repository-file-list__item">
          <a
            href={
              entry.type === "dir"
                ? repositoryTreeHref(owner, name, branch, entry.path)
                : repositoryBlobHref(owner, name, branch, entry.path)
            }
          >
            {entry.name}
          </a>
        </li>
      ))}
    </ul>
  );
}
