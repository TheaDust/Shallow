import type { IssueSummary } from "./issue-api";

/**
 * The filter context of the Issues list page (REQ-5-1-1).
 *
 * Open/Closed, the keyword and the label live in the address of the page, so a
 * reload keeps the chosen filters and the matching rows. Filtering is a pure
 * read of the currently displayed rows: it creates, changes and deletes
 * nothing.
 */

export interface IssueFilters {
  state: "" | "open" | "closed";
  query: string;
  label: string;
}

export const NO_ISSUE_FILTERS: IssueFilters = { state: "", query: "", label: "" };

function normalizeState(value: string | null): IssueFilters["state"] {
  return value === "open" || value === "closed" ? value : "";
}

export function parseIssueFilters(search: URLSearchParams): IssueFilters {
  return {
    state: normalizeState(search.get("state")),
    query: search.get("q") ?? "",
    label: search.get("label") ?? "",
  };
}

/** The query of an Issues address; absent and default values stay out of it. */
export function issueFilterParams(filters: IssueFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.state) params.set("state", filters.state);
  if (filters.query) params.set("q", filters.query);
  if (filters.label) params.set("label", filters.label);
  return params;
}

/** Whether one row matches the status, the keyword and the label filter. */
export function matchesIssueFilters(issue: IssueSummary, filters: IssueFilters): boolean {
  if (filters.state && issue.status !== filters.state) return false;
  if (filters.label && !issue.labels.includes(filters.label)) return false;
  const needle = filters.query.trim().toLowerCase();
  if (needle) {
    const haystack = `${issue.title}\n${issue.body}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** The rows the list page displays for the current filter context. */
export function filterIssues(issues: IssueSummary[], filters: IssueFilters): IssueSummary[] {
  return issues.filter((issue) => matchesIssueFilters(issue, filters));
}
