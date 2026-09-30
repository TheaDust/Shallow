import { useState } from "react";

import { apiErrorMessage } from "../lib/api";
import {
  issueStatusActionLabel,
  saveIssueStatus,
  type IssueStatus,
  type RepositoryIssuePayload,
} from "../lib/issues-api";
import { Button } from "../ui/Button";

export interface IssueStatusActionProps {
  owner: string;
  name: string;
  number: number;
  /** The stored status the button acts on: Open closes, Closed reopens. */
  status: IssueStatus;
  onSaved(payload: RepositoryIssuePayload): void;
}

/**
 * The single status action of an issue detail page (REQ-5-4). It is rendered only
 * for a viewer with Triage, Maintain or Admin permission; activating it stores the
 * transition immediately, without a confirmation step. The status, the operator
 * and the time are written on the server together with one history record, and the
 * page then shows the persisted issue the answer carries, so a refused save keeps
 * the stored status and the timeline.
 */
export function IssueStatusAction({ owner, name, number, status, onSaved }: IssueStatusActionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next: IssueStatus = status === "closed" ? "open" : "closed";

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveIssueStatus(owner, name, number, next));
    } catch (caught) {
      setError(apiErrorMessage(caught, "The status could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="issue-detail__status-action">
      <Button
        variant={next === "closed" ? "primary" : "danger"}
        disabled={busy}
        onClick={() => void activate()}
      >
        {issueStatusActionLabel(status)}
      </Button>
      {error ? (
        <p className="issue-edit__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
