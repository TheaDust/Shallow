import { useState } from "react";

import { useHashLocation } from "../lib/hash-route";
import { PullRequestChecks } from "../features/pull-requests/PullRequestChecks";
import { PullRequestConversation } from "../features/pull-requests/PullRequestConversation";
import { PullRequestCommits } from "../features/pull-requests/PullRequestPanels";
import { PullRequestFiles, type PullRequestReviewWriteResult } from "../features/pull-requests/PullRequestFiles";
import { PullRequestMergeControl } from "../features/pull-requests/PullRequestMergeControl";
import { PullRequestReviewers } from "../features/pull-requests/PullRequestReviewers";
import { PullRequestReviewSummary } from "../features/pull-requests/PullRequestReviewSummary";
import { PullRequestStatusControl } from "../features/pull-requests/PullRequestStatusControl";
import { PullRequestTabs, parsePullRequestTab } from "../features/pull-requests/PullRequestTabs";
import {
  addPullRequestReviewComment,
  closePullRequest,
  markPullRequestReadyForReview,
  mergeRepositoryPullRequest,
  PULL_REQUEST_STATUS_LABELS,
  reopenPullRequest,
  removePullRequestReviewer,
  requestPullRequestReviewer,
  savePullRequestCheck,
  submitPullRequestReview,
  type PullRequestCheckStatus,
  type PullRequestDecision,
  type PullRequestDiffSide,
} from "../features/pull-requests/pull-request-api";
import { PullRequestReadyForReviewControl } from "../features/pull-requests/PullRequestReadyForReviewControl";
import { useRepositoryPullRequest } from "../features/pull-requests/use-pull-requests";
import { RepositoryHeader, type RepositoryTab } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryPullRequestPageProps {
  owner: string;
  name: string;
  /** The repository-scoped number from the address. */
  number: string;
}

/**
 * The repository entries of a pull request detail page. "Commits" belongs to
 * the pull-request sections here, so the repository navigation leaves that name
 * to the section links and every navigation name stays unique on the page.
 */
const PULL_REQUEST_HEADER_TABS: RepositoryTab[] = ["code", "issues", "pulls", "settings"];

function PullRequestNotFound({ owner, name }: { owner: string; name: string }) {
  return (
    <main className="repository-page">
      <h1>Pull request not found</h1>
      <p>This repository has no pull request with that number.</p>
      <p>
        <a href={`#/${owner}/${name}/pulls`}>Back to pull requests</a>
      </p>
    </main>
  );
}

/**
 * The detail page of one pull request (REQ-6, REQ-6-1, REQ-6-3).
 *
 * The heading is the persisted title verbatim and the visible status is the
 * stored one. Conversation, Commits, Files changed and Checks are navigation
 * links; the Checks area is attached to the pull request's current compare
 * commit and is available on arrival, where a repository Admin stores the
 * `test` status together with the setter and the time. The merge state spells
 * whether the rule of the base branch is satisfied and why not. A reviewer who
 * is not the author adds inline comments and submits a review decision from the
 * Files changed view; both are answered by the refreshed detail, so a refused
 * write is never displayed as published. The Reviewers area next to the
 * sections manages the pending-review relationships of the proposal (REQ-6-4),
 * and the status entries close or reopen an unmerged pull request (REQ-6-6).
 * The Checks area belongs to the pull request's current compare commit and is
 * available on arrival, whichever section the address names.
 */
