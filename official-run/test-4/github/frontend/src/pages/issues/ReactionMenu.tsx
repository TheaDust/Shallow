import { useEffect, useRef, useState } from "react";

import { IssueReaction } from "../../lib/issue-api";

export const REACTIONS = ["👍", "👎", "😄", "🎉", "😕", "❤️"];

interface ReactionMenuProps {
  reactions: IssueReaction[];
  onToggle: (reaction: string) => void;
}

/**
 * The reaction picker shown on the issue body and every comment. The trigger
 * is a button named “Add reaction” that opens a menu (role=menu, named
 * “Reactions”) of reaction options with their current counts; selecting an
 * option toggles the viewer's own reaction for that target.
 */
export function ReactionMenu({ reactions, onToggle }: ReactionMenuProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!open) return;
    const first = REACTIONS.find((reaction) => itemsRef.current[reaction]);
    first && itemsRef.current[first]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function moveFocus(direction: 1 | -1) {
    const keys = REACTIONS.filter((reaction) => itemsRef.current[reaction]);
    const current = keys.findIndex((reaction) => itemsRef.current[reaction] === document.activeElement);
    const next = keys[(current + direction + keys.length) % keys.length];
    itemsRef.current[next]?.focus();
  }

  return (
    <div className="issue-reaction-menu">
      <button
        type="button"
        className="issue-reaction-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add reaction"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">😄</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          className="issue-reaction-menu__panel"
          role="menu"
          aria-label="Reactions"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveFocus(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveFocus(-1);
            }
          }}
        >
          {REACTIONS.map((reaction) => {
            const entry = reactions.find((candidate) => candidate.reaction === reaction);
            return (
              <button
                key={reaction}
                type="button"
                role="menuitem"
                ref={(node) => {
                  itemsRef.current[reaction] = node;
                }}
                className="issue-reaction-menu__item"
                aria-label={`${reaction} ${entry ? entry.count : 0}`}
                onClick={() => {
                  setOpen(false);
                  onToggle(reaction);
                }}
              >
                <span aria-hidden="true">{reaction}</span>
                <span className="issue-reaction-menu__count">{entry ? entry.count : 0}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ReactionChipsProps {
  reactions: IssueReaction[];
}

/**
 * The saved reactions of one target, each shown as emoji plus count.
 */
export function ReactionChips({ reactions }: ReactionChipsProps) {
  const visible = reactions.filter((reaction) => reaction.count > 0);
  if (visible.length === 0) return null;
  return (
    <span className="issue-reaction-chips">
      {visible.map((reaction) => (
        <span
          key={reaction.reaction}
          className="issue-reaction-chip"
          aria-label={`${reaction.reaction} ${reaction.count}`}
        >
          {reaction.reaction} {reaction.count}
        </span>
      ))}
    </span>
  );
}
