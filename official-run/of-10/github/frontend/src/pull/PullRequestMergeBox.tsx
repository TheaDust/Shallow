import { useState } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  MERGE_METHOD,
  MERGE_METHOD_LABEL,
  mergePullRequest,
  type PullRequestDetail,
  type PullRequestMergeCondition,
  type PullRequestPayload,
} from "../lib/pull-requests-api";
import { issueDateTime } from "../lib/issue-dates";
import { Button } from "../ui";

export interface PullRequestMergeBoxProps {
  owner: string;
  name: string;
  number: number;
  pullRequest: PullRequestDetail;
  /** The stored answer of a successful merge; the page shows it. */
  onSaved(payload: PullRequestPayload): void;
}

/** One merge condition, shown as satisfied or unsatisfied (REQ-6-5). */
function MergeConditionList({ conditions }: { conditions: readonly PullRequestMergeCondition[] }) {
  return (
    <ul className="pull-merge__conditions">
      {conditions.map((condition) => (
        <li
          key={condition.id}
          className="pull-merge__condition"
          data-satisfied={condition.satisfied}
        >
          <span className="pull-merge__condition-label">{condition.label}</span>
          {": "}
          <span className="pull-merge__condition-state">
            {condition.satisfied ? "satisfied" : "unsatisfied"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The merge area of one pull request (REQ-6-5). `Create a merge commit` is the
 * only selectable method and is offered as the single radio control of the area,
 * together with the conditions the merge currently satisfies or still misses.
 * `Merge pull request` opens the confirmation box of this page and `Confirm
 * merge` then performs the merge; a blocked proposal keeps the same button
 * visibly disabled and states why (`Review required by branch protection` for a
 * missing approval) before any click. A merged proposal shows the stored result
 * — merger, time and merge commit — because Merged is terminal.
 *
 * Only Maintain, Admin and an organization Owner merge (REQ-6-5); a Draft keeps
 * a present but disabled entry for a writing viewer, because the status of the
 * proposal is what prevents the merge (REQ-6-2-4).
 */export function PullRequestMergeBox({
  owner,
  name,
  number,
  pullRequest,
  onSaved,
}: PullRequestMergeBoxProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, mergeability, permissions, merge } = pullRequest;

  if (status === "merged") {
    return (
      <section className="pull-merge" aria-labelledby="pull-merge-heading">
        <h2 id="pull-merge-heading" className="pull-section-heading">
          Merge
        </h2>
        <p className="pull-merge__result">
          {"Merged by "}
          <span className="pull-merge__merger">{merge?.by ?? ""}</span>
          {merge?.at ? (
            <>
              {" at "}
              <time dateTime={merge.at}>{issueDateTime(merge.at)}</time>
            </>
          ) : null}
          {merge?.commitId ? (
            <>
              {" as commit "}
              <code className="pull-merge__commit">{merge.commitId}</code>
            </>
          ) : null}
        </p>
      </section>
    );
  }

  const canMergeHere =
    permissions.canMerge && (status === "open" || status === "draft");
  // A Draft proposal keeps its `Merge pull request` entry present but disabled
  // for every viewer who may write in the repository, even without the merge
  // permission itself (REQ-6-2-4).
  const draftEntry = status === "draft" && !permissions.canMerge && permissions.canWrite;
  if (!canMergeHere && !draftEntry) return null;

  const blocked = !mergeability.mergeable;

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await mergePullRequest(owner, name, number, MERGE_METHOD));
      setConfirming(false);
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(fields.status ?? apiErrorMessage(caught, "The pull request could not be merged."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pull-merge" aria-labelledby="pull-merge-heading">
      <h2 id="pull-merge-heading" className="pull-section-heading">
        Merge
      </h2>
      <fieldset className="pull-merge__methods">
        <legend>Merge method</legend>
        <p className="ui-field ui-field--radio">
          <label htmlFor={`pull-merge-method-${number}`}>
            <input
              id={`pull-merge-method-${number}`}
              type="radio"
              name={`pull-merge-method-${number}`}
              value={MERGE_METHOD}
              checked
              onChange={() => undefined}
            />
            {MERGE_METHOD_LABEL}
          </label>
        </p>
      </fieldset>
      <MergeConditionList conditions={mergeability.conditions} />
      {blocked ? (
        <ul className="pull-merge__reasons">
          {mergeability.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p className="pull-merge__ready">This pull request is ready to be merged.</p>
      )}
      <p className="pull-merge__actions">
        <Button
          variant="primary"
          disabled={busy || blocked}
          onClick={() => setConfirming(true)}
        >
          Merge pull request
        </Button>
      </p>
      {confirming ? (
        <div className="pull-merge__confirm" role="group" aria-label="Merge confirmation">
          <p className="pull-merge__confirm-note">
            Confirm that this pull request is merged into the base branch.
          </p>
          <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
            Confirm merge
          </Button>
          <Button disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="form-message form-message--error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
