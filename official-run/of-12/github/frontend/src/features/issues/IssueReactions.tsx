import { Menu } from "../../ui";
import type { IssueReaction } from "./issue-api";

/**
 * The reactions a viewer may attach to an issue or to one of its comments
 * (REQ-5-2-3): the stored “subject-target-reaction type” associations summed by
 * type. The association of the current viewer is rendered pressed; a second
 * selection removes it again, so the same user never adds a duplicate.
 */
export const REACTION_TYPES: ReadonlyArray<{ type: string; label: string }> = [
  { type: "👍", label: "Thumbs up" },
  { type: "👎", label: "Thumbs down" },
  { type: "😄", label: "Laugh" },
  { type: "🎉", label: "Hooray" },
  { type: "😕", label: "Confused" },
  { type: "❤", label: "Heart" },
  { type: "🚀", label: "Rocket" },
  { type: "👀", label: "Eyes" },
];

export interface IssueReactionsProps {
  reactions: IssueReaction[];
  /** Only a signed-in viewer may add or remove a reaction. */
  canReact: boolean;
  onToggle(type: string): void;
}

export function IssueReactions({ reactions, canReact, onToggle }: IssueReactionsProps) {
  if (!canReact && reactions.length === 0) return null;
  return (
    <div className="issue-reactions">
      {reactions.map((reaction) => (
        <button
          key={reaction.type}
          type="button"
          className="issue-reactions__chip"
          aria-pressed={reaction.mine}
          disabled={!canReact}
          onClick={() => onToggle(reaction.type)}
        >
          {reaction.type} {reaction.count}
        </button>
      ))}
      {canReact ? (
        <Menu
          triggerLabel="Add reaction"
          buttonVariant="secondary"
          items={REACTION_TYPES.map((reaction) => ({
            id: reaction.type,
            label: `${reaction.type} ${reaction.label}`,
            onSelect: () => onToggle(reaction.type),
          }))}
        />
      ) : null}
    </div>
  );
}
