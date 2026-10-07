import { useState } from "react";

import { formatRelativeTime } from "../lib/format";
import { mergeRepositoryPullRequest, type PullRequestMergeState, type PullRequestSummary } from "../lib/org-api";
import { Button, Dialog } from "../ui";

export interface PullRequestMergeProps {
  owner: string;
  name: string;
  number: string;
  pullRequest: PullRequestSummary;
  merge: PullRequestMergeState;
  /** Only Maintain, Admin or the organization Owner may merge (REQ-6-5). */
  canMaintain: boolean;
  signedIn: boolean;
  /** Reloads the pull request and its branches after a successful merge. */
  onChanged(): void;
}

/** The satisfied and unsatisfied merge conditions of the confirmation area. */
function MergeConditions({ merge }: { merge: PullRequestMergeState }) {
  return (
    <ul className="pull-merge__conditions">
      {merge.conditions.map((condition) => (
        <li
          key={condition.key}
          className="pull-merge__condition"
          data-satisfied={condition.satisfied}
        >
          <span className="pull-merge__condition-label">{condition.label}</span>
          <span className="pull-merge__condition-state">
            {condition.satisfied ? "Satisfied" : "Unsatisfied"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Merge control of a pull request (REQ-6-5). `Create a merge commit` is the only
 * supported method, so the single method control is pre-selected. `Merge pull
 * request` stays a visible button: it only opens the confirmation box when every
 * condition is met, otherwise it is disabled and the unmet protection
 * requirement (`Review required by branch protection`) is explained before any
 * click. `Confirm merge` performs the merge and the result — Merged, the merger,
 * the time and the resulting commit — is read back from the store.
 */
export function PullRequestMerge({
  owner,
  name,
  number,
  pullRequest,
  merge,
  canMaintain,
  signedIn,
  onChanged,
}: PullRequestMergeProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canMerge = signedIn && canMaintain && merge.eligible;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await mergeRepositoryPullRequest(owner, name, number);
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors.status ?? result.message);
      return;
    }
    setConfirmOpen(false);
    onChanged();
  };

  return (
    <section className="pull-merge" aria-label="Merge">
      <h2 className="pull-merge__title">Merge</h2>
      {pullRequest.status === "merged" ? (
        <div className="pull-merge__result">
          <p className="pull-merge__method">Create a merge commit</p>
          <p className="pull-merge__merged">Merged by {pullRequest.mergedBy}</p>
          {pullRequest.mergedAt ? (
            <p className="pull-merge__time">{formatRelativeTime(pullRequest.mergedAt)}</p>
          ) : null}
          {pullRequest.mergedCommitId ? (
            <p className="pull-merge__commit">Merge commit {pullRequest.mergedCommitId}</p>
          ) : null}
        </div>
      ) : signedIn ? (
        <>
          <div className="pull-merge__methods">
            <p className="pull-merge__methods-label">Merge method</p>
            <label className="pull-merge__method-option">
              <input type="radio" name="merge-method" value="merge" checked readOnly />
              Create a merge commit
            </label>
          </div>
          <MergeConditions merge={merge} />
          {!merge.eligible && merge.blockedReason ? (
            <p className="pull-merge__blocked" role="status">
              {merge.blockedReason}
            </p>
          ) : null}
          <Button
            variant="primary"
            disabled={!canMerge || busy}
            onClick={() => setConfirmOpen(true)}
          >
            Merge pull request
          </Button>
          {error && !confirmOpen ? (
            <p className="pull-merge__error" role="alert">
              {error}
            </p>
          ) : null}
          {confirmOpen ? (
            <Dialog
              open
              title="Merge pull request"
              onOpenChange={(next) => setConfirmOpen(next)}
              actions={
                <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
                  Confirm merge
                </Button>
              }
            >
              <p className="pull-merge__confirm-note">
                {`Merge ${pullRequest.sourceBranch} into ${pullRequest.targetBranch}.`}
              </p>
              <MergeConditions merge={merge} />
              {error ? (
                <p className="pull-merge__error" role="alert">
                  {error}
                </p>
              ) : null}
            </Dialog>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
