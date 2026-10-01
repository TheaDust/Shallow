import { useEffect, useId, useState } from "react";

import { Button } from "../../ui";
import type { PullRequestCheckStatus, PullRequestDetail } from "./pull-request-api";

/** The statuses the `test` status combobox offers (REQ-6-1). */
const CHECK_STATUS_OPTIONS: PullRequestCheckStatus[] = ["pending", "success", "failure"];

export interface PullRequestChecksProps {
  pullRequest: PullRequestDetail;
  /** True when the caller may update the status from this area (Admin only). */
  canUpdate: boolean;
  saving: boolean;
  error: string | null;
  onSave(status: PullRequestCheckStatus): void;
}

/**
 * The Checks area of a pull request detail page (REQ-6-1).
 *
 * It is attached to the pull request's current compare commit and spells the
 * stored `test` status together with the account that set it and the time; a
 * compare commit without a stored result is shown as `test: pending`. A
 * repository Admin picks a status in the `test status` combobox — a native
 * `select`, so its `success` entry is a selectable option — and saves it with
 * `Save`; every other viewer reads the result without a control to change it.
 */
export function PullRequestChecks({
  pullRequest,
  canUpdate,
  saving,
  error,
  onSave,
}: PullRequestChecksProps) {
  const check = pullRequest.check;
  const selectId = useId();
  const [draft, setDraft] = useState<PullRequestCheckStatus>(check.status);

  // A refreshed result — or a compare commit that moved — resets the choice to
  // the stored one, so the control never keeps a value the server did not store.
  useEffect(() => {
    setDraft(check.status);
  }, [check.status, check.commitId]);

  return (
    <section className="pull-request-checks" aria-label="Checks">
      <h2 className="pull-request-checks__heading">Checks</h2>
      <p className="pull-request-checks__status">{`${check.name}: ${check.status}`}</p>
      {check.setBy && check.setAt ? (
        <p className="pull-request-checks__setter">
          {`Set by ${check.setBy} at `}
          <time dateTime={check.setAt}>{check.setAt}</time>
        </p>
      ) : null}
      {canUpdate ? (
        <div className="pull-request-checks__update">
          <label className="pull-request-checks__label" htmlFor={selectId}>
            test status
          </label>
          <select
            id={selectId}
            name="checkStatus"
            value={draft}
            onChange={(event) => setDraft(event.target.value as PullRequestCheckStatus)}
          >
            {CHECK_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <Button variant="primary" disabled={saving} onClick={() => onSave(draft)}>
            Save
          </Button>
        </div>
      ) : (
        <p className="pull-request-checks__restricted">
          Only a repository Admin can update the test status.
        </p>
      )}
      {error ? (
        <p className="pull-request-checks__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
