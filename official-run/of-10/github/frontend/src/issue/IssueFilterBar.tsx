import { repositoryIssuesHref, type IssueFilterQuery } from "../lib/repository-routes";
import type { IssueLabel } from "../lib/issues-api";
import { toIssueFilterQuery, type IssueFilterPatch, type IssueFilterValues } from "../lib/issue-filters";

export interface IssueFilterBarProps {
  owner: string;
  name: string;
  labels: readonly IssueLabel[];
  filters: IssueFilterValues;
  onChange(patch: IssueFilterPatch): void;
}

/**
 * The filters of the Issues list page (REQ-5-1-1). “Open” and “Closed” are links,
 * not buttons or tabs: each one addresses the same list with that status. The
 * search box filters as the user types — no Enter and no search button — and the
 * label filter selects one label of the current repository. Every filter only
 * changes which rows are displayed and keeps the issue records untouched.
 */
export function IssueFilterBar({ owner, name, labels, filters, onChange }: IssueFilterBarProps) {
  const hrefFor = (state: IssueFilterQuery["state"]) =>
    repositoryIssuesHref(owner, name, { ...toIssueFilterQuery(filters), state });

  return (
    <div className="issue-filters">
      <nav className="issue-filters__states" aria-label="Issue status">
        <a
          className="issue-filters__state"
          href={hrefFor("open")}
          aria-current={filters.state === "open" ? "page" : undefined}
        >
          Open
        </a>
        <a
          className="issue-filters__state"
          href={hrefFor("closed")}
          aria-current={filters.state === "closed" ? "page" : undefined}
        >
          Closed
        </a>
      </nav>

      <p className="issue-filters__field">
        <label className="issue-filters__label" htmlFor="issue-search">
          Search issues
        </label>
        <input
          id="issue-search"
          className="issue-filters__search"
          type="search"
          name="q"
          placeholder="Search issues"
          autoComplete="off"
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
        />
      </p>

      <p className="issue-filters__field">
        <label className="issue-filters__label" htmlFor="issue-label-filter">
          Labels
        </label>
        <select
          id="issue-label-filter"
          className="issue-filters__labels"
          value={filters.label}
          onChange={(event) => onChange({ label: event.target.value })}
        >
          <option value="">All labels</option>
          {labels.map((label) => (
            <option key={label.id} value={label.name}>
              {label.name}
            </option>
          ))}
        </select>
      </p>
    </div>
  );
}
