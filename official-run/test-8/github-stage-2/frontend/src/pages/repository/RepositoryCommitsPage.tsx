import { fetchRepositoryCommits } from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { CodeBreadcrumb } from "../../components/CodeBreadcrumb";
import { RepositoryNav } from "../../components/RepositoryNav";
import { RepositorySearchBox } from "../../components/RepositorySearchBox";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash } from "../../lib/hash-route";
import { commitPath } from "../../lib/repository-paths";
import { absoluteTime, relativeTime } from "../../lib/relative-time";
import { useAsyncData } from "../../lib/useAsyncData";

/**
 * Commit history of a branch, or of one file path (REQ-4-2-1). Records are
 * immutable changes shown newest first; the page is read-only and every entry
 * opens the commit detail of that change.
 */
export function RepositoryCommitsPage({
  ownerLogin,
  repositoryName,
  branch,
  path,
}: {
  ownerLogin: string;
  repositoryName: string;
  branch: string;
  path: string;
}) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(
    () => fetchRepositoryCommits(ownerLogin, repositoryName, branch, path),
    [ownerLogin, repositoryName, branch, path],
  );
  const repository = data?.repository ?? null;
  const ownerName = repository?.owner?.displayName ?? ownerLogin;
  const commits = data?.commits ?? [];

  return (
    <main>
      <SiteHeader account={account} showGlobalSearch={false} />
      <CodeBreadcrumb
        ownerLogin={ownerLogin}
        ownerName={ownerName}
        repositoryName={repositoryName}
        branch={branch}
        path={data?.path ?? path}
        kind={path ? "file" : "directory"}
      />
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {data && !error ? (
        <>
          <RepositoryNav
            ownerLogin={ownerLogin}
            repositoryName={repositoryName}
            branch={data.branch}
            active="commits"
          />
          <RepositorySearchBox ownerLogin={ownerLogin} repositoryName={repositoryName} />
          <h1>Commit history</h1>
          <p className="revision-context">
            Branch <code className="revision-context__value">{data.branch}</code>
          </p>
          {commits.length === 0 ? (
            <p className="commit-list__empty">No commits yet.</p>
          ) : (
            <ol className="commit-list">
              {commits.map((commit) => (
                <li className="commit-list__item" key={commit.id}>
                  <h2 className="commit-list__message">
                    <a
                      className="commit-list__link"
                      href={makeHash(commitPath(ownerLogin, repositoryName, commit.id))}
                    >
                      {commit.message}
                    </a>
                  </h2>
                  <p className="commit-list__meta">
                    <a
                      className="commit-list__id"
                      href={makeHash(commitPath(ownerLogin, repositoryName, commit.id))}
                    >
                      {commit.shortId}
                    </a>
                    <span aria-hidden="true"> · </span>
                    <span className="commit-list__author">{commit.author}</span>
                    <span aria-hidden="true"> · </span>
                    <time className="commit-list__time" dateTime={absoluteTime(commit.createdAt)}>
                      {relativeTime(commit.createdAt)}
                    </time>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </main>
  );
}
