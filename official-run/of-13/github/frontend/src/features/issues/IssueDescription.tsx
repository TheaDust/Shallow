import { useState } from "react";

import type { IssueDetail, IssueReactionType } from "../../lib/issues-api";
import { Button } from "../../ui/Button";
import { IssueEditForm } from "./IssueEditForm";
import { IssueReactionBar } from "./IssueReactionBar";

export interface IssueDescriptionProps {
  issue: IssueDetail;
  canWrite: boolean;
  canReact: boolean;
  onSaveDescription(value: string): Promise<string | null>;
  onToggleReaction(reaction: IssueReactionType): void;
}

/**
 * The description of one issue with its reactions. The stored text stays
 * readable while the editor is open, so a refused save never hides the value it
 * kept, and only a Write, Maintain or Admin viewer is offered the editor.
 */
export function IssueDescription({
  issue,
  canWrite,
  canReact,
  onSaveDescription,
  onToggleReaction,
}: IssueDescriptionProps) {
  const [editing, setEditing] = useState(false);

  return (
    <section className="issue-detail__description" aria-labelledby="issue-description-title">
      <h2 id="issue-description-title">Description</h2>
      <p className="issue-detail__body">{issue.body}</p>
      <IssueReactionBar
        target="issue"
        reactions={issue.reactions ?? []}
        canReact={canReact}
        onToggle={onToggleReaction}
      />
      {canWrite ? (
        editing ? (
          <IssueEditForm
            fieldLabel="Issue description"
            saveLabel="Save issue description"
            value={issue.body}
            multiline
            onSave={async (value) => {
              const message = await onSaveDescription(value);
              if (message === null) setEditing(false);
              return message;
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Button type="button" onClick={() => setEditing(true)}>
            Edit issue description
          </Button>
        )
      ) : null}
    </section>
  );
}
