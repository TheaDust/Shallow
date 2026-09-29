import { Menu } from "../../ui";
import type { IssueReactions } from "./api";

export const REACTION_OPTIONS = ["👍", "🎉", "❤️", "🚀", "👀"];

export function Reactions({
  reactions,
  canReact,
  onToggle,
}: {
  reactions: IssueReactions;
  canReact: boolean;
  onToggle(reaction: string): void;
}) {
  const visible = REACTION_OPTIONS.filter((reaction) => (reactions[reaction]?.count ?? 0) > 0);
  return (
    <div className="issue-reactions">
      {visible.map((reaction) => {
        const { count, reacted } = reactions[reaction];
        return (
          <button
            key={reaction}
            type="button"
            className="issue-reactions__badge"
            aria-pressed={reacted}
            disabled={!canReact}
            onClick={() => onToggle(reaction)}
          >
            {reaction} {count}
          </button>
        );
      })}
      {canReact ? (
        <Menu
          triggerLabel="Reactions"
          menuLabel="Reactions"
          items={REACTION_OPTIONS.map((reaction) => ({
            id: reaction,
            label: reaction,
            onSelect: () => onToggle(reaction),
          }))}
        />
      ) : null}
    </div>
  );
}
