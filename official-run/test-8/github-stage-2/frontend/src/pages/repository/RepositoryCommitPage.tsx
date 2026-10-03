import { fetchRepositoryCommit } from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { RepositoryNav } from "../../components/RepositoryNav";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash } from "../../lib/hash-route";
import { blobPath, commitPath, repositoryPath } from "../../lib/repository-paths";
import { absoluteTime, relativeTime } from "../../lib/relative-time";
import { useAsyncData } from "../../lib/useAsyncData";

/**
 * One immutable commit with the comparison against its parent revision
 * (REQ-4-2-2). The page is read-only: it lists the changed files with their
 * numeric additions and deletions and the line-by-line comparison (base = the
 * parent revision, compare = this commit) without creating a review, comment,
 * commit or branch change.
 */
export function RepositoryCommitPage({
  ownerLogin,
  repositoryName,
  commitId,
}: {
  ownerLogin: string;
  repositoryName: string;
  commitId: string;
}) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(
    () => fetchRepositoryCommit(ownerLogin, repositoryName, commitId),
    [ownerLogin, repositoryName, commitId],
  );
  const repository = data?.repository ?? null;
  const commit = data?.commit ?? null;
  const ownerName = repository?.owner?.displayName ?? ownerLogin;

  return (
    <main>
      <SiteHeader account={account} showGlobalSearch={false} />
      <nav className="code-breadcrumb" aria-label="Breadcrumb">
        <a
          className="code-breadcrumb__repository"
          href={makeHash(repositoryPath(ownerLogin, repositoryName))}
        >
          {`${ownerName}/${repositoryName}`}
        </a>
      </nav>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {commit && !error ? (
        <>
          <RepositoryNav
            ownerLogin={ownerLogin}
            repositoryName={repositoryName}
            branch={commit.branch}
            active="commits"
          />
          <h1 className="commit-heading">{commit.message}</h1>
          <p className="commit-meta">
            <span className="commit-meta__author">{commit.author}</span>
            <span aria-hidden="true"> · </span>
            <time className="commit-meta__time" dateTime={absoluteTime(commit.createdAt)}>
              {relativeTime(commit.createdAt)}
            </time>
          </p>
          <p className="revision-context">
            Revision <code className="revision-context__value">{commit.shortId}</code>
          </p>
          <p className="revision-context">
            Branch <code className="revision-context__value">{commit.branch}</code>
          </p>
          {commit.parentId ? (
            <p className="commit-parent">
              Parent{" "}
              <a
                className="commit-parent__link"
                href={makeHash(commitPath(ownerLogin, repositoryName, commit.parentId))}
              >
                {commit.parentId.slice(0, 7)}
              </a>
            </p>
          ) : null}
          <section className="diff" aria-labelledby="changed-files-heading">
            <h2 id="changed-files-heading">Changed files</h2>
            <p className="diff-summary">
              {`${commit.totals.files} file${commit.totals.files === 1 ? "" : "s"} changed`}{" "}
              <span className="diff-summary__additions">{`+${commit.totals.additions}`}</span>{" "}
              <span className="diff-summary__deletions">{`-${commit.totals.deletions}`}</span>
            </p>
            {commit.changes.map((change) => (
              <article className="diff-file" key={change.path}>
                <h3 className="diff-file__path">
                  <a
                    className="diff-file__link"
                    href={makeHash(blobPath(ownerLogin, repositoryName, commit.branch, change.path))}
                  >
                    {change.path}
                  </a>
                </h3>
                <p className="diff-file__stats">
                  <span className="diff-file__additions">{`+${change.additions}`}</span>{" "}
                  <span className="diff-file__deletions">{`-${change.deletions}`}</span>
                </p>
                <pre className="diff-file__lines">
                  {change.lines.map((line, index) => (
                    <span
                      className={`diff-line diff-line--${line.type}`}
                      key={`${line.type}-${index}`}
                    >
                      {`${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}${line.text}\n`}
                    </span>
                  ))}
                </pre>
              </article>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}
