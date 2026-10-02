import type {
  PullRequestEvent,
  PullRequestReviewStatus,
  PullRequestStatus,
} from "../../lib/pull-requests-api";

/** The visible status text of a pull request: Draft, Open, Closed or Merged. */
export function pullRequestStatusLabel(status: PullRequestStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "closed":
      return "Closed";
    case "merged":
      return "Merged";
    default:
      return "Open";
  }
}

/** The readable review state of one pull request. */
export function pullRequestReviewStatusLabel(status: PullRequestReviewStatus): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes requested";
    default:
      return "Review required";
  }
}

/** The readable decision of one submitted review. */
export function pullRequestReviewDecisionLabel(decision: string): string {
  switch (decision) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes requested";
    default:
      return "Commented";
  }
}

/** The two branch names of one record, source first, as every page shows them. */export function pullRequestBranchText(record: {
  sourceBranch: string;
  targetBranch: string;
}): string {
  return `${record.sourceBranch} → ${record.targetBranch}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** A stable, timezone-independent rendering of a stored timestamp. */
export function formatPullRequestTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return DATE_FORMAT.format(date);
}

function eventText(event: PullRequestEvent, key: string, fallback: string): string {
  const value = event.data?.[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * The readable sentence of one activity record. The timeline is append-only, so
 * every stored type keeps its own wording and unknown types stay readable.
 */
export function describePullRequestEvent(event: PullRequestEvent): string {
  switch (event.type) {
    case "created":
      return "opened this pull request";
    case "ready_for_review":
      return "marked this pull request as ready for review";
    case "review_requested":
      return `requested a review from ${eventText(event, "reviewer", "a reviewer")}`;
    case "review_request_removed":
      return `removed the review request for ${eventText(event, "reviewer", "a reviewer")}`;
    case "reviewed":
      return "submitted a review";
    case "stale_reviews_marked":
      return "marked the earlier reviews as stale";
    case "commented":
      return "commented";
    case "closed":
      return "closed this pull request";
    case "reopened":
      return "reopened this pull request";
    case "merged":
      return "merged this pull request";
    default:
      return "updated this pull request";
  }
}