export function RepositoryPullRequestPage({ owner, name, number }: RepositoryPullRequestPageProps) {
  const { search } = useHashLocation();
  const tab = parsePullRequestTab(search.get("tab"));
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const { state, payload, reload } = useRepositoryPullRequest(owner, name, number, repositoryState === "ready");
  const [savingCheck, setSavingCheck] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [markingReady, setMarkingReady] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;
  if (state === "missing") return <PullRequestNotFound owner={owner} name={name} />;
  if (state === "denied") {
    return (
      <main className="repository-page">
        <h1>Access denied</h1>
        <p>Your account does not have permission to view this pull request.</p>
      </main>
    );
  }

  const pullRequest = payload?.pullRequest ?? null;
  if (!pullRequest) {
    return (
      <main className="repository-page">
        <p role="status">Loading pull request…</p>
      </main>
    );
  }

  async function saveCheck(status: PullRequestCheckStatus) {
    if (!pullRequest) return;
    setSavingCheck(true);
    setCheckError(null);
    const result = await savePullRequestCheck(owner, name, pullRequest.number, { name: "test", status });
    setSavingCheck(false);
    if (!result.ok) {
      setCheckError(result.errors.status ?? result.message);
      return;
    }
    reload();
  }

  async function markReady() {
    if (!pullRequest) return;
    setMarkingReady(true);
    setReadyError(null);
    const result = await markPullRequestReadyForReview(owner, name, pullRequest.number);
    setMarkingReady(false);
    if (!result.ok) {
      setReadyError(result.message);
      return;
    }
    reload();
  }

  async function merge() {
    if (!pullRequest) return;
    setMerging(true);
    setMergeError(null);
    const result = await mergeRepositoryPullRequest(owner, name, pullRequest.number);
    setMerging(false);
    if (!result.ok) {
      setMergeError(result.errors.blockers ?? result.message);
      return;
    }
    reload();
  }

  /** Closes or reopens the pull request without merging it (REQ-6-6). */
  async function changeStatus(action: "close" | "reopen") {
    if (!pullRequest) return;
    setChangingStatus(true);
    setStatusError(null);
    const result = action === "close"
      ? await closePullRequest(owner, name, pullRequest.number)
      : await reopenPullRequest(owner, name, pullRequest.number);
    setChangingStatus(false);
    if (!result.ok) {
      setStatusError(result.message);
      return;
    }
    reload();
  }

  /**
   * Stores or deletes one pending-review relationship (REQ-6-4). Both writes are
   * answered by the refreshed detail, so the Reviewers area never shows a
   * request the server did not store.
   */
  async function requestReviewer(username: string): Promise<PullRequestReviewWriteResult> {
    if (!pullRequest) return { ok: false };
    const result = await requestPullRequestReviewer(owner, name, pullRequest.number, username);
    if (!result.ok) return { ok: false, message: result.errors.username ?? result.message };
    reload();
    return { ok: true };
  }

  async function removeReviewer(username: string): Promise<PullRequestReviewWriteResult> {
    if (!pullRequest) return { ok: false };
    const result = await removePullRequestReviewer(owner, name, pullRequest.number, username);
    if (!result.ok) return { ok: false, message: result.message };
    reload();
    return { ok: true };
  }

  /** Stores one inline review comment of the current compare commit (REQ-6-3-3). */
  async function comment(input: {
    filePath: string;
    line: number;
    side: PullRequestDiffSide;
    body: string;
    pending: boolean;
  }): Promise<PullRequestReviewWriteResult> {
    if (!pullRequest) return { ok: false };
    const result = await addPullRequestReviewComment(owner, name, pullRequest.number, input);
    if (!result.ok) {
      return { ok: false, message: result.errors.body ?? result.message };
    }
    reload();
    return { ok: true };
  }

  /** Stores one review decision of the current compare commit (REQ-6-3-4). */
  async function review(input: {
    decision: PullRequestDecision;
    summary: string;
  }): Promise<PullRequestReviewWriteResult> {
    if (!pullRequest) return { ok: false };
    const result = await submitPullRequestReview(owner, name, pullRequest.number, input);
    if (!result.ok) {
      return { ok: false, message: result.errors.decision ?? result.errors.summary ?? result.message };
    }
    reload();
    return { ok: true };
  }

  return (
    <main className="repository-pull-request-page">
      <RepositoryHeader
        repository={repository}
        cloneUrls={repository.cloneUrls}
        active="pulls"
        tabs={PULL_REQUEST_HEADER_TABS}
      />
      <article className="pull-request" aria-label={`Pull request ${pullRequest.number}`}>
        <h1 className="pull-request__title">{pullRequest.title}</h1>
        <p className="pull-request__meta">
          <span className="pull-request__status">{PULL_REQUEST_STATUS_LABELS[pullRequest.status]}</span>
          <span className="pull-request__branches">
            {`${pullRequest.author} wants to merge into `}
            <code className="pull-request__branch">{pullRequest.baseBranch}</code>
            {` from `}
            <code className="pull-request__branch">{pullRequest.compareBranch}</code>
          </span>
        </p>

        <PullRequestReadyForReviewControl
          pullRequest={pullRequest}
          working={markingReady}
          error={readyError}
          onConfirm={markReady}
        />

        <PullRequestStatusControl
          pullRequest={pullRequest}
          working={changingStatus}
          error={statusError}
          onClose={() => {
            void changeStatus("close");
          }}
          onReopen={() => {
            void changeStatus("reopen");
          }}
        />

        <div className="pull-request__body">
          <div className="pull-request__main">
            <PullRequestTabs repository={repository} number={pullRequest.number} active={tab} />

            {tab === "commits" ? (
              <PullRequestCommits repository={repository} pullRequest={pullRequest} />
            ) : null}
            {tab === "files" ? (
              <PullRequestFiles pullRequest={pullRequest} onComment={comment} onReview={review} />
            ) : null}
            {tab === "conversation" ? <PullRequestConversation pullRequest={pullRequest} /> : null}
          </div>

          {/* REQ-6-3-4: next to the sections, the review summary spells the
              stored decisions of the current compare commit, so a review
              submitted from the Files changed view is answered by the page
              itself. Conversation keeps its own copy of the same summary, so
              the name appears once in every view. */}
          <div className="pull-request__aside">
            {tab !== "conversation" ? (
              <PullRequestReviewSummary reviews={pullRequest.reviews} />
            ) : null}
            {/* REQ-6-4: the pending-review relationships live in the Reviewers
                area next to the sections of the pull request. */}
            <PullRequestReviewers
              pullRequest={pullRequest}
              onRequest={requestReviewer}
              onRemove={removeReviewer}
            />
          </div>
        </div>

        {/* The Checks area belongs to the pull request's current compare commit
            and is available on arrival, whichever section the address names. */}
        <PullRequestChecks
          pullRequest={pullRequest}
          canUpdate={pullRequest.permissions.canUpdateChecks}
          saving={savingCheck}
          error={checkError}
          onSave={saveCheck}
        />

        <PullRequestMergeControl
          pullRequest={pullRequest}
          merging={merging}
          error={mergeError}
          onMerge={merge}
        />
      </article>
    </main>
  );
}
