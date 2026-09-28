import { useEffect, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { useHashLocation } from "../../lib/hash-route";
import {
  CheckStatus,
  fetchPullRequestDetail,
  markPullRequestReadyForReview,
  PullDetail,
  pullStatusText,
  ReviewDecision,
  updatePullRequestCheck,
} from "../../lib/pull-api";
import { repoOwnerBase, RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { RepoNavTabs } from "../repos/RepoPageChrome";
import { CloseReopenSection } from "./CloseReopenSection";
import { MergeSection } from "./MergeSection";
import { PullDiffView } from "./PullDiffView";
import { ReviewersPicker } from "./ReviewersPicker";

interface PullRequestDetailPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  number: number;
}

type DetailStatus = "loading" | "ready" | "denied" | "notfound";

export type PullTab = "conversation" | "commits" | "files" | "checks";

function formatCheckTime(iso: string): string {
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

export function reviewDecisionText(decision: ReviewDecision): string {
  switch (decision) {
    case "approve":
      return "approved these changes";
    case "request_changes":
      return "requested changes";
    case "comment":
      return "commented on these changes";
    default:
      return decision;
  }
}

export function reviewStatusText(decision: ReviewDecision): string {
  switch (decision) {
    case "approve":
      return "Approved";
    case "request_changes":
      return "Changes requested";
    case "comment":
      return "Commented";
    default:
      return decision;
  }
}

function activityText(type: string): string {
  switch (type) {
    case "created":
      return "opened this pull request";
    case "ready_for_review":
      return "marked this pull request as ready for review";
    case "closed":
      return "closed this pull request";
    case "reopened":
      return "reopened this pull request";
    case "merged":
      return "merged this pull request";
    default:
      return `${type} this pull request`;
  }
}

/**
 * The pull-request detail page (REQ-6-3): the heading is exactly the
 * persisted title, the status is visible text, and Conversation, Commits,
 * Files changed, and Checks are navigation links. Conversation is the
 * timeline for the description, ordinary comments, inline review comments,
 * review summaries, and status events; the right sidebar shows the Reviewers
 * area (REQ-6-4) and the review summary (REQ-6-3-4). Files changed hosts the
 * inline comments and review submission (REQ-6-3-3/6-3-4); Merge hosts the
 * merge flow (REQ-6-5). A Draft PR offers its author (or Maintain/Admin) a
 * Ready for review button with a single Confirm step (REQ-6-2-4).
 */
export function PullRequestDetailPage({ ownerType, ownerName, repoName, number }: PullRequestDetailPageProps) {
  const location = useHashLocation();
  const { account } = useSession();
  const repoBase = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;
  const rawTab = location.search.get("tab");
  const tab: PullTab =
    rawTab === "commits" || rawTab === "files" || rawTab === "checks" ? rawTab : "conversation";

  const [status, setStatus] = useState<DetailStatus>("loading");
  const [detail, setDetail] = useState<PullDetail | null>(null);
  const [checkStatus, setCheckStatus] = useState<CheckStatus>("pending");
  const [savingCheck, setSavingCheck] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);
  const [markingReady, setMarkingReady] = useState(false);

  async function load() {
    try {
      const pull = await fetchPullRequestDetail(ownerType, ownerName, repoName, number);
      setDetail(pull);
      setCheckStatus(pull.check.status);
      setStatus("ready");
    } catch {
      setStatus("notfound");
    }
  }

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setDetail(null);
    fetchPullRequestDetail(ownerType, ownerName, repoName, number)
      .then((pull) => {
        if (cancelled) return;
        setDetail(pull);
        setCheckStatus(pull.check.status);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("notfound");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerType, ownerName, repoName, number]);

  async function saveCheck() {
    if (savingCheck) return;
    setSavingCheck(true);
    setCheckError(null);
    try {
      await updatePullRequestCheck(ownerType, ownerName, repoName, number, checkStatus);
      await load();
    } catch {
      setCheckError("Could not save the check status");
    } finally {
      setSavingCheck(false);
    }
  }

  useEffect(() => {
    if (!readyOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReadyOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readyOpen]);

  async function confirmReady() {
    if (markingReady) return;
    setMarkingReady(true);
    setReadyError(null);
    const outcome = await markPullRequestReadyForReview(ownerType, ownerName, repoName, number);
    setMarkingReady(false);
    if (outcome.ok) {
      setDetail(outcome.pull);
      setReadyOpen(false);
    } else {
      setReadyError(
        typeof outcome.errors.status === "string"
          ? outcome.errors.status
          : "Could not mark the pull request as ready for review",
      );
    }
  }

  const isAdmin = detail?.currentRole === "admin";
  const isMaintainer =
    detail?.currentRole === "maintain" || detail?.currentRole === "admin";
  const isAuthor = Boolean(detail && account && detail.author.username === account.username);
  const canMarkReady = Boolean(detail && detail.status === "draft" && (isAuthor || isMaintainer));

  return (
    <AppHeader>
      <main>
        <h1>
          {ownerName}/{repoName}
        </h1>
        <RepoNavTabs ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="pulls" />
        {status === "notfound" ? (
          <p>Pull request not found.</p>
        ) : status === "denied" ? (
          <p>Access denied</p>
        ) : status !== "ready" || !detail ? (
          <p>Loading…</p>
        ) : (
          <>
            <h2 className="pull-detail__title">{detail.title}</h2>
            <p className="pull-detail__meta">
              <span className={`issues-list__state issues-list__state--${detail.status}`}>
                {pullStatusText(detail.status)}
              </span>{" "}
              <span>
                #{detail.number} opened by {detail.author.username}
              </span>
              <span>
                {" "}
                wants to merge {detail.compareBranch} into {detail.baseBranch}
              </span>
            </p>
            <nav className="org-tabs" aria-label="Pull request">
              <a
                className="org-tabs__link"
                href={`#${repoBase}/pulls/${number}`}
                aria-current={tab === "conversation" ? "page" : undefined}
              >
                Conversation
              </a>
              <a
                className="org-tabs__link"
                href={`#${repoBase}/pulls/${number}?tab=commits`}
                aria-current={tab === "commits" ? "page" : undefined}
              >
                Commits
              </a>
              <a
                className="org-tabs__link"
                href={`#${repoBase}/pulls/${number}?tab=files`}
                aria-current={tab === "files" ? "page" : undefined}
              >
                Files changed
              </a>
              <a
                className="org-tabs__link"
                href={`#${repoBase}/pulls/${number}?tab=checks`}
                aria-current={tab === "checks" ? "page" : undefined}
              >
                Checks
              </a>
            </nav>
            <div className="pull-detail__layout">
              <div className="pull-detail__content">
                {tab === "conversation" && (
                  <>
                    <MergeSection
                      ownerType={ownerType}
                      ownerName={ownerName}
                      repoName={repoName}
                      detail={detail}
                      onChanged={setDetail}
                    />
                    <CloseReopenSection
                      ownerType={ownerType}
                      ownerName={ownerName}
                      repoName={repoName}
                      detail={detail}
                      onChanged={setDetail}
                    />
                    <section aria-label="Conversation">
                      <h3>Conversation</h3>
                      {detail.description && (
                        <p className="pull-detail__description">{detail.description}</p>
                      )}
                      {(detail.comments ?? []).length === 0 &&
                      (detail.inlineComments ?? []).length === 0 &&
                      (detail.activities ?? []).length === 0 ? (
                        <p>No activity.</p>
                      ) : (
                        <ul className="issue-activity">
                          {(detail.comments ?? []).map((comment) => (
                            <li key={comment.id} className="issue-activity__item">
                              <span className="issue-activity__author">{comment.author.username}</span>
                              <span className="issue-activity__body">{comment.body}</span>
                            </li>
                          ))}
                          {(detail.inlineComments ?? [])
                            .filter((comment) => comment.published)
                            .map((comment) => (
                              <li key={comment.id} className="issue-activity__item">
                                <span className="issue-activity__author">
                                  {comment.author.username}
                                </span>
                                <span className="issue-activity__body">
                                  {comment.body} ({comment.path}:{comment.line}
                                  {comment.outdated ? ", outdated" : ""})
                                </span>
                              </li>
                            ))}
                          {detail.reviews.map((review) => (
                            <li key={review.id} className="issue-activity__item">
                              <span>
                                {review.author.username} {reviewDecisionText(review.decision)}
                                {review.stale ? " (stale)" : ""}
                              </span>
                              {review.explanation && (
                                <span className="issue-activity__body">{review.explanation}</span>
                              )}
                            </li>
                          ))}
                          {detail.activities.map((activity) => (
                            <li key={activity.id} className="issue-activity__item">
                              <span>
                                {activity.actor.username} {activityText(activity.type)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {canMarkReady && (
                        <button
                          type="button"
                          className="button button--primary"
                          onClick={() => {
                            setReadyError(null);
                            setReadyOpen(true);
                          }}
                        >
                          Ready for review
                        </button>
                      )}
                      {readyError && (
                        <p role="alert" className="branch-selector__error">
                          {readyError}
                        </p>
                      )}
                    </section>
                  </>
                )}
                {tab === "commits" && (
                  <section aria-label="Commits">
                    <h3>Commit summary</h3>
                    <p>
                      {detail.commits.length} {detail.commits.length === 1 ? "commit" : "commits"}{" "}
                      on {detail.compareBranch} relative to {detail.baseBranch}
                    </p>
                    {detail.commits.length === 0 ? (
                      <p>No commits.</p>
                    ) : (
                      <ul className="commit-history">
                        {detail.commits.map((commit) => (
                          <li key={commit.id} className="commit-history__item">
                            <span className="commit-history__message">{commit.message}</span>
                            <span className="commit-history__meta">
                              {commit.authorName} · {commit.shortId}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
                {tab === "files" && (
                  <PullDiffView
                    ownerType={ownerType}
                    ownerName={ownerName}
                    repoName={repoName}
                    detail={detail}
                    onChanged={setDetail}
                  />
                )}
                {tab === "checks" && (
                  <section aria-label="Checks">
                    <h3>Checks</h3>
                    <p className="pull-detail__check">test: {detail.check.status}</p>
                    {detail.check.setter && detail.check.setAt && (
                      <p className="pull-detail__check-meta">
                        Set by {detail.check.setter.username} on{" "}
                        {formatCheckTime(detail.check.setAt)}
                      </p>
                    )}
                    {isAdmin ? (
                      <div className="checks-form">
                        <label className="account-form__label" htmlFor="test-status">
                          test status
                        </label>
                        <select
                          id="test-status"
                          className="compare-form__select"
                          value={checkStatus}
                          onChange={(event) => {
                            setCheckStatus(event.target.value as CheckStatus);
                            setCheckError(null);
                          }}
                        >
                          <option value="pending">pending</option>
                          <option value="success">success</option>
                          <option value="failure">failure</option>
                        </select>
                        <button
                          type="button"
                          className="button button--primary"
                          disabled={savingCheck}
                          onClick={() => void saveCheck()}
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <p className="danger-zone__note">
                        Only repository Admins can update the check status.
                      </p>
                    )}
                    {checkError && (
                      <p role="alert" className="branch-selector__error">
                        {checkError}
                      </p>
                    )}
                  </section>
                )}
              </div>
              <aside className="pull-detail__sidebar" aria-label="Pull request sidebar">
                <ReviewersPicker
                  ownerType={ownerType}
                  ownerName={ownerName}
                  repoName={repoName}
                  detail={detail}
                  onChanged={setDetail}
                />
                <section className="pull-sidebar__section" aria-label="Review summary">
                  <h3>Review summary</h3>
                  {(detail.reviewSummary ?? []).length === 0 ? (
                    <p className="pull-sidebar__empty">No reviews submitted.</p>
                  ) : (
                    <ul className="pull-review-summary">
                      {detail.reviewSummary.map((review) => (
                        <li key={review.id} className="pull-review-summary__item">
                          <span className="pull-review-summary__author">
                            {review.author.username}
                          </span>
                          <span className={`pull-review-summary__status pull-review-summary__status--${review.decision}`}>
                            {reviewStatusText(review.decision)}
                          </span>
                          {review.explanation && (
                            <span className="pull-review-summary__explanation">
                              {review.explanation}
                            </span>
                          )}
                          <span className="pull-review-summary__time">
                            {formatCheckTime(review.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </aside>
            </div>
            {readyOpen && (
              <div
                className="change-visibility-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Ready for review"
              >
                <h2>Ready for review</h2>
                <p>Mark this pull request as ready for review? It will be opened for review.</p>
                <div className="sign-out-dialog__actions">
                  <button type="button" className="button" onClick={() => setReadyOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={markingReady}
                    onClick={() => void confirmReady()}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </AppHeader>
  );
}
