import type { ReactNode } from "react";

import type {
  PullRequestActivity,
  PullRequestComment,
  PullRequestInlineComment,
  PullRequestReview,
} from "../lib/pull-requests-api";
import { issueDateTime } from "../lib/issue-dates";

/** One readable sentence for a stored activity record. */
function activityText(activity: PullRequestActivity): string {
  switch (activity.type) {
    case "created":
      return "opened this pull request";
    case "commented":
      return "commented";
    case "reviewed":
      return activity.value === "approve"
        ? "approved these changes"
        : activity.value === "request_changes"
          ? "requested changes"
          : "reviewed these changes";
    case "review_requested":
      return `requested a review from ${activity.value ?? "a reviewer"}`;
    case "review_request_removed":
      return `removed the review request of ${activity.value ?? "a reviewer"}`;
    case "review_comment":
      return `commented on ${activity.value ?? "a changed line"}`;
    case "check_status":
      return `updated the check status to ${activity.value ?? ""}`.trim();
    case "ready_for_review":
      // The activity names the action that produced it (REQ-6-2-4).
      return "marked this pull request as Ready for review";
    case "closed":
      return "closed this pull request";
    case "reopened":
      return "reopened this pull request";
    case "merged":
      return "merged this pull request";
    default:
      return activity.type;
  }
}

export interface PullRequestConversationProps {
  title: string;
  author: string;
  createdAt: string;
  description: string;
  comments: readonly PullRequestComment[];
  reviews: readonly PullRequestReview[];
  /** The inline review comments of the current comparison (REQ-6-3-3). */
  inlineComments: readonly PullRequestInlineComment[];
  activities: readonly PullRequestActivity[];
  /** The ordinary comment editor, shown to a viewer who may write (REQ-6). */
  commentForm?: ReactNode;
}

/**
 * The Conversation section of one pull request (REQ-6): the description of the
 * stored proposal, the review decisions of its timeline, the inline review
 * comments anchored to changed code lines, the ordinary comments and the
 * activity timeline. Every entry is the persisted record, so a refresh shows the
 * same timeline; the review summary of the comparison is the separate area on
 * the right of the page.
 */
export function PullRequestConversation({
  title,
  author,
  createdAt,
  description,
  comments,
  reviews,
  inlineComments,
  activities,
  commentForm,
}: PullRequestConversationProps) {
  const inlineCommentEntry = (comment: PullRequestInlineComment) => (
    <li
      key={comment.id}
      className="pull-inline-comment"
      data-state={comment.state}
      data-outdated={comment.outdated}
    >
      <p className="pull-inline-comment__meta">
        <span className="pull-inline-comment__author">{comment.author}</span>
        {" commented on "}
        <span className="pull-inline-comment__path">{comment.path}</span>
        {comment.lineNumber ? ` line ${comment.lineNumber}` : ""}
        {" · "}
        <time dateTime={comment.createdAt}>{issueDateTime(comment.createdAt)}</time>
        {comment.state === "pending" ? " · Pending review" : ""}
        {comment.outdated ? " · Outdated" : ""}
      </p>
      <p className="pull-inline-comment__body">{comment.body}</p>
    </li>
  );
  return (
    <section className="pull-conversation" aria-labelledby="pull-conversation-heading">
      <h2 id="pull-conversation-heading" className="pull-section-heading">
        Conversation
      </h2>

      <article className="pull-description" aria-label="Description">
        <p className="pull-description__meta">
          <span className="pull-description__author">{author}</span>
          {" opened this pull request on "}
          <time dateTime={createdAt}>{issueDateTime(createdAt)}</time>
        </p>
        <p className="pull-description__body">{description || "No description provided."}</p>
        <p className="pull-description__title-note">{`Proposed title: ${title}`}</p>
      </article>

      <section className="pull-reviews" aria-labelledby="pull-reviews-heading">
        <h3 id="pull-reviews-heading" className="pull-section-heading">
          Reviews
        </h3>
        {reviews.length === 0 ? null : (
          <ul className="pull-reviews__list">
            {reviews.map((review) => (
              <li key={review.id} className="pull-review" data-decision={review.decision}>
                <span className="pull-review__reviewer">{review.reviewer}</span>
                {" "}
                <span className="pull-review__status">{review.decisionLabel}</span>
                {review.commitShortId ? ` on ${review.commitShortId}` : ""}
                {review.stale ? " (stale)" : ""}
                {" · "}
                <time dateTime={review.createdAt}>{issueDateTime(review.createdAt)}</time>
                {review.body ? <p className="pull-review__body">{review.body}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {inlineComments.length > 0 ? (
        <section className="pull-inline-section" aria-labelledby="pull-inline-heading">
          <h3 id="pull-inline-heading" className="pull-section-heading">
            Review comments
          </h3>
          <ul className="pull-inline-comments">
            {inlineComments.map(inlineCommentEntry)}
          </ul>
        </section>
      ) : null}

      <section className="pull-comments" aria-labelledby="pull-comments-heading">
        <h3 id="pull-comments-heading" className="pull-section-heading">
          Comments
        </h3>
        {comments.length === 0 ? (
          <p className="pull-comments__empty">No comments yet.</p>
        ) : (
          comments.map((comment) => (
            <article key={comment.id} className="pull-comment">
              <p className="pull-comment__meta">
                <span className="pull-comment__author">{comment.author}</span>
                {" commented on "}
                <time dateTime={comment.createdAt}>{issueDateTime(comment.createdAt)}</time>
              </p>
              <p className="pull-comment__body">{comment.body}</p>
            </article>
          ))
        )}
        {commentForm}
      </section>

      <section className="pull-activity" aria-labelledby="pull-activity-heading">
        <h3 id="pull-activity-heading" className="pull-section-heading">
          Activity
        </h3>
        <ul className="pull-activity__list">
          {activities.map((activity) => (
            <li key={activity.id} className="pull-activity__item">
              <span className="pull-activity__actor">{activity.actor}</span>
              {` ${activityText(activity)} · `}
              <time dateTime={activity.createdAt}>{issueDateTime(activity.createdAt)}</time>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
