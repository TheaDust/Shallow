import { useEffect, useState } from "react";

import { navigate, useHashLocation } from "../../lib/hash-route";
import { fetchIssues, IssuesListData } from "../../lib/issue-api";
import { formatRelativeTime } from "../../lib/org-api";
import { repoOwnerBase, RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { RepoPageChrome } from "../repos/RepoPageChrome";
import { useRepoDetail } from "../repos/useRepoDetail";

interface IssuesPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
}

/**
 * The Issues list page for the current repository (REQ-5-1-1). Rows show the
 * issue number, title link, Open/Closed status, author, labels, and update
 * time. “Open” and “Closed” are links, the “Search issues” searchbox filters
 * as the user types, and the Label filter narrows by label; the chosen
 * filters live in the hash query so a refresh keeps the same context.
 * Filtering only changes the rows displayed in the browser.
 */
export function IssuesPage({ ownerType, ownerName, repoName }: IssuesPageProps) {
  const { status: sessionStatus } = useSession();
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName);
  const location = useHashLocation();
  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;

  const [data, setData] = useState<IssuesListData | null>(null);
  const [listStatus, setListStatus] = useState<"loading" | "ready">("loading");
  const [stateFilter, setStateFilter] = useState(location.search.get("state") ?? "");
  const [query, setQuery] = useState(location.search.get("q") ?? "");
  const [labelFilter, setLabelFilter] = useState(location.search.get("label") ?? "");

  useEffect(() => {
    setStateFilter(location.search.get("state") ?? "");
    setQuery(location.search.get("q") ?? "");
    setLabelFilter(location.search.get("label") ?? "");
  }, [location.search]);

  useEffect(() => {
    if (detailStatus !== "ready") return;
    let cancelled = false;
    setListStatus("loading");
    fetchIssues(ownerType, ownerName, repoName)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setListStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setListStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [detailStatus, ownerType, ownerName, repoName]);

  function filterParams(state: string, q: string, label: string): URLSearchParams {
    const params = new URLSearchParams();
    if (state) params.set("state", state);
    if (q.trim()) params.set("q", q.trim());
    if (label) params.set("label", label);
    return params;
  }

  /** Reads the currently displayed filters from the URL at action time. */
  function readUrlFilters(): { state: string; q: string; label: string } {
    const raw = window.location.hash.replace(/^#/, "") || "/";
    const url = new URL(raw.startsWith("/") ? raw : `/${raw}`, "http://local");
    return {
      state: url.searchParams.get("state") ?? "",
      q: url.searchParams.get("q") ?? "",
      label: url.searchParams.get("label") ?? "",
    };
  }

  function updateFilters(next: { state?: string; q?: string; label?: string }) {
    const current = readUrlFilters();
    const state = next.state ?? current.state;
    const q = next.q ?? current.q;
    const label = next.label ?? current.label;
    setStateFilter(state);
    setQuery(q);
    setLabelFilter(label);
    const search = filterParams(state, q, label).toString();
    window.history.replaceState(null, "", `#${base}/issues${search ? `?${search}` : ""}`);
  }

  function selectState(next: string) {
    const current = readUrlFilters();
    const value = current.state === next ? "" : next;
    navigate(`${base}/issues`, filterParams(value, current.q, current.label));
  }

  const canCreate =
    sessionStatus === "authenticated" &&
    ["write", "maintain", "admin"].includes(repository?.currentRole ?? "");

  const filtered = (data?.issues ?? []).filter((issue) => {
    if (stateFilter && issue.state !== stateFilter) return false;
    if (query.trim()) {
      const needle = query.trim().toLowerCase();
      const haystack = `${issue.title} ${issue.description}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (labelFilter && !issue.labels.some((label) => label.name === labelFilter)) return false;
    return true;
  });

  return (
    <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
      {detailStatus === "notfound" ? (
        <p>Repository not found.</p>
      ) : detailStatus === "denied" ? (
        <p>Access denied</p>
      ) : detailStatus !== "ready" || listStatus !== "ready" ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="issues-toolbar">
            <h2>Issues</h2>
            {canCreate && (
              <a className="button" href={`#${base}/issues/new`}>
                New issue
              </a>
            )}
          </div>
          <div className="issues-filters">
            <span className="issues-filters__states">
              <a
                href={`#${base}/issues?${filterParams("open", query, labelFilter).toString()}`}
                aria-current={stateFilter === "open" ? "true" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  selectState("open");
                }}
              >
                Open
              </a>
              <a
                href={`#${base}/issues?${filterParams("closed", query, labelFilter).toString()}`}
                aria-current={stateFilter === "closed" ? "true" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  selectState("closed");
                }}
              >
                Closed
              </a>
            </span>
            <div className="issues-filters__field">
              <label htmlFor="search-issues">Search issues</label>
              <input
                id="search-issues"
                type="search"
                value={query}
                onChange={(event) => updateFilters({ q: event.target.value })}
              />
            </div>
            <div className="issues-filters__field">
              <label htmlFor="label-filter">Label</label>
              <select
                id="label-filter"
                value={labelFilter}
                onChange={(event) => updateFilters({ label: event.target.value })}
              >
                <option value="">All labels</option>
                {(data?.labels ?? []).map((label) => (
                  <option key={label.name} value={label.name}>
                    {label.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ul className="issues-list">
            {filtered.map((issue) => (
              <li key={issue.number} className="issues-list__item">
                <span className={`issues-list__state issues-list__state--${issue.state}`}>
                  {issue.state === "open" ? "Open" : "Closed"}
                </span>
                <a className="issues-list__number" href={`#${base}/issues/${issue.number}`}>
                  #{issue.number}
                </a>
                <a className="issues-list__title" href={`#${base}/issues/${issue.number}`}>
                  {issue.title}
                </a>
                <span className="issues-list__meta">
                  <span>
                    #{issue.number} {issue.state === "open" ? "opened" : "closed"} by{" "}
                    {issue.author.username}
                  </span>
                  <span>Updated {formatRelativeTime(issue.updatedAt)}</span>
                </span>
                <span className="issues-list__labels">
                  {issue.labels.map((label) => (
                    <span
                      key={label.name}
                      className="issue-label"
                      style={{ backgroundColor: label.color }}
                    >
                      {label.name}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && <p>No issues found.</p>}
        </>
      )}
    </RepoPageChrome>
  );
}
