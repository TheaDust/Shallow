import type { ReactNode } from "react";

import { formatIssueTime } from "./format-issue-time";
import { IssueReactions } from "./IssueReactions";
import type { IssueComment, IssueTimelineEntry } from "./issue-api";

/**
 * The discussion and the activity of one issue (REQ-5-1-2, REQ-5-2-3).
 *
 * Each stored comment and each activity record is rendered inside its own
 * `<article>`, so an entry is a single-level container of its own and a refused
 * submission cannot add one. The discussion keeps the stored comments first (the
 * newest appends at the end) and the append-only activity history follows in
 * chronological order; both carry the reactions of the viewer who may add or
 * remove them. The discussion region is named “Discussion” so the accessible name
 * of the container never shadows the “Comment” label of the comment editor.
 *
 * Within an activity record the actor, the stored action text and the time are
 * three separate elements, so the recorded text of an event (`Closed issue`,
 * `Reopened issue`, `opened this issue`, …) reads as its own text instead of
 * being buried in a concatenation with the account name.
 */
export interface IssueDiscussionProps {
  comments: IssueComment[];
  timeline: IssueTimelineEntry[];
  /** True for a signed-in viewer, who may react on the issue and its comments. */
  canReact: boolean;
  onToggleReaction(type: string, commentId?: string): void;
  /** The comment editor, rendered above the stored comments for writers. */
  editor: ReactNode;
}

export function IssueDiscussion({
  comments,
  timeline,
  canReact,
  onToggleReaction,
  editor,
}: IssueDiscussionProps) {
  return (
    <>
      <section className="repository-issue__comments" aria-label="Discussion">
        <h2 className="repository-issue__section-title">Discussion</h2>
        {comments.length === 0 ? (
          <p className="repository-issue__empty">No comments yet.</p>
        ) : (
          <ul className="repository-issue__comment-list">
            {comments.map((comment) => (
              <li key={comment.id}>
                <article className="repository-issue__comment">
                  <p className="repository-issue__comment-meta">
                    <span className="repository-issue__comment-author">{comment.author}</span> commented{" "}
                    <span className="repository-issue__time">{formatIssueTime(comment.createdAt)}</span>
                  </p>
                  <p className="repository-issue__comment-body">{comment.body}</p>
                  <IssueReactions
                    reactions={comment.reactions}
                    canReact={canReact}
                    onToggle={(type) => onToggleReaction(type, comment.id)}
                  />
                </article>
              </li>
            ))}
          </ul>
        )}
        {editor}
      </section>

      <section className="repository-issue__activity" aria-label="Activity">
        <h2 className="repository-issue__section-title">Activity</h2>
        {timeline.length === 0 ? (
          <p className="repository-issue__empty">No activity yet.</p>
        ) : (
          <ol className="repository-issue__timeline">
            {timeline.map((entry) => (
              <li key={entry.id}>
                <article className="repository-issue__event">
                  <p className="repository-issue__event-line">
                    <span className="repository-issue__event-actor">{entry.actor}</span>{" "}
                    <span className="repository-issue__event-text">{entry.text}</span>{" "}
                    <span className="repository-issue__time">{formatIssueTime(entry.createdAt)}</span>
                  </p>
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
