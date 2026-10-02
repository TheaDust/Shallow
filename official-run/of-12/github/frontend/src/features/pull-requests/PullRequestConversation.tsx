import { formatIssueTime } from "../issues/format-issue-time";
import { PullRequestReviewSummary } from "./PullRequestReviewSummary";
import type { PullRequestDetail } from "./pull-request-api";

export interface PullRequestConversationProps {
  pullRequest: PullRequestDetail;
}

/**
 * The Conversation section of a pull request (REQ-6-3-1, REQ-6-3-4).
 *
 * It spells the stored description, the ordinary comments, the published inline
 * comments of the diff, the append-only activities and the review summary of the
 * current compare commit. A review decision recorded for an older compare commit
 * is preserved here and marked Outdated, so a stale decision stays readable
 * without counting as a decision.
 */
export function PullRequestConversation({ pullRequest }: PullRequestConversationProps) {
  const { description, comments, reviewComments, timeline, reviews } = pullRequest;
  const publishedComments = reviewComments.filter((comment) => !comment.pending);
  return (
    <section className="pull-request-conversation" aria-label="Pull request conversation">
      <section className="pull-request-conversation__description" aria-label="Description">
        <p className="pull-request-conversation__body">
          {description || "No description provided."}
        </p>
      </section>

      <PullRequestReviewSummary reviews={reviews} />

      <section className="pull-request-conversation__comments" aria-label="Comments">
        <h3 className="pull-request-conversation__heading">Comments</h3>
        {comments.length > 0 ? (
          <ul className="pull-request-comments">
            {comments.map((comment) => (
              <li key={comment.id} className="pull-request-comment">
                <p className="pull-request-comment__author">{comment.author}</p>
                <p className="pull-request-comment__body">{comment.body}</p>
                <p className="pull-request-comment__time">{formatIssueTime(comment.createdAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pull-request-conversation__empty">No comments yet.</p>
        )}
        {publishedComments.length > 0 ? (
          <ul className="pull-request-comments pull-request-comments--inline">
            {publishedComments.map((comment) => (
              <li key={comment.id} className="pull-request-comment">
                <p className="pull-request-comment__author">{comment.author}</p>
                <p className="pull-request-comment__location">{`${comment.filePath}:${comment.line}`}</p>
                <p className="pull-request-comment__body">{comment.body}</p>
                <p className="pull-request-comment__time">{formatIssueTime(comment.createdAt)}</p>
                {comment.outdated ? (
                  <p className="pull-request-comment__outdated">Outdated</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="pull-request-conversation__activity" aria-label="Activity">
        <h3 className="pull-request-conversation__heading">Activity</h3>
        <ul className="pull-request-activity">
          {timeline.map((event) => (
            <li key={event.id || `${event.type}-${event.createdAt}`} className="pull-request-activity__item">
              <span className="pull-request-activity__actor">{event.actor}</span>
              <span className="pull-request-activity__text">{event.text}</span>
              <span className="pull-request-activity__time">{formatIssueTime(event.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
