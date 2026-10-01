import type { IssueEvent } from "../../lib/issues-api";
import { describeIssueEvent, formatIssueTime } from "./issue-format";

export interface IssueTimelineProps {
  events: readonly IssueEvent[];
}

/**
 * The append-only activity history of one issue, oldest first: creation, edits,
 * comments, assignment, labels, milestone and status changes.
 */
export function IssueTimeline({ events }: IssueTimelineProps) {
  return (
    <section className="issue-timeline" aria-labelledby="issue-activity-title">
      <h2 id="issue-activity-title">Activity</h2>
      {events.length === 0 ? (
        <p className="issue-timeline__empty" role="status">
          No activity yet
        </p>
      ) : (
        <ol className="issue-timeline__list">
          {events.map((event) => (
            <li key={event.id} className="issue-timeline__item">
              {/* Every activity record is its own article, exactly like every
                  discussion comment. */}
              <article className="issue-timeline__record">
                <span className="issue-timeline__actor">{event.actor ?? "Someone"}</span>{" "}
                <span className="issue-timeline__action">{describeIssueEvent(event)}</span>{" "}
                <time className="issue-timeline__time" dateTime={event.createdAt}>
                  {formatIssueTime(event.createdAt)}
                </time>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
