import { fetchRepository } from "../../org/org-api";
import { formatTimestamp } from "../../org/format";
import { useAsyncData } from "../../org/use-async-data";
import { fetchRepositoryCommits } from "../../repo/repo-api";
import { AccessDeniedMain, BusyMain, NotFoundPage } from "../common";
import { RepositoryShell } from "./RepositoryShell";

export interface RepositoryCommitsPageProps {
  ownerName: string;
  repositoryName: string;
}

/**
 * Commit history of the repository on its default branch (REQ-3-2-1: a newly
 * initialized repository lists exactly one initialization commit).
 */
export function RepositoryCommitsPage({ ownerName, repositoryName }: RepositoryCommitsPageProps) {
  const repository = useAsyncData(
    () => fetchRepository(ownerName, repositoryName),
    [ownerName, repositoryName],
  );
  const history = useAsyncData(
    () => fetchRepositoryCommits(ownerName, repositoryName),
    [ownerName, repositoryName],
  );

  if (repository.status === "loading" || history.status === "loading") return <BusyMain />;
  if (repository.status === "error" || !repository.data) {
    if (repository.error && (repository.error.status === 401 || repository.error.status === 403)) {
      return <AccessDeniedMain />;
    }
    return <NotFoundPage />;
  }
  if (history.status === "error" || !history.data) return <NotFoundPage />;

  const commits = history.data.commits;
  return (
    <RepositoryShell repository={repository.data} active="code">
      <h2>Commits</h2>
      <p className="repository-code__context">Branch {history.data.branch}</p>
      {commits.length === 0 ? (
        <p role="status">No commits yet.</p>
      ) : (
        <ol className="repository-commit-list">
          {commits.map((commit) => (
            <li key={commit.id}>
              <span className="repository-commit-list__message">{commit.message}</span>
              <span className="repository-commit-list__meta">
                {`${commit.authorName} · ${formatTimestamp(commit.createdAt)}`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </RepositoryShell>
  );
}
