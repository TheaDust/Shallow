import { useState } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  updatePullRequestStatus,
  type PullRequestDetail,
  type PullRequestPayload,
} from "../lib/pull-requests-api";
import { Button } from "../ui";

export interface PullRequestStatusActionsProps {
  owner: string;
  name: string;
  pullRequest: PullRequestDetail;
  /** The stored answer of a successful change; the page shows it. */
  onSaved(payload: PullRequestPayload): void;
}

/**
 * The status actions of one pull request (REQ-6, REQ-6-2-4, REQ-6-6). The author
 * or Maintain/Admin mark a Draft as ready for review, close an unmerged pull
 * request and reopen a closed one. Merging lives in the merge area of the page
 * (`PullRequestMergeBox`), so exactly one `Merge pull request` entry exists
 * (REQ-6-5).
 *
 * Merged is terminal, so a merged pull request offers no action here.
 */
export function PullRequestStatusActions({
  owner,
  name,
  pullRequest,
  onSaved,
}: PullRequestStatusActionsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { permissions, status } = pullRequest;

  const actions: Array<{ label: string; status: "open" | "closed" }> = [];
  if (status === "draft" && permissions.canChangeStatus) {
    actions.push({ label: "Ready for review", status: "open" });
  }
  if ((status === "open" || status === "draft") && permissions.canChangeStatus) {
    actions.push({ label: "Close pull request", status: "closed" });
  }
  if (status === "closed" && permissions.canChangeStatus) {
    actions.push({ label: "Reopen pull request", status: "open" });
  }
  if (actions.length === 0) return null;

  async function run(next: "open" | "closed") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await updatePullRequestStatus(owner, name, pullRequest.number, next));
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(fields.status ?? apiErrorMessage(caught, "The status could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pull-actions">
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="secondary"
          disabled={busy}
          onClick={() => void run(action.status)}
        >
          {action.label}
        </Button>
      ))}
      {error ? (
        <p role="alert" className="form-message form-message--error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
