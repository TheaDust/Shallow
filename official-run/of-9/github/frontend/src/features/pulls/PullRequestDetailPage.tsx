import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { formatUpdatedTime } from "../../lib/format";
import { useHashLocation } from "../../lib/hash-route";
import { Button, Dialog } from "../../ui";
import { useSession } from "../auth/session";
import { RepoNav } from "../issues/RepoNav";
import { AccessDenied } from "../organizations/AccessDenied";
import { DiffView } from "../organizations/DiffView";
import type { RepoRole } from "../organizations/api";
import {
  addInlineComment,
  getPullRequest,
  mergePullRequest,
  readyForReview,
  removeReviewer,
  requestReviewer,
  setPullRequestStatus,
  submitPullRequestReview,
  updatePullRequestCheck,
  type PullRequestDetailData,
  type PullRequestTimelineEntry,
  type ReviewDecision,
} from "./api";
import { ChecksPanel } from "./ChecksPanel";
import { MergeBox } from "./MergeBox";
import { ReviewChangesForm } from "./ReviewChangesForm";
import { ReviewersPanel } from "./ReviewersPanel";

type PullTab = "conversation" | "commits" | "files" | "checks";

const TABS: Array<{ id: PullTab; label: string }> = [
  { id: "conversation", label: "Conversation" },
  { id: "commits", label: "Commits" },
  { id: "files", label: "Files changed" },
  { id: "checks", label: "Checks" },
];

function statusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "closed":
      return "Closed";
    case "merged":
      return "Merged";
    default:
      return "Draft";
  }
}

function timelineText(entry: PullRequestTimelineEntry): string {
  switch (entry.type) {
    case "created":
      return `${entry.author} created this pull request`;
    case "comment":
      return `${entry.author} commented`;
    case "reviewer-requested":
      return `${entry.author} requested review from ${entry.targetUsername}`;
    case "reviewer-removed":
      return `${entry.author} removed the request for review from ${entry.targetUsername}`;
    case "closed":
      return "Closed pull request";
    case "reopened":
      return "Reopened pull request";
    case "merged":
      return "Merged pull request";
    case "ready-for-review":
      return "Ready for review";
    case "review":
      return `${entry.author} reviewed (${entry.decision ?? "comment"})`;
    default:
      return `${entry.author} updated this pull request`;
  }
}

