import { issueDateTime } from "../lib/issue-dates";
import type {
  IssueActivity,
  IssueComment,
  RepositoryIssuePayload,
} from "../lib/issues-api";
import { IssueCommentForm } from "./IssueCommentForm";
import { IssueReactions } from "./IssueReactions";
import { activityText, isStatusActivity } from "./issue-activity";

export interface IssueDiscussionProps {
  owner: string;
  name: string;
  number: number;
  comments: readonly IssueComment[];
  activities: readonly IssueActivity[];
  /** Write, Maintain and Admin may comment; everybody else only reads. */
  canComment: boolean;
  /** Only a signed-in reader may react; an anonymous visitor only reads them. */
  signedIn: boolean;
  /** The stored answer of a successful comment or reaction. */
  onSaved(payload: RepositoryIssuePayload): void;
}

/**
 * The discussion of one issue (REQ-5-1-2, REQ-5-2-3): the saved comments as
 * article entries with their own reactions, the comment editor, and the
 * append-only activity timeline below it. Every entry keeps its author and time,
 * and the timeline is rendered in the stored chronological order, so an invalid
 * submission adds neither an article nor a timeline record.
 */
export function IssueDiscussion({
  owner,
  name,
  number,
  comments,
  activities,
  canComment,
  signedIn,
  onSaved,
}: IssueDiscussionProps) {
  return (
    <>
      <section className="issue-discussion" aria-labelledby="issue-comment-heading">
        <h2 id="issue-comment-heading" className="issue-section-heading">
          Comment
        </h2>
        {comments.length > 0 ? (
          comments.map((comment) => (
            <article key={comment.id} className="issue-comment">
              <header className="issue-comment__header">
                <span className="issue-comment__author">{comment.author}</span>
                {" commented "}
                <time dateTime={comment.createdAt}>{issueDateTime(comment.createdAt)}</time>
              </header>
              <p className="issue-comment__body">{comment.body}</p>
              <IssueReactions
                owner={owner}
                name={name}
                number={number}
                reactions={comment.reactions ?? []}
                commentId={comment.id}
                triggerLabel="Add reaction"
                signedIn={signedIn}
                onSaved={onSaved}
              />
            </article>
          ))
        ) : (
          <p className="issue-meta__empty">No comments yet</p>
        )}
        {canComment ? (
          <IssueCommentForm owner={owner} name={name} number={number} onSaved={onSaved} />
        ) : null}
      </section>

      <section className="issue-discussion" aria-labelledby="issue-activity-heading">
        <h2 id="issue-activity-heading" className="issue-section-heading">
          Activity
        </h2>
        <ol className="issue-activity">
          {activities.map((activity) => (
            <li key={activity.id}>
              <article className="issue-activity__entry" data-activity={activity.type}>
                <span className="issue-activity__text">{activityText(activity)}</span>
                {/* A status record is labelled with its own text, so the operator
                    it stored is shown beside it. */}
                {isStatusActivity(activity) ? (
                  <>
                    {" · "}
                    <span className="issue-activity__actor">{activity.actor}</span>
                  </>
                ) : null}
                {" · "}
                <time dateTime={activity.createdAt}>{issueDateTime(activity.createdAt)}</time>
              </article>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
