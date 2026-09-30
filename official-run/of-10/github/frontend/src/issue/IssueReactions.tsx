import { useState } from "react";

import { apiErrorMessage } from "../lib/api";
import {
  toggleIssueReaction,
  type IssueReaction,
  type RepositoryIssuePayload,
} from "../lib/issues-api";
import { Menu } from "../ui";
import { REACTION_OPTIONS, reactionOption } from "./reactions";

export interface IssueReactionsProps {
  owner: string;
  name: string;
  number: number;
  reactions: readonly IssueReaction[];
  /** Accessible name of the reaction trigger of this target. */
  triggerLabel: string;
  /** The comment this bar belongs to, or null for the issue itself. */
  commentId?: string | null;
  /**
   * Only a signed-in reader may add or remove a reaction; an anonymous visitor
   * still sees the stored reactions and their counts.
   */
  signedIn: boolean;
  /** The stored answer of a successful toggle, so the page shows the record. */
  onSaved(payload: RepositoryIssuePayload): void;
}

/**
 * The reactions of one target (REQ-5-2-3): the stored reaction types with their
 * counts, and the reaction menu of the current account. For one account, one
 * target and one type only a single association is stored, so choosing the same
 * reaction again removes it; a failed request displays no local reaction.
 */
export function IssueReactions({
  owner,
  name,
  number,
  reactions,
  triggerLabel,
  commentId = null,
  signedIn,
  onSaved,
}: IssueReactionsProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (type: string) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      onSaved(await toggleIssueReaction(owner, name, number, { type, commentId }));
    } catch (caught) {
      setFailure(apiErrorMessage(caught, "The reaction could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="issue-reactions">
      {reactions.map((reaction) => {
        const option = reactionOption(reaction.type);
        const label = option?.label ?? reaction.type;
        const emoji = option?.emoji ?? reaction.type;
        if (!signedIn) {
          return (
            <span key={reaction.type} className="issue-reaction" aria-label={`${label} ${reaction.count}`}>
              <span aria-hidden="true">{emoji}</span>
              <span className="issue-reaction__count">{reaction.count}</span>
            </span>
          );
        }
        return (
          <button
            key={reaction.type}
            type="button"
            className="issue-reaction"
            data-mine={reaction.reacted || undefined}
            aria-pressed={reaction.reacted}
            aria-label={`${label} ${reaction.count}`}
            disabled={busy}
            onClick={() => void toggle(reaction.type)}
          >
            <span aria-hidden="true">{emoji}</span>
            <span className="issue-reaction__count">{reaction.count}</span>
          </button>
        );
      })}
      {signedIn ? (
        <Menu
          triggerLabel={triggerLabel}
          buttonVariant="ghost"
          menuLabel="Reactions"
          items={REACTION_OPTIONS.map((option) => ({
            id: option.type,
            label: option.label,
            onSelect: () => void toggle(option.type),
          }))}
        />
      ) : null}
      {failure ? (
        <p className="issue-reactions__error" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
