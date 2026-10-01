import { useHashLocation, navigate } from "../lib/hash-route";
import { IssueFilterBar } from "../features/issues/IssueFilterBar";
import {
  filterIssues,
  issueFilterParams,
  parseIssueFilters,
  type IssueFilters,
} from "../features/issues/issue-filters";
import { issueHref, newIssueHref, repositoryIssuesPath } from "../features/issues/issue-links";
import { formatIssueTime } from "../features/issues/format-issue-time";
import { useRepositoryIssues } from "../features/issues/use-issues";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryIssuesPageProps {
  owner: string;
  name: string;
}

/**
 * Issues list page of a repository (REQ-5-1-1).
 *
 * Every row spells the repository-scoped number, the title, the Open/Closed
 * status, the author, the labels and the update time; the number and the title
 * open the detail page of that issue. The Open/Closed links, the unique
 * “Search issues” searchbox and the label filter narrow the displayed rows and
 * only the displayed rows: the filter context lives in the address, so a reload
 * keeps the chosen filters, and nothing here creates or changes a work item.
 */
export function RepositoryIssuesPage({ owner, name }: RepositoryIssuesPageProps) {
  const { search } = useHashLocation();
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const { state, payload } = useRepositoryIssues(owner, name, repositoryState === "ready");
  const filters = parseIssueFilters(search);

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  const issues = payload?.issues ?? [];
  const rows = filterIssues(issues, filters);
  // The filter context is part of the address of this list page, so a selected
  // filter is a link or a rewritten query rather than page state.
  const issuesPath = repositoryIssuesPath(repository);

  function updateFilters(next: IssueFilters, replace = false) {
    navigate(issuesPath, issueFilterParams(next), { replace });
  }

  return (
    <main className="repository-issues-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="issues" />
      <section className="repository-issues" aria-label="Issues">
        <h2>Issues</h2>
        {payload?.permissions.canCreateIssue ? (
          <a className="repository-issues__new" href={newIssueHref(repository)}>
            New issue
          </a>
        ) : null}
        <IssueFilterBar
          repository={repository}
          labels={payload?.labels ?? []}
          labelsReady={state === "ready"}
          filters={filters}
          onQueryChange={(query) => updateFilters({ ...filters, query }, true)}
          onLabelChange={(label) => updateFilters({ ...filters, label })}
        />

        {state === "loading" || state === "idle" ? <p role="status">Loading issues…</p> : null}
        {state === "failed" ? (
          <p role="alert">The issues could not be loaded. Please try again.</p>
        ) : null}
        {state === "ready" && issues.length === 0 ? (
          <p className="repository-issues__empty">No issues yet.</p>
        ) : null}
        {state === "ready" && issues.length > 0 && rows.length === 0 ? (
          <p className="repository-issues__empty">No issues match your filters.</p>
        ) : null}

        {rows.length > 0 ? (
          <ul className="repository-issues__list">
            {rows.map((issue) => (
              <li key={issue.number} className="issue-row">
                <p className="issue-row__heading">
                  <a className="issue-row__number" href={issueHref(repository, issue.number)}>
                    #{issue.number}
                  </a>
                  <a className="issue-row__title" href={issueHref(repository, issue.number)}>
                    {issue.title}
                  </a>
                </p>
                <p className="issue-row__meta">
                  <span className="issue-row__status">
                    {issue.status === "open" ? "Open" : "Closed"}
                  </span>
                  <span className="issue-row__author">{issue.author}</span>
                  <span className="issue-row__time">{formatIssueTime(issue.updatedAt)}</span>
                </p>
                <p className="issue-row__labels">
                  {issue.labels.length > 0 ? (
                    issue.labels.map((label) => (
                      <span key={label} className="issue-row__label">
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="issue-row__no-label">No labels</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
