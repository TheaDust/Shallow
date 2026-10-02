import { makeHash } from "../../lib/hash-route";
import type { RepositorySummary } from "../repositories/repository-api";
import { pullRequestFilterParams, type PullRequestFilters } from "./pull-request-filters";

/**
 * Addresses of the pull-request pages (REQ-6-2).
 *
 * The Pull requests list is an entry of the repository navigation and its
 * filter context travels in the query, so the status, the author and the review
 * status can be spelled as an ordinary link and survive a reload. “New pull
 * request” opens the comparison page below that address, with the two selected
 * branches in the query so a valid comparison can be opened directly.
 */

export function pullRequestsPath(repository: Pick<RepositorySummary, "owner" | "name">): string {
  return `/${repository.owner}/${repository.name}/pulls`;
}

/** The Pull requests list address, carrying a filter context when one is selected. */
export function pullRequestsHref(
  repository: Pick<RepositorySummary, "owner" | "name">,
  filters?: Partial<PullRequestFilters>,
): string {
  const params = pullRequestFilterParams({
    status: filters?.status ?? "",
    author: filters?.author ?? "",
    review: filters?.review ?? "",
  });
  return makeHash(pullRequestsPath(repository), params);
}

/** The comparison page of a new pull request (REQ-6-2-2). */
export function newPullRequestPath(repository: Pick<RepositorySummary, "owner" | "name">): string {
  return `${pullRequestsPath(repository)}/new`;
}

/** The comparison page address, carrying the two selected branches. */
export function newPullRequestHref(
  repository: Pick<RepositorySummary, "owner" | "name">,
  options: { base?: string; compare?: string } = {},
): string {
  const params = new URLSearchParams();
  if (options.base) params.set("base", options.base);
  if (options.compare) params.set("compare", options.compare);
  return makeHash(newPullRequestPath(repository), params);
}
