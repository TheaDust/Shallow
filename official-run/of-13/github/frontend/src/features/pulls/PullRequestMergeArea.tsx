import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  mergeRepositoryPullRequest,
  type RepositoryPullRequestDetail,
} from "../../lib/pull-requests-api";
import { Button, Dialog } from "../../ui";
import { formatPullRequestTime } from "./pull-format";

export interface PullRequestMergeAreaProps {
  owner: string;
  name: string;
  detail: RepositoryPullRequestDetail;
  /** The answer of an accepted merge: the page shows the stored record. */
  onUpdated(detail: RepositoryPullRequestDetail): void;
}

/**
 * The merge area of one pull request. The product supports exactly one merge
 * method — `Create a merge commit` — so the area displays that single method
 * together with every condition of the merge and its state: an unmet review or
 * protection condition is explained next to the disabled `Merge pull request`
 * button, before any click. `Merge pull request` opens the confirmation box,
 * whose `Confirm merge` button performs the merge; the server rereads the
 * target-branch head, the current compare commit, the conflicts and the
 * protection rules before it writes anything.
 */
export function PullRequestMergeArea({
  owner,
  name,
  detail,
  onUpdated,
}: PullRequestMergeAreaProps) {
  const { pullRequest } = detail;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirming(false);
    setError(null);
  }, [pullRequest.number]);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await mergeRepositoryPullRequest(owner, name, pullRequest.number));
      setConfirming(false);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The pull request was not merged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pull-request-merge" aria-label="Merge">
      {/* The only supported method; there is no second selectable method. */}
      <fieldset className="pull-request-merge__method">
        <legend>Merge method</legend>
        <label className="pull-request-merge__method-option">
          <input type="radio" name="merge-method" value="merge-commit" checked readOnly />
          Create a merge commit
        </label>
      </fieldset>
      <div className="pull-request-merge__conditions">
        <h2 className="pull-request-merge__heading">Merge conditions</h2>
        <ul className="pull-request-merge__condition-list">
          {detail.mergeConditions.map((condition) => (
            <li key={condition.id} className="pull-request-merge__condition">
              <span className="pull-request-merge__condition-label">{condition.label}</span>
              <span className="pull-request-merge__condition-state">
                {condition.satisfied ? "Satisfied" : "Not satisfied"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Button
        type="button"
        variant="primary"
        disabled={!detail.canMerge || busy}
        onClick={() => setConfirming(true)}
      >
        Merge pull request
      </Button>
      {pullRequest.status === "merged" ? (
        <dl className="pull-request-merge__result">
          <dt>Merge commit</dt>
          <dd>{pullRequest.mergeCommitSha ?? "Not recorded"}</dd>
          <dt>Merger</dt>
          <dd>{pullRequest.mergedBy ?? "Unknown"}</dd>
          <dt>Time</dt>
          <dd>
            {pullRequest.mergedAt ? formatPullRequestTime(pullRequest.mergedAt) : "Unknown"}
          </dd>
        </dl>
      ) : null}
      {error ? (
        <p className="pull-request-merge__error" role="alert">
          {error}
        </p>
      ) : null}
      <Dialog
        open={confirming}
        title="Merge pull request"
        onOpenChange={setConfirming}
        actions={
          <>
            <Button type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={busy} onClick={() => void confirm()}>
              Confirm merge
            </Button>
          </>
        }
      >
        <p>
          {`Merge ${pullRequest.sourceBranch} into ${pullRequest.targetBranch} with a merge commit?`}
        </p>
      </Dialog>
    </section>
  );
}
