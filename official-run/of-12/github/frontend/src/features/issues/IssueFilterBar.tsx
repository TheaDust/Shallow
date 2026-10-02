import type { RepositorySummary } from "../repositories/repository-api";
import type { IssueLabel } from "./issue-api";
import type { IssueFilters } from "./issue-filters";
import { issuesHref } from "./issue-links";

export interface IssueFilterBarProps {
  repository: Pick<RepositorySummary, "owner" | "name">;
  /** The pre-existing labels of the repository; the filter opens them. */
  labels: IssueLabel[];
  /** False while the repository labels are still being read. */
  labelsReady: boolean;
  filters: IssueFilters;
  onQueryChange(query: string): void;
  onLabelChange(label: string): void;
}

/**
 * The filter bar of the Issues list page (REQ-5-1-1).
 *
 * “Open” and “Closed” are links — never buttons or tabs — that carry the whole
 * filter context, so the selected status survives a reload. The unique
 * “Search issues” searchbox filters as the user types, without Enter and
 * without a separate search button, and the label filter selects one of the
 * pre-existing label names of the repository.
 */
export function IssueFilterBar({
  repository,
  labels,
  labelsReady,
  filters,
  onQueryChange,
  onLabelChange,
}: IssueFilterBarProps) {
  const statusLink = (state: "open" | "closed", text: string) => (
    <a
      className="issue-filters__status"
      href={issuesHref(repository, { ...filters, state: filters.state === state ? "" : state })}
      aria-current={filters.state === state ? "page" : undefined}
    >
      {text}
    </a>
  );

  return (
    <div className="issue-filters">
      <div className="issue-filters__statuses">
        {statusLink("open", "Open")}
        {statusLink("closed", "Closed")}
      </div>
      <input
        className="issue-filters__search"
        id="issue-search"
        name="q"
        type="search"
        aria-label="Search issues"
        placeholder="Search issues"
        value={filters.query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <div className="issue-filters__label-field">
        <label className="issue-filters__label" htmlFor="issue-label-filter">
          Label
        </label>
        <select
          id="issue-label-filter"
          className="issue-filters__label-select"
          value={filters.label}
          disabled={!labelsReady}
          onChange={(event) => onLabelChange(event.target.value)}
        >
          <option value="">All labels</option>
          {labels.map((label) => (
            <option key={label.name} value={label.name}>
              {label.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
