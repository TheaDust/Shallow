import {
  repositoryCodeHref,
  type RepositoryEntry,
} from "../../lib/repository-code-api";

export interface RepositoryFileListProps {
  owner: string;
  name: string;
  branch: string;
  entries: RepositoryEntry[];
}

/**
 * Directory listing of one revision. Each entry is a link whose accessible
 * name is exactly the entry name, so a directory and a file with the same name
 * stay distinguishable by their distinct addresses.
 */
export function RepositoryFileList({ owner, name, branch, entries }: RepositoryFileListProps) {
  if (entries.length === 0) {
    return (
      <section className="repository-files" aria-label="Files">
        <p role="status">This directory is empty.</p>
      </section>
    );
  }

  return (
    <section className="repository-files" aria-label="Files">
      <ul className="repository-files__list">
        {entries.map((entry) => (
          <li key={entry.path} className="repository-files__item">
            <a
              href={repositoryCodeHref(
                owner,
                name,
                entry.type === "directory" ? "tree" : "blob",
                branch,
                entry.path,
              )}
            >
              {entry.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
