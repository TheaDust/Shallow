import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { formatRelativeTime } from "../lib/format";
import { fetchRepositoryCommits } from "../lib/org-api";
import { repositoryCodeHash, repositoryCommitHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Read-only commit history of the repository's default branch, newest first,
 * optionally narrowed to the commits that changed one file path. Every record
 * links to its own detail view; nothing here writes to the repository.
 */
export function RepositoryCommitsPage({
  owner,
  name,
  path = "",
  branch = "",
}: {
  owner: string;
  name: string;
  path?: string;
  branch?: string;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchRepositoryCommits(owner, name, path, branch),
    [owner, name, path, branch],
  );

  return (
    <main className="page">
      <section className="page__body repository-commits">
        {status === "loading" ? <LoadingNote label="Loading commits…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {status === "ready" && data ? (
          <>
            <RepositoryBreadcrumb
              repository={data.repository}
              path={path}
              branch={data.branch === data.defaultBranch ? undefined : data.branch}
            />
            <h1 className="repository__title">Commits</h1>
            <p className="repository-commits__branch">
              Branch:{" "}
              <a
                href={repositoryCodeHash(
                  data.repository.owner.id,
                  data.repository.name,
                  "",
                  data.branch === data.defaultBranch ? undefined : data.branch,
                )}
              >
                {data.branch}
              </a>
              {data.path ? <span className="repository-commits__path"> · {data.path}</span> : null}
            </p>
            {data.commits.length === 0 ? (
              <p className="repository-commits__empty">This branch has no commits yet.</p>
            ) : (
              <ul className="repository-commits__list">
                {data.commits.map((commit) => (
                  <li key={commit.id} className="repository-commits__item">
                    <a
                      className="repository-commits__message"
                      href={repositoryCommitHash(data.repository.owner.id, data.repository.name, commit.id)}
                    >
                      {commit.message}
                    </a>
                    <span className="repository-commits__meta">
                      {commit.authorName} committed {formatRelativeTime(commit.createdAt)}
                    </span>
                    <span className="repository-commits__id">{commit.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
