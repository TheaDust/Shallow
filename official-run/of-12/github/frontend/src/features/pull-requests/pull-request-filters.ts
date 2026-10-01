import type {
  PullRequestReviewStatus,
  PullRequestStatus,
  PullRequestSummary,
} from "./pull-request-api";

/**
 * The filter context of the Pull requests list page (REQ-6-2-1).
 *
 * The persisted status, the author and the review status live in the address of
 * the page, so a reload keeps the chosen filters and the matching rows.
 * Filtering is a pure read of the rows the server returned for the current
 * repository: it creates, changes and deletes no pull request, branch or
 * review.
 */

export interface PullRequestFilters {
  status: "" | PullRequestStatus;
  author: string;
  review: "" | PullRequestReviewStatus;
}

export const NO_PULL_REQUEST_FILTERS: PullRequestFilters = { status: "", author: "", review: "" };

const STATUSES: PullRequestStatus[] = ["draft", "open", "closed", "merged"];
const REVIEW_STATUSES: PullRequestReviewStatus[] = ["review_required", "approved", "changes_requested"];

export function parsePullRequestFilters(search: URLSearchParams): PullRequestFilters {
  const status = String(search.get("status") ?? "").toLowerCase();
  const review = String(search.get("review") ?? "").toLowerCase();
  return {
    status: STATUSES.includes(status as PullRequestStatus) ? (status as PullRequestStatus) : "",
    author: search.get("author") ?? "",
    review: REVIEW_STATUSES.includes(review as PullRequestReviewStatus)
      ? (review as PullRequestReviewStatus)
      : "",
  };
}

/** The query of a Pull requests address; absent values stay out of it. */
export function pullRequestFilterParams(filters: PullRequestFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.author) params.set("author", filters.author);
  if (filters.review) params.set("review", filters.review);
  return params;
}

/** Whether one row matches the status, the author and the review status. */
export function matchesPullRequestFilters(
  pullRequest: PullRequestSummary,
  filters: PullRequestFilters,
): boolean {
  if (filters.status && pullRequest.status !== filters.status) return false;
  if (filters.review && pullRequest.reviewStatus !== filters.review) return false;
  const author = filters.author.trim().toLowerCase();
  if (author && !pullRequest.author.toLowerCase().includes(author)) return false;
  return true;
}

/** The rows the list page displays for the current filter context. */
export function filterPullRequests(
  pullRequests: PullRequestSummary[],
  filters: PullRequestFilters,
): PullRequestSummary[] {
  return pullRequests.filter((pullRequest) => matchesPullRequestFilters(pullRequest, filters));
}

/** The distinct authors of the currently listed pull requests, sorted. */
export function pullRequestAuthors(pullRequests: PullRequestSummary[]): string[] {
  return [...new Set(pullRequests.map((pullRequest) => pullRequest.author).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
