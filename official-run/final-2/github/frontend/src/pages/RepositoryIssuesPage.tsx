import { useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { replace } from "../lib/hash-route";
import { fetchRepositoryIssues, type IssueSummary } from "../lib/org-api";
import { repositoryIssuesHash, repositoryIssueHash, repositoryNewIssueHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

const STATUS_LABEL: Record<IssueSummary["status"], string> = { open: "Open", closed: "Closed" };

/** The selected status view: an unknown or absent value reads the Open issues. */
export function activeIssueState(state: string): "open" | "closed" {
  return state === "closed" ? "closed" : "open";
}

/** Keyword match of one row; the filters never change the stored issue. */
function matchesKeyword(issue: IssueSummary, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return (
    issue.title.toLowerCase().includes(needle) || String(issue.number).includes(needle)
  );
}

/**
 * Repository Issues list (REQ-5-1-1). `Open` and `Closed` are links that select
 * the status view and travel in the address, so a reload reads the same view.
 * The `Search issues` box filters the rows of that view as the user types; both
 * filters only change what the browser displays.
 */
export function RepositoryIssuesPage({
  owner,
  name,
  state,
  query,
}: {
  owner: string;
  name: string;
  state: string;
  query: string;
}) {
  const { status, data, error } = useAsyncData(() => fetchRepositoryIssues(owner, name), [owner, name]);
  const [keyword, setKeyword] = useState(query);
  const active = activeIssueState(state);
  const view = data;
  const rows = view
    ? view.issues.filter((issue) => issue.status === active && matchesKeyword(issue, keyword))
    : [];

  const filterHref = (next: "open" | "closed") =>
    repositoryIssuesHash(owner, name, { state: next, q: keyword });

  const updateKeyword = (value: string) => {
    setKeyword(value);
    // Keep the filter in the address without one history step per keystroke.
    const history = new URLSearchParams();
    history.set("state", active);
    if (value.trim()) history.set("q", value);
    replace(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`, history);
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-issues">
        {view ? <RepositoryBreadcrumb repository={view.repository} /> : null}
        <h1 className="repository-issues__title">Issues</h1>
        <nav className="repository-issues__filters" aria-label="Issue status">
          <a
            className="repository-issues__filter"
            data-active={active === "open" || undefined}
            href={filterHref("open")}
          >
            Open
          </a>
          <a
            className="repository-issues__filter"
            data-active={active === "closed" || undefined}
            href={filterHref("closed")}
          >
            Closed
          </a>
        </nav>
        {status === "loading" && !view ? <LoadingNote label="Loading issues…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {view ? (
          <>
            <p className="repository-issues__search">
              <label htmlFor="issue-search">Search issues</label>
              <input
                id="issue-search"
                type="search"
                placeholder="Search issues"
                value={keyword}
                onChange={(event) => updateKeyword(event.target.value)}
              />
            </p>
            {view.canWrite ? (
              <p className="repository-issues__new">
                <a className="ui-button ui-button--primary" href={repositoryNewIssueHash(owner, name)}>
                  New issue
                </a>
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="repository-issues__empty">No issues match this view.</p>
            ) : (
              <ul className="issue-list">
                {rows.map((issue) => {
                  const href = repositoryIssueHash(owner, name, issue.number);
                  return (
                    <li key={issue.number} className="issue-row">
                      <a className="issue-row__number" href={href}>
                        #{issue.number}
                      </a>
                      <div className="issue-row__main">
                        <a className="issue-row__title" href={href}>
                          {issue.title}
                        </a>
                        <p className="issue-row__meta">
                          <span className="issue-row__status" data-status={issue.status}>
                            {STATUS_LABEL[issue.status]}
                          </span>
                          <span className="issue-row__author">{issue.author}</span>
                          {issue.labels.map((label) => (
                            <span
                              key={label.name}
                              className="issue-label"
                              style={{ borderColor: label.color }}
                            >
                              {label.name}
                            </span>
                          ))}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
