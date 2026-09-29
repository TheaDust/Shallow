import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { formatUpdatedTime } from "../../lib/format";
import { navigate, parseHashLocation, useHashLocation } from "../../lib/hash-route";
import { useSession } from "../auth/session";
import { AccessDenied } from "../organizations/AccessDenied";
import type { RepoRole } from "../organizations/api";
import { listIssues, type IssuesListData } from "./api";
import { RepoNav } from "./RepoNav";

const WRITABLE_ROLES: RepoRole[] = ["write", "maintain", "admin"];

function filterHref(owner: string, name: string, state: string, query: string, label: string) {
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  if (query) params.set("q", query);
  if (label) params.set("label", label);
  return `#/repos/${owner}/${name}/issues${params.toString() ? `?${params.toString()}` : ""}`;
}

function liveParams(): URLSearchParams {
  return parseHashLocation(window.location.hash).search;
}

function applyFilter(
  owner: string,
  name: string,
  change: { state?: string; q?: string; label?: string },
) {
  // Read the current filter context from the live hash so rapid successive
  // actions never drop a previously chosen filter before React re-renders.
  const current = liveParams();
  const next = new URLSearchParams();
  const state = change.state !== undefined ? change.state : current.get("state") ?? "";
  const query = change.q !== undefined ? change.q : current.get("q") ?? "";
  const label = change.label !== undefined ? change.label : current.get("label") ?? "";
  if (state) next.set("state", state);
  if (query) next.set("q", query);
  if (label) next.set("label", label);
  navigate(`/repos/${owner}/${name}/issues`, next);
}

export function IssuesPage({ owner, name }: { owner: string; name: string }) {
  const location = useHashLocation();
  const params = location.search;
  const selectedState = params.get("state") ?? "";
  const query = params.get("q") ?? "";
  const label = params.get("label") ?? "";

  const [data, setData] = useState<IssuesListData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "missing">("loading");
  const { session } = useSession();

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    listIssues(owner, name)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus("ok");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setStatus("denied");
        else setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  if (status === "denied") return <AccessDenied />;
  if (status === "missing") {
    return (
      <section className="issues-page">
        <RepoNav owner={owner} name={name} active="issues" />
        <h1>Issues</h1>
        <p className="issues-page__empty">Not found</p>
      </section>
    );
  }
  if (status === "loading" || !data) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const canCreate =
    session.status === "authenticated" &&
    data.myRole !== null &&
    WRITABLE_ROLES.includes(data.myRole);

  const keyword = query.trim().toLowerCase();
  const filtered = data.issues.filter((issue) => {
    if (selectedState && issue.status !== selectedState) return false;
    if (keyword && !issue.searchText.toLowerCase().includes(keyword)) return false;
    if (label && !issue.labels.includes(label)) return false;
    return true;
  });

  return (
    <section className="issues-page">
      <RepoNav owner={owner} name={name} active="issues" />
      <header className="issues-page__header">
        <h1>Issues</h1>
        {canCreate ? (
          <a
            className="ui-button ui-button--primary issues-page__new"
            href={`#/repos/${owner}/${name}/issues/new`}
          >
            New issue
          </a>
        ) : null}
      </header>

      <nav className="issue-filters" aria-label="Issue status">
        <a
          className="issue-filters__link"
          aria-current={selectedState === "open" ? "page" : undefined}
          href={filterHref(owner, name, "open", query, label)}
          onClick={(event) => {
            event.preventDefault();
            applyFilter(owner, name, { state: "open" });
          }}
        >
          Open
        </a>
        <a
          className="issue-filters__link"
          aria-current={selectedState === "closed" ? "page" : undefined}
          href={filterHref(owner, name, "closed", query, label)}
          onClick={(event) => {
            event.preventDefault();
            applyFilter(owner, name, { state: "closed" });
          }}
        >
          Closed
        </a>
      </nav>

      <div className="issue-toolbar">
        <input
          type="search"
          aria-label="Search issues"
          placeholder="Search issues"
          value={query}
          onChange={(event) => applyFilter(owner, name, { q: event.target.value })}
        />
        <label className="issue-toolbar__label" htmlFor="issue-label-filter">
          <span>Label</span>
          <select
            id="issue-label-filter"
            value={label}
            onChange={(event) => applyFilter(owner, name, { label: event.target.value })}
          >
            <option value="">All labels</option>
            {data.labels.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="issues-page__empty">No matching issues.</p>
      ) : (
        <table className="issue-list">
          <tbody>
            {filtered.map((issue) => (
              <tr key={issue.number} className="issue-list__row">
                <td className="issue-list__number-cell">
                  <a
                    className="issue-list__number"
                    href={`#/repos/${owner}/${name}/issues/${issue.number}`}
                  >
                    #{issue.number}
                  </a>
                </td>
                <td className="issue-list__content">
                  <a
                    className="issue-list__title"
                    href={`#/repos/${owner}/${name}/issues/${issue.number}`}
                  >
                    {issue.title}
                  </a>
                  <p className="issue-list__meta">
                    <span className="issue-status">
                      {issue.status === "open" ? "Open" : "Closed"}
                    </span>
                    <span aria-hidden="true"> · </span>
                    opened by {issue.author}
                    <span aria-hidden="true"> · </span>
                    updated {formatUpdatedTime(issue.updatedAt)}
                  </p>
                  {issue.labels.length > 0 ? (
                    <ul className="issue-list__labels">
                      {issue.labels.map((name) => (
                        <li key={name} className="issue-label" aria-label={name}>
                          {name}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
