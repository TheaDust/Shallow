import { ArchivedActionLink } from "../components/ArchivedAction";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepositoryPullRequests, type PullRequestStatus, type PullRequestSummary } from "../lib/org-api";
import {
  repositoryNewPullHash,
  repositoryPullHash,
  repositoryPullsHash,
} from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

const STATUS_LABEL: Record<PullRequestStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  merged: "Merged",
};

/** The selected view of the list; an unknown or absent value reads Open. */
export function activePullState(state: string): "open" | "closed" {
  return state === "closed" ? "closed" : "open";
}

/** A pull request belongs to the Open view while it is still a proposal. */
function matchesState(pull: PullRequestSummary, active: "open" | "closed"): boolean {
  if (active === "open") return pull.status === "open" || pull.status === "draft";
  return pull.status === "closed" || pull.status === "merged";
}

/**
 * Repository Pull requests list (REQ-6-2-1). `Open` and `Closed` are links that
 * select the view and travel in the address, so a reload reads the same view,
 * and the list itself only changes what the browser displays. The `New pull
 * request` entry opens the comparison page for a caller that may create one.
 */
export function RepositoryPullRequestsPage({
  owner,
  name,
  state,
}: {
  owner: string;
  name: string;
  state: string;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchRepositoryPullRequests(owner, name),
    [owner, name],
  );
  const active = activePullState(state);
  const rows = data ? data.pullRequests.filter((pull) => matchesState(pull, active)) : [];

  return (
    <main className="page">
      <section className="page__body repository-pulls">
        {data ? <RepositoryBreadcrumb repository={data.repository} /> : null}
        <h1 className="repository-pulls__title">Pull requests</h1>
        {data?.canWrite ? (
          <p className="repository-pulls__new">
            {data.repository.archived ? (
              // An Archived repository keeps the creation entry as a
              // non-actionable control (REQ-3-5).
              <ArchivedActionLink
                className="ui-button ui-button--primary"
                href={repositoryNewPullHash(owner, name)}
              >
                New pull request
              </ArchivedActionLink>
            ) : (
              <a className="ui-button ui-button--primary" href={repositoryNewPullHash(owner, name)}>
                New pull request
              </a>
            )}
          </p>
        ) : null}
        <nav className="repository-pulls__filters" aria-label="Pull request status">
          <a
            className="repository-pulls__filter"
            data-active={active === "open" || undefined}
            href={repositoryPullsHash(owner, name, { state: "open" })}
          >
            Open
          </a>
          <a
            className="repository-pulls__filter"
            data-active={active === "closed" || undefined}
            href={repositoryPullsHash(owner, name, { state: "closed" })}
          >
            Closed
          </a>
        </nav>
        {status === "loading" && !data ? <LoadingNote label="Loading pull requests…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {data ? (
          rows.length === 0 ? (
            <p className="repository-pulls__empty">No pull requests match this view.</p>
          ) : (
            <ul className="pull-list">
              {rows.map((pull) => {
                const href = repositoryPullHash(owner, name, pull.number);
                return (
                  <li key={pull.number} className="pull-row">
                    <a className="pull-row__number" href={href}>
                      #{pull.number}
                    </a>
                    <div className="pull-row__main">
                      <a className="pull-row__title" href={href}>
                        {pull.title}
                      </a>
                      <p className="pull-row__meta">
                        <span className="pull-row__status" data-status={pull.status}>
                          {STATUS_LABEL[pull.status]}
                        </span>
                        <span className="pull-row__author">{pull.author}</span>
                        <span className="pull-row__branches">
                          {pull.sourceBranch} &rarr; {pull.targetBranch}
                        </span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </section>
    </main>
  );
}
