import { useState } from "react";

import { Button, Dialog } from "../../ui";
import { formatIssueTime } from "../issues/format-issue-time";
import type { PullRequestDetail } from "./pull-request-api";

export interface PullRequestMergeControlProps {
  pullRequest: PullRequestDetail;
  merging: boolean;
  error: string | null;
  onMerge(): void;
}

/**
 * The merge state of a pull request (REQ-6, REQ-6-1, REQ-6-5).
 *
 * A pull request is mergeable only when every condition is gone: the rule bound
 * to the base branch is satisfied, no reviewer requested changes and the pull
 * request is still open. The page states the result and spells every condition
 * as satisfied or unsatisfied before any click, so a blocked pull request keeps
 * its visible disabled `Merge pull request` entry next to the reason it cannot
 * be merged — a missing required approval reads `Review required by branch
 * protection`. Only Maintain, Admin and organization Owner get the entry, and
 * the confirmation states the sole supported method `Create a merge commit`;
 * `Confirm merge` then performs the merge, after which the page spells Merged
 * with the merger, the time and the resulting commit identifier.
 */
export function PullRequestMergeControl({
  pullRequest,
  merging,
  error,
  onMerge,
}: PullRequestMergeControlProps) {
  const { merge, permissions, status } = pullRequest;
  const [confirming, setConfirming] = useState(false);

  const conditions = (
    <ul className="pull-request-merge__conditions">
      {merge.conditions.map((condition) => (
        <li key={condition.code} className="pull-request-merge__condition">
          {`${condition.label}: ${condition.satisfied ? "satisfied" : "not satisfied"}`}
        </li>
      ))}
    </ul>
  );

  return (
    <section className="pull-request-merge" aria-label="Merge status">
      <h2 className="pull-request-merge__heading">Merge</h2>
      <p className="pull-request-merge__state">
        {merge.mergeable ? "This pull request is mergeable." : "This pull request is unmergeable."}
      </p>
      {merge.blockers.length > 0 ? (
        <ul className="pull-request-merge__blockers">
          {merge.blockers.map((blocker) => (
            <li key={blocker.code} className="pull-request-merge__blocker">
              {blocker.message}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="pull-request-merge__rule">
        {merge.rules.pattern
          ? `The branch protection rule ${merge.rules.pattern} applies to this pull request.`
          : "The base branch carries no branch protection rule."}
      </p>
      <ul className="pull-request-merge__methods" aria-label="Merge method">
        <li className="pull-request-merge__method">
          <label>
            <input type="radio" name="merge-method" value="merge_commit" checked readOnly />
            Create a merge commit
          </label>
        </li>
      </ul>
      {merge.conditions.length > 0 ? (
        <>
          <h3 className="pull-request-merge__conditions-heading">Merge conditions</h3>
          {conditions}
        </>
      ) : null}
      {permissions.canMerge ? (
        <Button
          variant="primary"
          disabled={!merge.mergeable || merging}
          onClick={() => setConfirming(true)}
        >
          Merge pull request
        </Button>
      ) : null}
      {status === "merged" && pullRequest.mergedAt ? (
        <p className="pull-request-merge__result">
          {`Merged by ${pullRequest.mergedBy} at `}
          <time dateTime={pullRequest.mergedAt}>{formatIssueTime(pullRequest.mergedAt)}</time>
          {pullRequest.mergeCommitId ? ` in commit ${pullRequest.mergeCommitId}` : ""}
        </p>
      ) : null}
      {confirming ? (
        <Dialog
          open
          title="Confirm merge"
          description="The changes of the compare branch are written into the base branch."
          onOpenChange={setConfirming}
          actions={
            <Button
              variant="primary"
              disabled={merging}
              onClick={() => {
                setConfirming(false);
                onMerge();
              }}
            >
              Confirm merge
            </Button>
          }
        >
          <p>{`Create a merge commit for “${pullRequest.title}”?`}</p>
          {conditions}
        </Dialog>
      ) : null}
      {error ? (
        <p className="pull-request-merge__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
