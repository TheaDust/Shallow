import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { formatRelativeTime } from "../lib/format";
import { fetchRepositoryCommit } from "../lib/org-api";
import { repositoryBlobHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

const STATUS_LABELS: Record<string, string> = {
  added: "added",
  modified: "modified",
  removed: "removed",
};

/**
 * Read-only difference of one commit against its parent revision. The base is
 * the earlier revision and the compare side is the opened commit; the page
 * states the changed files with their numeric additions and deletions and the
 * compared lines. It creates no review, comment, commit or branch change.
 */
export function RepositoryCommitPage({
  owner,
  name,
  commitId,
}: {
  owner: string;
  name: string;
  commitId: string;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchRepositoryCommit(owner, name, commitId),
    [owner, name, commitId],
  );

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-commit">
        {status === "loading" ? <LoadingNote label="Loading commit…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {status === "ready" && data ? (
          <>
            <RepositoryBreadcrumb repository={data.repository} />
            <h1 className="repository__title">{data.commit.message}</h1>
            <p className="repository-commit__meta">
              {data.commit.authorName} committed {formatRelativeTime(data.commit.createdAt)}
            </p>
            <dl className="repository__facts">
              <dt>Branch</dt>
              <dd>{data.branch}</dd>
              <dt>Revision</dt>
              <dd>{data.commit.id}</dd>
              <dt>Base revision</dt>
              <dd>{data.base ? data.base.id : "No parent revision"}</dd>
            </dl>
            <h2 className="repository-commit__heading">Changed files</h2>
            <p className="repository-commit__summary">
              {`${data.totals.files} file${data.totals.files === 1 ? "" : "s"} changed with `}
              {`${data.totals.additions} additions and ${data.totals.deletions} deletions`}
            </p>
            {data.changes.length === 0 ? (
              <p className="repository-commit__empty">This commit does not change any file.</p>
            ) : (
              <ul className="repository-commit__files">
                {data.changes.map((change) => (
                  <li key={change.path} className="repository-commit__file">
                    <div className="repository-commit__file-head">
                      <a
                        className="repository-commit__path"
                        href={repositoryBlobHash(data.repository.owner.id, data.repository.name, change.path)}
                      >
                        {change.path}
                      </a>
                      <span className="repository-commit__additions">{`+${change.additions}`}</span>
                      <span className="repository-commit__deletions">{`-${change.deletions}`}</span>
                      <span className="repository-commit__status">
                        {STATUS_LABELS[change.status] ?? change.status}
                      </span>
                    </div>
                    <ul className="repository-commit__lines">
                      {change.lines.map((line, index) => (
                        <li
                          key={`${change.path}-${index}`}
                          className={`repository-commit__line repository-commit__line--${line.type}`}
                          data-line-type={line.type}
                        >
                          <span className="repository-commit__sign">
                            {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                          </span>
                          <code className="repository-commit__code">{line.text}</code>
                        </li>
                      ))}
                    </ul>
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
