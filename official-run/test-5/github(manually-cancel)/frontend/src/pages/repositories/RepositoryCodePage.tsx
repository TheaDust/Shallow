import { fetchRepository } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import {
  fetchRepositoryContents,
  repositoryBlobHash,
  repositoryTreeHash,
} from "../../repo/repo-api";
import { AccessDeniedMain, BusyMain, NotFoundPage } from "../common";
import { RepositoryShell } from "./RepositoryShell";

export interface RepositoryCodePageProps {
  ownerName: string;
  repositoryName: string;
  /** Branch of the view; the repository default branch when omitted by the address. */
  branch?: string;
  /** Directory inside the branch; the branch root when omitted. */
  path?: string;
}

/**
 * REQ-3-3 / REQ-4 code browsing: files and directories of the current branch and
 * path. Directories are links into the same view, files are links to their
 * read-only content page.
 */
export function RepositoryCodePage({
  ownerName,
  repositoryName,
  branch,
  path = "",
}: RepositoryCodePageProps) {
  const repository = useAsyncData(
    () => fetchRepository(ownerName, repositoryName),
    [ownerName, repositoryName],
  );
  const contents = useAsyncData(
    () => fetchRepositoryContents(ownerName, repositoryName, { branch, path }),
    [ownerName, repositoryName, branch, path],
  );

  if (repository.status === "loading" || contents.status === "loading") return <BusyMain />;
  if (repository.status === "error" || !repository.data) {
    if (repository.error && (repository.error.status === 401 || repository.error.status === 403)) {
      return <AccessDeniedMain />;
    }
    return <NotFoundPage />;
  }
  if (contents.status === "error" || !contents.data) return <NotFoundPage />;

  const detail = repository.data;
  const entries = contents.data.entries;
  const currentPath = contents.data.path;
  const currentBranch = contents.data.branch;

  return (
    <RepositoryShell repository={detail} active="code">
      <p className="repository-code__context">
        Branch <strong>{currentBranch}</strong>
        {currentPath ? ` · ${currentPath}` : ""}
      </p>
      <h2>Files</h2>
      {entries.length === 0 ? (
        <p role="status">This directory is empty.</p>
      ) : (
        <ul className="repository-file-list">
          {entries.map((entry) => (
            <li key={entry.path}>
              <a
                href={
                  entry.type === "directory"
                    ? repositoryTreeHash(detail.ownerName, detail.name, currentBranch, entry.path)
                    : repositoryBlobHash(detail.ownerName, detail.name, currentBranch, entry.path)
                }
              >
                {entry.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </RepositoryShell>
  );
}
