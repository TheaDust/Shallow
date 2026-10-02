import { useState } from "react";

import type { MutationOutcome } from "../../lib/api";
import { Button } from "../../ui";
import type { IssueStatus } from "./issue-api";

/**
 * Close or reopen the issue (REQ-5-4).
 *
 * The detail page offers exactly one of the two buttons: “Close issue” while
 * the work item is Open and “Reopen issue” while it is Closed. Activating it
 * stores the change immediately — there is no separate confirmation — and the
 * page then shows the new status, so the same button turns into its
 * counterpart. For a caller without a role that may change the status (Read,
 * Write or a visitor) neither button is rendered at all; the server refuses the
 * submission regardless of what the page displays.
 */
export interface IssueStatusControlProps {
  status: IssueStatus;
  canChangeStatus: boolean;
  onChange(status: IssueStatus): Promise<MutationOutcome<unknown>>;
}

export function IssueStatusControl({ status, canChangeStatus, onChange }: IssueStatusControlProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canChangeStatus) return null;

  const activate = async () => {
    setSaving(true);
    setError(null);
    const result = await onChange(status === "open" ? "closed" : "open");
    setSaving(false);
    if (!result.ok) setError(result.message);
  };

  return (
    <div className="repository-issue__status-action">
      <Button variant="secondary" disabled={saving} onClick={() => void activate()}>
        {status === "open" ? "Close issue" : "Reopen issue"}
      </Button>
      {error ? (
        <p className="repository-issue__status-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
