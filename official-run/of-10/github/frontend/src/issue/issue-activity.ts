import type { IssueActivity } from "../lib/issues-api";

/**
 * Whether one record describes a status transition. Those records are labelled
 * with their status text (`Closed issue` / `Reopened issue`) and name their
 * operator beside it, since the label itself does not carry the actor.
 */
export function isStatusActivity(activity: IssueActivity): boolean {
  return activity.type === "closed" || activity.type === "reopened";
}

/**
 * Human-readable text of one activity timeline record. The timeline is
 * append-only, so each record describes the change that was stored at its time;
 * unknown record types keep a neutral wording instead of hiding the entry.
 */
export function activityText(activity: IssueActivity): string {
  const actor = activity.actor || "Someone";
  switch (activity.type) {
    case "created":
      return `${actor} created this issue`;
    case "title_changed":
      return activity.to
        ? `${actor} changed the title to ${activity.to}`
        : `${actor} changed the title`;
    case "description_changed":
      return `${actor} changed the description`;
    case "commented":
      return `${actor} commented`;
    case "closed":
      return "Closed issue";
    case "reopened":
      return "Reopened issue";
    case "assigned":
      return activity.to ? `${actor} assigned ${activity.to}` : `${actor} assigned this issue`;
    case "unassigned":
      return activity.from
        ? `${actor} unassigned ${activity.from}`
        : `${actor} unassigned this issue`;
    case "labeled":
      return activity.to ? `${actor} added the label ${activity.to}` : `${actor} added a label`;
    case "unlabeled":
      return activity.from
        ? `${actor} removed the label ${activity.from}`
        : `${actor} removed a label`;
    case "milestoned":
      return activity.to
        ? `${actor} set the milestone ${activity.to}`
        : `${actor} set a milestone`;
    case "unmilestoned":
      return activity.from
        ? `${actor} removed the milestone ${activity.from}`
        : `${actor} removed the milestone`;
    default:
      return `${actor} updated this issue`;
  }
}
