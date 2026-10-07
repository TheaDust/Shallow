import { useState } from "react";

import {
  addRepositoryIssueReaction,
  removeRepositoryIssueReaction,
  type IssueReaction,
} from "../lib/org-api";
import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";

/**
 * The reaction types an issue accepts, in the order the reaction bar lists them
 * and the order the `Add reaction` menu offers (REQ-5-5). Kept in sync with the
 * server (backend/src/lib/issue-rules.mjs).
 */
export const ISSUE_REACTION_TYPES = [
  "+1",
  "-1",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
] as const;

/**
 * The reaction bar of one issue (REQ-5-5). Every stored type is displayed with
 * its count, and the reaction of the signed-in caller is represented by the
 * button `Remove <type> reaction`, which removes exactly that reaction and
 * decrements the count. The `Add reaction` menu is only offered to a caller the
 * server reported as able to react, so an unauthenticated visitor sees the
 * counts without any reaction control.
 */
export function IssueReactions({
  owner,
  name,
  number,
  reactions,
  canReact,
  onChanged,
}: {
  owner: string;
  name: string;
  number: string;
  reactions: IssueReaction[];
  canReact: boolean;
  onChanged(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (action: "add" | "remove", type: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result =
      action === "add"
        ? await addRepositoryIssueReaction(owner, name, number, type)
        : await removeRepositoryIssueReaction(owner, name, number, type);
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors.reaction ?? result.message);
      return;
    }
    onChanged();
  };

  return (
    <section className="issue-reactions" aria-label="Reactions">
      <h2 className="issue-detail__section-title">Reactions</h2>
      {reactions.length === 0 ? null : (
        <ul className="issue-reactions__list">
          {reactions.map((reaction) => (
            <li key={reaction.type} className="issue-reactions__item">
              {reaction.viewerReacted ? (
                <Button
                  className="issue-reaction issue-reaction--viewer"
                  data-viewer-reacted="true"
                  aria-label={`Remove ${reaction.type} reaction`}
                  disabled={busy}
                  onClick={() => void save("remove", reaction.type)}
                >
                  <span className="issue-reaction__type">{reaction.type}</span>
                  <span className="issue-reaction__count">{reaction.count}</span>
                </Button>
              ) : (
                <span className="issue-reaction" data-viewer-reacted="false">
                  <span className="issue-reaction__type">{reaction.type}</span>
                  <span className="issue-reaction__count">{reaction.count}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canReact ? (
        <div className="issue-reactions__picker">
          <Menu
            triggerLabel="Add reaction"
            menuLabel="Add reaction"
            items={ISSUE_REACTION_TYPES.map((type) => ({
              id: type,
              label: type,
              onSelect: () => void save("add", type),
            }))}
          />
        </div>
      ) : null}
      {error ? (
        <p className="issue-reactions__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
