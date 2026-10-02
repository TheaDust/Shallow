import { useEffect, useState } from "react";

import {
  fetchRepositoryIssues,
  newIssueHref,
  repositoryIssueHref,
  repositoryIssuesListHref,
  type RepositoryIssueList,
} from "../../lib/issues-api";
import { canWriteRepositoryRole } from "../../lib/repository-code-api";
import { useDocumentTitle } from "../../lib/document-title";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryHeader } from "../repositories/RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "../repositories/RepositoryPageStates";
import { useRepositoryResource } from "../repositories/useRepositoryResource";
import { IssueLabelList } from "./IssueLabelList";
import {
  filterIssueRows,
  issueStateFilter,
  parseLabelFilter,
  toggleLabelFilter,
  type IssueStateFilter,
} from "./issue-filters";
import { formatIssueTime, issueStateLabel } from "./issue-format";

export interface IssuesListPageProps {
  owner: string;
  name: string;
  /** `state` of the filter address: `open`, `closed` or empty for both. */
  state: string;
  /** `q` of the filter address: the title or body keyword. */
  query: string;
  /** `labels` of the filter address, comma separated. */
  labels: string;
}

/**
 * The Issues list of one repository: every row shows the issue number, title,
 * status, author, labels and update time, and the title and the number open the
 * detail page. The status, keyword and label filters only change the rows shown
 * in the browser; they are carried by the address, so a reload of a filtered
 * list keeps the same context and the same rows.
 */
export function IssuesListPage({ owner, name, state, query, labels }: IssuesListPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const [keyword, setKeyword] = useState(query);
  const [stateFilter, setStateFilter] = useState<IssueStateFilter>(() => issueStateFilter(state));
  const [chosenLabels, setChosenLabels] = useState<string[]>(() => parseLabelFilter(labels));

  // The address stays the shared source of the filter context; the local state
  // keeps typing and clicking instant and is re-synced whenever it changes.
  useEffect(() => setKeyword(query), [query]);
  useEffect(() => setStateFilter(issueStateFilter(state)), [state]);
  useEffect(() => setChosenLabels(parseLabelFilter(labels)), [labels]);

  const resource = useRepositoryResource<RepositoryIssueList>(
    `repository-issues:${owner}/${name}`,
    sessionStatus !== "loading",
    () => fetchRepositoryIssues(owner, name),
  );

  useDocumentTitle(`Issues · ${owner}/${name}`);

  if (resource.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  if (resource.status === "missing" || resource.status === "error") {
    return <RepositoryNotFound />;
  }

  if (resource.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const { repository, issues, labels: repositoryLabels, counts } = resource.value;
  const rows = filterIssueRows(issues, { state: stateFilter, keyword, labels: chosenLabels });
  // Only the roles the server accepts for a new issue are offered the entry.
  const canWrite = canWriteRepositoryRole(repository.viewerRole);

  function filterHref(next: {
    state?: string;
    q?: string;
    labels?: readonly string[];
  }): string {
    return repositoryIssuesListHref(owner, name, {
      state: next.state ?? stateFilter,
      q: next.q ?? keyword,
      labels: [...(next.labels ?? chosenLabels)],
    });
  }

  function applyKeyword(next: string): void {
    setKeyword(next);
    window.location.hash = filterHref({ q: next });
  }

  function applyLabels(next: string[]): void {
    setChosenLabels(next);
    window.location.hash = filterHref({ labels: next });
  }

  return (
    <div className="repository-issues">
      <RepositoryHeader
        owner={repository.owner}
        name={repository.name}
        visibility={repository.visibility}
        description={repository.description}
        defaultBranch={repository.defaultBranch}
        showSettings={Boolean(account)}
        active="issues"
        source={repository.source ?? null}
      />
      <section className="repository-issues__section" aria-labelledby="repository-issues-title">
        <h2 id="repository-issues-title">Issues</h2>
        {canWrite ? (
          <p className="repository-issues__actions">
            <a href={newIssueHref(repository.owner, repository.name)}>New issue</a>
          </p>
        ) : null}
        <form
          className="repository-issues__filters"
          aria-label="Issue filters"
          onSubmit={(event) => event.preventDefault()}
        >
          <nav className="repository-issues__states" aria-label="Issue status">
            <ul>
              <li>
                <a
                  href={filterHref({ state: "open" })}
                  aria-current={stateFilter === "open" ? "page" : undefined}
                  onClick={() => setStateFilter("open")}
                >
                  Open
                </a>
                <span className="repository-issues__count">{counts.open}</span>
              </li>
              <li>
                <a
                  href={filterHref({ state: "closed" })}
                  aria-current={stateFilter === "closed" ? "page" : undefined}
                  onClick={() => setStateFilter("closed")}
                >
                  Closed
                </a>
                <span className="repository-issues__count">{counts.closed}</span>
              </li>
            </ul>
          </nav>
          <p className="repository-issues__search">
            <label htmlFor="issues-search">Search issues</label>
            <input
              id="issues-search"
              name="q"
              type="search"
              value={keyword}
              onChange={(event) => applyKeyword(event.target.value)}
            />
          </p>
          <fieldset className="repository-issues__label-filter">
            <legend>Labels</legend>
            {repositoryLabels.length === 0 ? <p>No labels yet</p> : null}
            <ul>
              {repositoryLabels.map((label) => (
                <li key={label.name}>
                  {/* The checkbox takes its accessible name from this label. */}
                  <label className="repository-issues__label-option">
                    <input
                      type="checkbox"
                      name="labels"
                      value={label.name}
                      checked={chosenLabels.includes(label.name)}
                      onChange={() => applyLabels(toggleLabelFilter(chosenLabels, label.name))}
                    />
                    {label.name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </form>
        {rows.length === 0 ? (
          <p className="repository-issues__empty" role="status">
            No issues match the current filters
          </p>
        ) : (
          <ul className="repository-issues__list">
            {rows.map((issue) => {
              const href = repositoryIssueHref(repository.owner, repository.name, issue.number);
              return (
                <li key={issue.id} className="issue-row">
                  <article className="issue-row__body">
                    <h3 className="issue-row__title">
                      {/* The title link keeps the title as its accessible name. */}
                      <a className="issue-row__title-link" href={href}>
                        {issue.title}
                      </a>
                    </h3>
                    <p className="issue-row__meta">
                      <a className="issue-row__number" href={href}>
                        {`#${issue.number}`}
                      </a>
                      <span className="issue-row__state">{issueStateLabel(issue.state)}</span>
                      <span className="issue-row__author">{issue.author ?? "Unknown author"}</span>
                      <time className="issue-row__updated" dateTime={issue.updatedAt}>
                        {formatIssueTime(issue.updatedAt)}
                      </time>
                    </p>
                    <IssueLabelList labels={issue.labels} />
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
