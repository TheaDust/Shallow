import { makeHash } from "../../lib/hash-route";
import type { RepositorySummary } from "../repositories/repository-api";
import { issueFilterParams, type IssueFilters } from "./issue-filters";

/**
 * Addresses of the issue pages (REQ-5-1).
 *
 * The Issues list is an entry of the repository navigation and the filter
 * context travels in its query, so Open/Closed, the keyword and the label can be
 * spelled as an ordinary link and survive a reload. One issue is opened by its
 * repository-scoped number below that address.
 */

export function repositoryIssuesPath(repository: Pick<RepositorySummary, "owner" | "name">): string {
  return `/${repository.owner}/${repository.name}/issues`;
}

/** The Issues list address, carrying a filter context when one is selected. */
export function issuesHref(
  repository: Pick<RepositorySummary, "owner" | "name">,
  filters?: Partial<IssueFilters>,
): string {
  const params = issueFilterParams({
    state: filters?.state ?? "",
    query: filters?.query ?? "",
    label: filters?.label ?? "",
  });
  return makeHash(repositoryIssuesPath(repository), params);
}

/** The address of one issue of the repository, opened by its number. */
export function issuePath(
  repository: Pick<RepositorySummary, "owner" | "name">,
  number: number | string,
): string {
  return `${repositoryIssuesPath(repository)}/${encodeURIComponent(String(number))}`;
}

/** The address of one issue of the repository, opened by its number. */
export function issueHref(
  repository: Pick<RepositorySummary, "owner" | "name">,
  number: number | string,
): string {
  return `#${issuePath(repository, number)}`;
}

/** The creation form of the current repository (REQ-5-2-1). */
export function newIssuePath(repository: Pick<RepositorySummary, "owner" | "name">): string {
  return `${repositoryIssuesPath(repository)}/new`;
}

/** The “New issue” link of the Issues list page (REQ-5-2-1). */
export function newIssueHref(repository: Pick<RepositorySummary, "owner" | "name">): string {
  return `#${newIssuePath(repository)}`;
}
