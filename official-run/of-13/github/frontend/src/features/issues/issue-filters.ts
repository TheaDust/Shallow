import type { IssueState, RepositoryIssueRow } from "../../lib/issues-api";

export type IssueStateFilter = "" | IssueState;

/** The status filter of the address; an unknown or absent value shows both. */
export function issueStateFilter(value: string | null | undefined): IssueStateFilter {
  return value === "open" || value === "closed" ? value : "";
}

/** The comma-separated label filter of the address. */
export function parseLabelFilter(value: string | null | undefined): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return value
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

export interface IssueFilter {
  state: IssueStateFilter;
  keyword: string;
  labels: readonly string[];
}

/** The keyword filter reads the title and the body of an issue. */
export function matchesIssueKeyword(issue: RepositoryIssueRow, keyword: string): boolean {
  const term = keyword.trim().toLowerCase();
  if (term.length === 0) return true;
  return (
    issue.title.toLowerCase().includes(term) || (issue.body ?? "").toLowerCase().includes(term)
  );
}

/** Status, keyword and label filters combine; the filter is display-only. */
export function filterIssueRows(
  issues: readonly RepositoryIssueRow[],
  filter: IssueFilter,
): RepositoryIssueRow[] {
  return issues.filter((issue) => {
    if (filter.state !== "" && issue.state !== filter.state) return false;
    if (
      filter.labels.length > 0 &&
      !filter.labels.some((name) => issue.labels.some((label) => label.name === name))
    ) {
      return false;
    }
    return matchesIssueKeyword(issue, filter.keyword);
  });
}

/** Adds or removes one label from the current label filter. */
export function toggleLabelFilter(labels: readonly string[], name: string): string[] {
  return labels.includes(name) ? labels.filter((label) => label !== name) : [...labels, name];
}
