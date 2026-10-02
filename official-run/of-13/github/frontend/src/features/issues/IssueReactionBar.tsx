import type { IssueReactionSummary, IssueReactionType } from "../../lib/issues-api";
import { Menu } from "../../ui/Menu";
import { ISSUE_REACTION_OPTIONS, reactionEmoji, reactionName } from "./issue-reactions";

export interface IssueReactionBarProps {
  /** The reaction target: the issue itself or one of its comments. */
  target: "issue" | "comment";
  reactions: readonly IssueReactionSummary[];
  /** Every signed-in reader who can view the issue may react. */
  canReact: boolean;
  busy?: boolean;
  onToggle(reaction: IssueReactionType): void;
}

/**
 * The reactions of one target: every stored type is shown with its emoji and
 * its count, and the menu offers the remaining ones. Selecting a reaction that
 * the viewer already chose removes it again, so a second selection never adds a
 * duplicate.
 */
export function IssueReactionBar({
  target,
  reactions,
  canReact,
  busy = false,
  onToggle,
}: IssueReactionBarProps) {
  const triggerLabel = target === "issue" ? "Add issue reaction" : "Add reaction";
  const chosen = new Set(reactions.map((summary) => summary.reaction));
  const remaining = ISSUE_REACTION_OPTIONS.filter((option) => !chosen.has(option.type));

  return (
    <div className="issue-reactions">
      {reactions.map((summary) => (
        <button
          key={summary.reaction}
          type="button"
          className="issue-reaction"
          aria-pressed={summary.reacted}
          aria-label={`${reactionName(summary.reaction)} reaction`}
          disabled={!canReact || busy}
          onClick={() => onToggle(summary.reaction)}
        >
          <span className="issue-reaction__emoji" aria-hidden="true">
            {reactionEmoji(summary.reaction)}
          </span>
          <span className="issue-reaction__count">{summary.count}</span>
        </button>
      ))}
      {canReact && remaining.length > 0 ? (
        <Menu
          triggerLabel={triggerLabel}
          menuLabel={target === "issue" ? "Issue reactions" : "Comment reactions"}
          items={remaining.map((option) => ({
            id: option.type,
            label: `${option.emoji} ${option.name}`,
            onSelect: () => onToggle(option.type),
          }))}
        />
      ) : null}
    </div>
  );
}
