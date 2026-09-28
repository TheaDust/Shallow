import { useState } from "react";

import { mergePullRequest, PullDetail } from "../../lib/pull-api";
import { RepoOwnerType } from "../../lib/repo-api";

interface MergeSectionProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  detail: PullDetail;
  onChanged: (pull: PullDetail) => void;
}

function formatMergeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The Merge area of the pull-request detail page (REQ-6-5): an eligible PR
 * offers a Merge pull request button that opens a confirmation box whose only
 * selectable method is Create a merge commit, with Confirm merge and the
 * satisfied/unsatisfied conditions. A blocked PR keeps a visible disabled
 * Merge pull request button and explains its unmet review or protection
 * condition before any click. After merging, the area shows Merged, the
 * merger, the time, and the resulting commit identifier.
 */
export function MergeSection({ ownerType, ownerName, repoName, detail, onChanged }: MergeSectionProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const isMerged = detail.status === "merged";
  const canStartMerge =
    detail.canMerge && detail.status === "open" && detail.merge.mergeable;

  async function confirmMerge() {
    if (merging) return;
    setMerging(true);
    setError(null);
    try {
      const outcome = await mergePullRequest(ownerType, ownerName, repoName, detail.number);
      if (outcome.ok) {
        setConfirmOpen(false);
        onChanged(outcome.pull);
      } else {
        const reason =
          Array.isArray(outcome.errors.merge) && outcome.errors.merge.length > 0
            ? outcome.errors.merge.join("; ")
            : "Could not merge this pull request";
        setError(reason);
      }
    } finally {
      setMerging(false);
    }
  }

  return (
    <section aria-label="Merge">
      <h3>Merge</h3>
      {isMerged ? (
        <div className="pull-merge__result">
          <p className="pull-detail__merged">Merged</p>
          {detail.mergedBy && (
            <p className="pull-merge__meta">
              Merged by {detail.mergedBy.username} on{" "}
              {detail.mergedAt ? formatMergeTime(detail.mergedAt) : "unknown time"}
            </p>
          )}
          {detail.mergeCommitId && (
            <p className="pull-merge__commit">Merge commit: {detail.mergeCommitId}</p>
          )}
        </div>
      ) : (
        <>
          {detail.merge.mergeable ? (
            <p>Mergeable</p>
          ) : (
            <p>Unmergeable</p>
          )}
          {detail.merge.reasons.map((reason) => (
            <p key={reason} className="pull-detail__reason">
              {reason}
            </p>
          ))}
          <button
            type="button"
            className="button button--primary"
            disabled={!canStartMerge}
            onClick={() => {
              setConfirmOpen(true);
              setError(null);
            }}
          >
            Merge pull request
          </button>
          {!detail.canMerge && detail.status === "open" && (
            <p className="pull-merge__note">Only Maintain, Admin, or organization Owner can merge.</p>
          )}
          {detail.status === "draft" && (
            <p className="pull-merge__note">Draft pull requests cannot be merged.</p>
          )}
        </>
      )}
      {confirmOpen && (
        <div
          className="change-visibility-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Merge pull request"
        >
          <h2>Merge pull request</h2>
          <p>
            Merge #{detail.number} ({detail.compareBranch} into {detail.baseBranch}) with a merge
            commit.
          </p>
          <div className="merge-method">
            <label className="merge-method__option">
              <input type="radio" name="merge-method" value="merge" checked readOnly />
              Create a merge commit
            </label>
          </div>
          <div className="merge-method__conditions">
            {detail.merge.reasons.length === 0 ? (
              <p>All merge conditions are satisfied.</p>
            ) : (
              detail.merge.reasons.map((reason) => (
                <p key={reason} className="pull-detail__reason">
                  {reason}
                </p>
              ))
            )}
          </div>
          {error && (
            <p role="alert" className="branch-selector__error">
              {error}
            </p>
          )}
          <div className="sign-out-dialog__actions">
            <button type="button" className="button" onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={merging}
              onClick={() => void confirmMerge()}
            >
              Confirm merge
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
