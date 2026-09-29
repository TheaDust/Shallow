import { repositoryBlobHash, repositoryCommitsHash, repositoryTreeHash } from "../../repo/repo-api";
import { fetchRepository } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { AccessDeniedMain, BusyMain, NotFoundPage } from "../common";
import { ClonePopover } from "./ClonePopover";
import { RepositoryShell } from "./RepositoryShell";

export interface RepositoryOverviewPageProps {
  ownerName: string;
  repositoryName: string;
}

/**
 * REQ-3-3 overview: the repository identity (“owner/repository name”), the owner,
 * name, visibility marker, description and default branch, the file list of the
 * default branch, the commit history entry and the clone popover (REQ-3-2-3).
 * A private repository the viewer may not read is answered with sign-in or
 * access-denied instead.
 */
export function RepositoryOverviewPage({ ownerName, repositoryName }: RepositoryOverviewPageProps) {
  const repository = useAsyncData(
    () => fetchRepository(ownerName, repositoryName),
    [ownerName, repositoryName],
  );

  if (repository.status === "loading") return <BusyMain />;
  if (repository.status === "error" || !repository.data) {
    if (repository.error && (repository.error.status === 401 || repository.error.status === 403)) {
      return <AccessDeniedMain />;
    }
    return <NotFoundPage />;
  }

  const detail = repository.data;
  const branch = detail.defaultBranch ?? "main";
  const files = detail.files ?? [];
  const commitCount = detail.commitCount ?? 0;

  return (
    <RepositoryShell repository={detail}>
      <div className="repository-overview__actions">
        <ClonePopover ownerName={detail.ownerName} repositoryName={detail.name} />
      </div>
      <p className="repository-overview__description">{detail.description}</p>
      <dl className="repository-overview__facts">
        <dt>Owner</dt>
        <dd>{detail.ownerName}</dd>
        <dt>Name</dt>
        <dd>{detail.name}</dd>
        <dt>Default branch</dt>
        <dd>{branch}</dd>
      </dl>
      <section className="repository-overview__files" aria-label="Files">
        <h2>Files</h2>
        {files.length === 0 ? (
          <p role="status">This repository has no files on the default branch yet.</p>
        ) : (
          <ul className="repository-file-list">
            {files.map((entry) => (
              <li key={entry.path}>
                <a
                  href={
                    entry.type === "directory"
                      ? repositoryTreeHash(detail.ownerName, detail.name, branch, entry.path)
                      : repositoryBlobHash(detail.ownerName, detail.name, branch, entry.path)
                  }
                >
                  {entry.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="repository-overview__commits">
        <a href={repositoryCommitsHash(detail.ownerName, detail.name)}>Commits</a>
        <span aria-hidden="true" className="repository-overview__separator">
          ·
        </span>
        <span className="repository-overview__commit-count">
          {`${commitCount} ${commitCount === 1 ? "commit" : "commits"}`}
        </span>
      </p>
    </RepositoryShell>
  );
}
