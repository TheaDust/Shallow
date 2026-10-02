import type {
  PullRequestReviewStatus,
  PullRequestStatus,
} from "../../lib/pull-requests-api";

/** The status filter of the address: one status, or empty for every row. */
export type PullRequestStateFilter = "" | PullRequestStatus;

/** The review-status filter of the address, or empty for every row. */
export type PullRequestReviewFilter = "" | PullRequestReviewStatus;

/** The complete filter context of the Pull requests list. */
export interface PullRequestFilter {
  state: PullRequestStateFilter;
  author: string;
  review: PullRequestReviewFilter;
}

export function isPullRequestStatus(value: string): value is PullRequestStatus {
  return value === "draft" || value === "open" || value === "closed" || value === "merged";
}

function isReviewStatus(value: string): value is PullRequestReviewStatus {
  return value === "review_required" || value === "approved" || value === "changes_requested";
}

/** The status filter of the address, or an empty filter for every row. */
export function pullRequestStateFilter(value: string): PullRequestStateFilter {
  return isPullRequestStatus(value) ? value : "";
}

/** The review-status filter of the address, or an empty filter for every row. */
export function pullRequestReviewFilter(value: string): PullRequestReviewFilter {
  return isReviewStatus(value) ? value : "";
}

/**
 * The rows the current filter shows. Filtering only narrows the displayed rows:
 * it never changes a pull request, a branch or a review, and the list itself
 * always reads the stored records of the current repository.
 */
export function filterPullRequestRows<
  Row extends { status: PullRequestStatus; author: string | null; reviewStatus: PullRequestReviewStatus },
>(rows: readonly Row[], filter: PullRequestFilter): Row[] {
  const author = filter.author.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.state !== "" && row.status !== filter.state) return false;
    if (author.length > 0 && !(row.author ?? "").toLowerCase().includes(author)) return false;
    if (filter.review !== "" && row.reviewStatus !== filter.review) return false;
    return true;
  });
}