export function PullRequestDetailPage({
  owner,
  name,
  number,
}: {
  owner: string;
  name: string;
  number: string;
}) {
  const pullNumber = Number(number);
  const location = useHashLocation();
  const { session } = useSession();
  const currentUser = session.status === "authenticated" ? session.account.username : null;
  const tabParam = location.search.get("tab");
  const tab: PullTab =
    tabParam === "commits" || tabParam === "files" || tabParam === "checks"
      ? tabParam
      : "conversation";
  const [data, setData] = useState<PullRequestDetailData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "missing">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  const [readyBusy, setReadyBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await getPullRequest(owner, name, pullNumber);
    setData(result);
    setStatus("ok");
  }, [owner, name, pullNumber]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setNotice(null);
    setError(null);
    getPullRequest(owner, name, pullNumber)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus("ok");
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        if (requestError instanceof ApiError && requestError.status === 403) setStatus("denied");
        else setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, pullNumber]);

  if (status === "denied") {
    return (
      <section className="pull-detail">
        <RepoNav owner={owner} name={name} active="pulls" />
        <AccessDenied />
      </section>
    );
  }
  if (status === "missing") {
    return (
      <section className="pull-detail">
        <RepoNav owner={owner} name={name} active="pulls" />
        <h1>Pull request not found</h1>
      </section>
    );
  }
  if (status === "loading" || !data) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const { pull, myRole, files, commits, mergeEligibility } = data;
  const isAuthor = currentUser === pull.author;
  const canManage = canManagePull(myRole, isAuthor);
  const isAdmin = myRole === "admin";
  const canMerge = myRole !== null && ["maintain", "admin"].includes(myRole) && pull.status === "open";
  const canComment =
    pull.status === "open" &&
    !isAuthor &&
    myRole !== null &&
    ["write", "maintain", "admin"].includes(myRole);
  const visibleInlineComments = pull.inlineComments.filter(
    (comment) => comment.state === "published" || comment.author === currentUser,
  );

  const closeOrReopen = async (target: "open" | "closed") => {
    setError(null);
    const result = await setPullRequestStatus(owner, name, pullNumber, target);
    if (result.ok) {
      setNotice(target === "closed" ? "Pull request closed" : "Pull request reopened");
      await reload();
    } else {
      setError(Object.values(result.errors)[0] ?? "Unable to update the pull request status");
    }
  };

  const saveCheck = async (checkStatus: "pending" | "success" | "failure") => {
    const result = await updatePullRequestCheck(owner, name, pullNumber, checkStatus);
    if (result.ok) {
      await reload();
      return true;
    }
    return false;
  };

  const merge = async () => {
    const result = await mergePullRequest(owner, name, pullNumber);
    if (result.ok) {
      setNotice("Pull request merged");
      await reload();
      return true;
    }
    setError(
      result.reasons?.[0] ?? Object.values(result.errors ?? {})[0] ?? "Unable to merge the pull request",
    );
    return false;
  };

  const requestReviewerAction = async (username: string) => {
    const result = await requestReviewer(owner, name, pullNumber, username);
    if (result.ok) await reload();
    else setError(Object.values(result.errors)[0] ?? "Unable to request a reviewer");
  };

  const removeReviewerAction = async (username: string) => {
    const result = await removeReviewer(owner, name, pullNumber, username);
    if (result.ok) await reload();
    else setError(Object.values(result.errors)[0] ?? "Unable to remove the reviewer");
  };

  const confirmReady = async () => {
    if (readyBusy) return;
    setReadyBusy(true);
    const result = await readyForReview(owner, name, pullNumber);
    setReadyBusy(false);
    if (result.ok) {
      setReadyOpen(false);
      setNotice("Pull request marked as ready for review");
      await reload();
    } else {
      setError(
        Object.values(result.errors)[0] ?? "Unable to mark the pull request as ready for review",
      );
    }
  };

  const publishComment = async (path: string, line: number, body: string) => {
    const result = await addInlineComment(owner, name, pullNumber, { path, line, body, draft: false });
    if (result.ok) {
      await reload();
      return { ok: true };
    }
    return {
      ok: false,
      error: Object.values(result.errors)[0] ?? "The comment could not be published",
    };
  };

  const startReviewComment = async (path: string, line: number, body: string) => {
    const result = await addInlineComment(owner, name, pullNumber, { path, line, body, draft: true });
    if (result.ok) {
      await reload();
      return { ok: true };
    }
    return {
      ok: false,
      error: Object.values(result.errors)[0] ?? "The comment could not be saved as pending",
    };
  };

  const submitReview = async (decision: ReviewDecision, summary: string) => {
    if (reviewBusy) return;
    setReviewBusy(true);
    setReviewError(null);
    const result = await submitPullRequestReview(owner, name, pullNumber, { decision, summary });
    setReviewBusy(false);
    if (result.ok) {
      setReviewOpen(false);
      setNotice("Review submitted");
      await reload();
      return;
    }
    setReviewError(Object.values(result.errors)[0] ?? "The review could not be submitted");
  };

  return (
    <section className="pull-detail">
      <RepoNav owner={owner} name={name} active="pulls" />
      <header className="pull-detail__header">
        <div className="pull-detail__title-row">
          <h1 className="pull-detail__title">{pull.title}</h1>
          <span className={`pull-detail__status pull-detail__status--${pull.status}`}>
            {statusLabel(pull.status)}
          </span>
        </div>
        <p className="pull-detail__meta">
          <span className="pull-detail__number">#{pull.number}</span>
          <span className="pull-detail__author">{pull.author}</span>
          <span className="pull-detail__branches">
            {pull.compareBranch} into {pull.baseBranch}
          </span>
          <span className="pull-detail__updated">
            Updated {formatUpdatedTime(pull.updatedAt)}
          </span>
        </p>
        {canManage && (pull.status === "open" || pull.status === "draft" || pull.status === "closed") ? (
          <div className="pull-detail__status-actions">
            {pull.status === "closed" ? (
              <button type="button" className="ui-button" onClick={() => void closeOrReopen("open")}>
                Reopen pull request
              </button>
            ) : (
              <button type="button" className="ui-button" onClick={() => void closeOrReopen("closed")}>
                Close pull request
              </button>
            )}
            {pull.status === "draft" ? (
              <button type="button" className="ui-button ui-button--primary" onClick={() => setReadyOpen(true)}>
                Ready for review
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {notice ? (
        <p role="status" className="pull-detail__notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="pull-detail__error">
          {error}
        </p>
      ) : null}

      <nav className="pull-tabs" aria-label="Pull request">
        {TABS.map((entry) => (
          <a
            key={entry.id}
            href={`#/repos/${owner}/${name}/pulls/${pullNumber}?tab=${entry.id}`}
            className={tab === entry.id ? "pull-tabs__tab pull-tabs__tab--active" : "pull-tabs__tab"}
            aria-current={tab === entry.id ? "page" : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>

      <div className="pull-detail__layout">
        <div className="pull-detail__main">
          {tab === "conversation" ? (
            <div className="pull-conversation">
              <article className="pull-conversation__description">
                <p className="pull-conversation__body">
                  {pull.description || "No description provided."}
                </p>
              </article>
              {pull.comments.map((comment) => (
                <article key={comment.id} className="pull-conversation__comment">
                  <p className="pull-conversation__comment-meta">
                    <strong>{comment.author}</strong> commented{" "}
                    <time dateTime={comment.createdAt}>{formatUpdatedTime(comment.createdAt)}</time>
                  </p>
                  <p className="pull-conversation__comment-body">{comment.body}</p>
                </article>
              ))}
              {pull.reviewSummary.map((review) => (
                <article key={review.reviewer} className="pull-conversation__review">
                  <p className="pull-conversation__review-meta">
                    <strong>{review.reviewer}</strong> {reviewDecisionLabel(review.decision)}{" "}
                    <time dateTime={review.createdAt}>{formatUpdatedTime(review.createdAt)}</time>
                  </p>
                  {review.explanation ? (
                    <p className="pull-conversation__review-body">{review.explanation}</p>
                  ) : null}
                </article>
              ))}
              {visibleInlineComments.map((comment) => (
                <article key={comment.id} className="pull-conversation__comment">
                  <p className="pull-conversation__comment-meta">
                    <strong>{comment.author}</strong> commented on {comment.path} line {comment.line}
                    {comment.state === "pending" ? (
                      <span className="diff-comment__badge diff-comment__badge--pending">
                        Pending review
                      </span>
                    ) : null}
                    {comment.outdated ? (
                      <span className="diff-comment__badge diff-comment__badge--outdated">
                        Outdated
                      </span>
                    ) : null}
                  </p>
                  <p className="pull-conversation__comment-body">{comment.body}</p>
                </article>
              ))}
              <section className="pull-conversation__timeline" aria-label="Activity">
                <h2>Activity</h2>
                <ul className="pull-timeline">
                  {pull.timeline.map((entry) => (
                    <li key={entry.id}>
                      <article className="pull-timeline__entry">
                        <span>{timelineText(entry)}</span>
                        {entry.type === "closed" || entry.type === "reopened" || entry.type === "merged" ? (
                          <span className="pull-timeline__actor"> by {entry.author}</span>
                        ) : null}{" "}
                        <time dateTime={entry.createdAt}>{formatUpdatedTime(entry.createdAt)}</time>
                      </article>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}

          {tab === "commits" ? (
            <section className="pull-commits" aria-label="Commits">
              <h2>Commit summary</h2>
              <p className="pull-commits__count">
                {commits.length} {commits.length === 1 ? "commit" : "commits"}
              </p>
              {commits.length === 0 ? (
                <p className="pull-commits__empty">No commits.</p>
              ) : (
                <ul className="pull-commits__list">
                  {commits.map((commit) => (
                    <li key={commit.id} className="pull-commits__item">
                      <p className="pull-commits__message">{commit.message}</p>
                      <p className="pull-commits__meta">
                        <span className="pull-commits__short">{commit.shortId}</span>
                        <span className="pull-commits__author">{commit.author}</span>
                        <time dateTime={commit.createdAt}>{formatUpdatedTime(commit.createdAt)}</time>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {tab === "files" ? (
            <div className="pull-files">
              {canComment ? (
                <div className="pull-files__review-entry">
                  <Button variant="primary" onClick={() => setReviewOpen(true)}>
                    Review changes
                  </Button>
                </div>
              ) : null}
              <DiffView
                repository={{ owner, name }}
                base={pull.baseCommit}
                compare={pull.currentCompareCommit}
                files={files.files}
                totalAdditions={files.totalAdditions}
                totalDeletions={files.totalDeletions}
                hrefFor={() => `#/repos/${owner}/${name}/pulls/${pullNumber}?tab=files`}
                showAll
                canComment={canComment}
                inlineComments={visibleInlineComments}
                onPublishComment={publishComment}
                onStartReview={startReviewComment}
              />
            </div>
          ) : null}

          {tab === "checks" ? (
            <ChecksPanel
              status={pull.checks.status}
              setter={pull.checks.setter}
              setAt={pull.checks.setAt}
              canUpdate={isAdmin}
              onSave={saveCheck}
            />
          ) : null}
        </div>

        <aside className="pull-detail__sidebar">
          <ReviewersPanel
            reviewers={pull.requestedReviewers.map((request) => request.username)}
            candidates={data.eligibleReviewers}
            canManage={canManage}
            onRequest={(username) => void requestReviewerAction(username)}
            onRemove={(username) => void removeReviewerAction(username)}
          />
          {pull.reviewSummary.length > 0 ? (
            <section className="pull-review-summary" aria-label="Review summary">
              <h3 className="pull-review-summary__heading">Review summary</h3>
              <ul className="pull-review-summary__list">
                {pull.reviewSummary.map((review) => (
                  <li key={review.reviewer} className="pull-review-summary__item">
                    <p className="pull-review-summary__meta">
                      <strong>{review.reviewer}</strong> {reviewDecisionLabel(review.decision)}
                    </p>
                    {review.explanation ? (
                      <p className="pull-review-summary__body">{review.explanation}</p>
                    ) : null}
                    <time dateTime={review.createdAt} className="pull-review-summary__time">
                      {formatUpdatedTime(review.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {pull.status === "draft" ? (
            <MergeBox
              eligible={false}
              reasons={["Draft pull requests cannot be merged"]}
              onMerge={merge}
            />
          ) : canMerge ? (
            <MergeBox
              eligible={mergeEligibility.eligible}
              reasons={mergeEligibility.reasons}
              conditions={mergeEligibility.conditions}
              onMerge={merge}
            />
          ) : null}
        </aside>
      </div>

      <ReviewChangesForm
        open={reviewOpen}
        busy={reviewBusy}
        error={reviewError}
        onSubmit={(decision, summary) => void submitReview(decision, summary)}
        onClose={() => {
          setReviewOpen(false);
          setReviewError(null);
        }}
      />

      <Dialog
        open={readyOpen}
        title="Mark as ready for review"
        onOpenChange={setReadyOpen}
        actions={
          <>
            <Button variant="secondary" onClick={() => setReadyOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={readyBusy} onClick={() => void confirmReady()}>
              Confirm
            </Button>
          </>
        }
      >
        <p>
          This changes the pull request from Draft to Open and records a Ready
          for review activity. The title, branches and commits are unchanged.
        </p>
      </Dialog>
    </section>
  );
}

function canManagePull(myRole: RepoRole | null, isAuthor: boolean): boolean {
  if (isAuthor) return true;
  return myRole === "maintain" || myRole === "admin";
}

function reviewDecisionLabel(decision: string): string {
  switch (decision) {
    case "approve":
      return "Approved";
    case "request_changes":
      return "Changes requested";
    default:
      return "Commented";
  }
}
