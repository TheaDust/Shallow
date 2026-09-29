import { fetchRepository } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { fetchRepositoryFile } from "../../repo/repo-api";
import { formatTimestamp } from "../../org/format";
import { AccessDeniedMain, BusyMain, NotFoundPage } from "../common";
import { RepositoryShell } from "./RepositoryShell";

export interface RepositoryBlobPageProps {
  ownerName: string;
  repositoryName: string;
  branch?: string;
  path: string;
}

/**
 * REQ-3-3 file page: the stored content of one file on the current branch, its file
 * name and the most recent commit. Reading creates no change.
 */
export function RepositoryBlobPage({
  ownerName,
  repositoryName,
  branch,
  path,
}: RepositoryBlobPageProps) {
  const repository = useAsyncData(
    () => fetchRepository(ownerName, repositoryName),
    [ownerName, repositoryName],
  );
  const file = useAsyncData(
    () => fetchRepositoryFile(ownerName, repositoryName, { branch, path }),
    [ownerName, repositoryName, branch, path],
  );

  if (repository.status === "loading" || file.status === "loading") return <BusyMain />;
  if (repository.status === "error" || !repository.data) {
    if (repository.error && (repository.error.status === 401 || repository.error.status === 403)) {
      return <AccessDeniedMain />;
    }
    return <NotFoundPage />;
  }
  if (file.status === "error" || !file.data) {
    if (file.error && (file.error.status === 401 || file.error.status === 403)) {
      return <AccessDeniedMain />;
    }
    return <NotFoundPage />;
  }

  const detail = repository.data;
  const document = file.data.file;
  const latestCommit = file.data.commit;

  return (
    <RepositoryShell repository={detail} active="code">
      <h2 className="repository-blob__path">{document.path}</h2>
      <p className="repository-blob__context">Branch {document.branch}</p>
      {latestCommit ? (
        <p className="repository-blob__commit">
          {`${latestCommit.authorName} · ${latestCommit.message} · ${formatTimestamp(latestCommit.createdAt)}`}
        </p>
      ) : null}
      <pre className="repository-blob__content">{document.content}</pre>
    </RepositoryShell>
  );
}
