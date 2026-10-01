import type { IssueEvent, IssueState } from "../../lib/issues-api";
import { reactionEmoji } from "./issue-reactions";

/** The visible status text of an issue, exactly `Open` or `Closed`. */
export function issueStateLabel(state: IssueState): string {
  return state === "closed" ? "Closed" : "Open";
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** A stable, timezone-independent rendering of a stored timestamp. */
export function formatIssueTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return DATE_FORMAT.format(date);
}

function eventText(event: IssueEvent, key: string, fallback: string): string {
  const value = event.data?.[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * The readable sentence of one activity record. The timeline is append-only, so
 * every stored type keeps its own wording and unknown types stay readable.
 */
export function describeIssueEvent(event: IssueEvent): string {
  switch (event.type) {
    case "created":
      return "created this issue";
    case "edited":
      // Saving the title and saving the description stay two separate actions.
      return eventText(event, "field", "description") === "title"
        ? "edited the title"
        : "edited the description";
    case "commented":
      return "commented";
    case "reacted":
      return `reacted with ${reactionEmoji(eventText(event, "reaction", "a reaction"))}`;
    case "unreacted":
      return `removed the ${reactionEmoji(eventText(event, "reaction", "reaction"))} reaction`;
    case "assigned":
      return `assigned ${eventText(event, "assignee", "a participant")}`;
    case "unassigned":
      return `unassigned ${eventText(event, "assignee", "a participant")}`;
    case "labeled":
      return `added the ${eventText(event, "labelName", "label")} label`;
    case "unlabeled":
      return `removed the ${eventText(event, "labelName", "label")} label`;
    case "milestoned":
      return `added this to the ${eventText(event, "milestoneTitle", "milestone")} milestone`;
    case "unmilestoned":
      return "removed this from its milestone";
    case "closed":
      return "closed this issue";
    case "reopened":
      return "reopened this issue";
    default:
      return "updated this issue";
  }
}
