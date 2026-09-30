import { makeHash } from "./hash-route";
import type { IssueStatus, IssueSummary } from "./issues-api";
import { repositoryIssuesSearch, type IssueFilterQuery } from "./repository-routes";

/**
 * The Issues list filter (REQ-5-1-1): Open/Closed, title or body keywords and a
 * label. Filtering only selects which rows the browser displays — it never writes
 * or deletes an issue. The chosen filter travels in the page address, so
 * refreshing the page keeps the same rows.
 */
export interface IssueFilterValues {
  /** `null` means every status is displayed. */
  state: IssueStatus | null;
  query: string;
  label: string;
}

export const EMPTY_ISSUE_FILTERS: IssueFilterValues = { state: null, query: "", label: "" };

/**
 * One changed filter. Controls report the field they own, so combining them can
 * never overwrite a filter another control (or an addressed status link) set.
 */
export type IssueFilterPatch = Partial<IssueFilterValues>;

/** Reads the status of a page address; an unknown value shows every status. */
export function readIssueState(value: string | null | undefined): IssueStatus | null {
  return value === "open" || value === "closed" ? value : null;
}

export function readIssueFilters(search: URLSearchParams): IssueFilterValues {
  return {
    state: readIssueState(search.get("state")),
    query: search.get("q") ?? "",
    label: search.get("label") ?? "",
  };
}

/** The address fragment of one filter combination. */
export function toIssueFilterQuery(filters: IssueFilterValues): IssueFilterQuery {
  return {
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.query ? { q: filters.query } : {}),
    ...(filters.label ? { label: filters.label } : {}),
  };
}

/**
 * Matches one issue row against the filter: the status, a keyword in the title or
 * description and one label of the current repository combine.
 */
export function matchesIssueFilters(issue: IssueSummary, filters: IssueFilterValues): boolean {
  if (filters.state && issue.status !== filters.state) return false;
  const keyword = filters.query.trim().toLowerCase();
  if (keyword) {
    const haystack = `${issue.title}\n${issue.description ?? ""}`.toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }
  if (filters.label) {
    if (!issue.labels.some((label) => label.name === filters.label)) return false;
  }
  return true;
}

export function filterIssues(
  issues: readonly IssueSummary[],
  filters: IssueFilterValues,
): IssueSummary[] {
  return issues.filter((issue) => matchesIssueFilters(issue, filters));
}

/**
 * Mirrors the current filter into the page address without adding a history entry
 * and without re-rendering the page: typing in the search box keeps the caret and
 * a refresh still reads the same filter.
 */
export function writeIssueFiltersToAddress(path: string, filters: IssueFilterValues): void {
  const hash = makeHash(path, repositoryIssuesSearch(toIssueFilterQuery(filters)));
  window.history.replaceState(null, "", hash);
}
