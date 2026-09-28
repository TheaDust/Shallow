import { useState } from "react";

import { closePullRequest, PullDetail, reopenPullRequest } from "../../lib/pull-api";
import { RepoOwnerType } from "../../lib/repo-api";

interface CloseReopenSectionProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  detail: PullDetail;
  onChanged: (pull: PullDetail) => void;
}

/**
 * The Close/Reopen area of the pull-request detail page (REQ-6-6): the PR
 * author or a user with Maintain/Admin (including organization Owner) sees
 * Close pull request on an unmerged Open or Draft PR and Reopen pull request
 * on a Closed PR. The action applies immediately without a confirmation
 * dialog and stores the operator, time, and a closed/reopened activity while
 * keeping the discussion, reviews, diff, and branch references viewable. The
 * controls are absent for every other viewer and for Merged PRs (terminal).
 */
export function CloseReopenSection({ ownerType, ownerName, repoName, detail, onChanged }: CloseReopenSectionProps) {
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!detail.canClose || detail.status === "merged") return null;

  async function change(action: "close" | "reopen") {
    if (changing) return;
    setChanging(true);
    setError(null);
    const outcome =
      action === "close"
        ? await closePullRequest(ownerType, ownerName, repoName, detail.number)
        : await reopenPullRequest(ownerType, ownerName, repoName, detail.number);
    setChanging(false);
    if (outcome.ok) {
      onChanged(outcome.pull);
    } else {
      setError(
        typeof outcome.errors.status === "string"
          ? outcome.errors.status
          : "The pull request status could not be changed",
      );
    }
  }

  return (
    <section aria-label="Pull request status" className="pull-status-actions">
      {detail.status === "closed" ? (
        <button
          type="button"
          className="button"
          disabled={changing}
          onClick={() => void change("reopen")}
        >
          Reopen pull request
        </button>
      ) : (
        <button
          type="button"
          className="button"
          disabled={changing}
          onClick={() => void change("close")}
        >
          Close pull request
        </button>
      )}
      {error && (
        <p role="alert" className="branch-selector__error">
          {error}
        </p>
      )}
    </section>
  );
}
