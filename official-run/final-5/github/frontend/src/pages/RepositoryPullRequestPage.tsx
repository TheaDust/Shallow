import { Fragment, useState } from "react";

import { PullRequestMerge } from "../components/PullRequestMerge";
import { PullRequestReviewers } from "../components/PullRequestReviewers";
import { ReviewChanges, ReviewsList } from "../components/PullRequestReview";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { navigate } from "../lib/hash-route";
import { formatRelativeTime } from "../lib/format";
import {
  addRepositoryPullRequestComment,
  setRepositoryPullRequestCheck,
  setRepositoryPullRequestStatus,
  fetchRepositoryPullRequest,
  type IssueEvent,
  type PullRequestCheck,
  type PullRequestStatus,
  type PullRequestViewPayload,
  type ReviewComment,
} from "../lib/org-api";
import {
  repositoryPullChecksHash,
  repositoryPullCommitsHash,
  repositoryPullFilesHash,
  repositoryPullHash,
  repositoryPullsHash,
} from "../lib/routes";
import { useSession } from "../lib/session";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { FormField } from "../ui/FormField";

export type PullRequestTab = "conversation" | "commits" | "files" | "checks";

const STATUS_LABEL: Record<PullRequestStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  merged: "Merged",
};

const CHECK_STATUSES: PullRequestCheck["status"][] = ["pending", "success", "failure"];

/** One readable sentence per activity entry; the timeline stays append-only. */
function eventSummary(event: IssueEvent): string {
  switch (event.type) {
    case "created":
      return "opened this pull request";
    case "commented":
      return "commented on this pull request";
    case "ready-for-review":
      return "marked this pull request as ready for review";
    case "closed":
      return "closed this pull request";
    case "reopened":
      return "reopened this pull request";
    case "reviewed":
      return "reviewed this pull request";
    case "merged":
      return "merged this pull request";
    default:
      return event.type.replace(/-/g, " ");
  }
}

/**
 * Pull request detail (REQ-6, REQ-6-1). `Conversation`, `Commits`,
 * `Files changed` and `Checks` are navigation links whose target travels in the
 * address, so every view of the same proposal can be opened and reloaded
 * directly. The heading is the exact persisted title and the current status is
 * visible text.
 *
 * The Checks view reads the status check of the revision the comparison
 * currently reads: an administrator selects a new status and saves it, and the
 * saved status together with the account that set it is what every later read
 * returns.
 */
export function RepositoryPullRequestPage({
  owner,
  name,
  number,
  tab,
}: {
  owner: string;
  name: string;
  number: string;
  tab: PullRequestTab;
}) {
  const { status, data, error, reload } = useAsyncData(
    () => fetchRepositoryPullRequest(owner, name, number),
    [owner, name, number],
  );
  const { user } = useSession();
  const [checkDraft, setCheckDraft] = useState<Record<string, PullRequestCheck["status"]>>({});
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [commentTarget, setCommentTarget] = useState<{ path: string; index: number } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const view: PullRequestViewPayload | null = data;

  const saveCheck = async (check: PullRequestCheck) => {
    if (checkBusy) return;
    setCheckBusy(true);
    setCheckError(null);
    const result = await setRepositoryPullRequestCheck(
      owner,
      name,
      number,
      check.name,
      checkDraft[check.name] ?? check.status,
    );
    setCheckBusy(false);
    if (!result.ok) {
      setCheckError(result.fieldErrors.status ?? result.message);
      return;
    }
    reload();
  };

  const transition = async (next: "open" | "closed") => {
    if (transitionBusy) return;
    setTransitionBusy(true);
    setTransitionError(null);
    const result = await setRepositoryPullRequestStatus(owner, name, number, next);
    setTransitionBusy(false);
    if (!result.ok) {
      setTransitionError(result.fieldErrors.status ?? result.message);
      return;
    }
    reload();
  };

  /** Publishes (`Add single comment`) or stores (`Start a review`) a line comment. */
  const submitComment = async (state: "published" | "pending") => {
    if (!commentTarget || commentBusy) return;
    if (commentBody.trim().length === 0) {
      setCommentError("Comment is required");
      return;
    }
    setCommentBusy(true);
    setCommentError(null);
    const result = await addRepositoryPullRequestComment(owner, name, number, {
      body: commentBody,
      filePath: commentTarget.path,
      lineIndex: commentTarget.index,
      state,
    });
    setCommentBusy(false);
    if (!result.ok) {
      setCommentError(result.fieldErrors.comment ?? result.message);
      return;
    }
    setCommentTarget(null);
    setCommentBody("");
    reload();
  };

  const tabHref = (target: PullRequestTab) => {
    if (target === "commits") return repositoryPullCommitsHash(owner, name, number);
    if (target === "files") return repositoryPullFilesHash(owner, name, number);
    if (target === "checks") return repositoryPullChecksHash(owner, name, number);
    return repositoryPullHash(owner, name, number);
  };

  // The author or a Maintain/Admin moves a draft to review, closes an unmerged
  // proposal or reopens a closed one; Merged stays terminal. Only Maintain,
  // Admin or the organization Owner may merge an Open proposal, so the merge
  // control stays disabled for every other state and role.
  const isAuthor = view !== null && user?.username === view.pullRequest.author;
  const mayTransition =
    view !== null && view.pullRequest.status !== "merged" && (view.canMaintain || isAuthor);

  return (
    <main className="page">
      <section className="page__body pull-detail">
        {view ? <RepositoryBreadcrumb repository={view.repository} /> : null}
        {status === "loading" && !view ? <LoadingNote label="Loading pull request…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {view ? (
          <>
            <p className="pull-detail__breadcrumb">
              <a href={repositoryPullsHash(owner, name)}>Pull requests</a>
              <span className="pull-detail__number"> #{view.pullRequest.number}</span>
            </p>
            <h1 className="pull-detail__title">{view.pullRequest.title}</h1>
            <p className="pull-detail__status" data-status={view.pullRequest.status}>
              {STATUS_LABEL[view.pullRequest.status]}
            </p>
            <p className="pull-detail__branches">
              {view.pullRequest.sourceBranch} &rarr; {view.pullRequest.targetBranch}
            </p>
            {mayTransition ? (
              <div className="pull-detail__actions">
                {view.pullRequest.status === "draft" ? (
                  <Button
                    variant="secondary"
                    disabled={transitionBusy}
                    onClick={() => void transition("open")}
                  >
                    Ready for review
                  </Button>
                ) : view.pullRequest.status === "open" ? (
                  <Button
                    variant="secondary"
                    disabled={transitionBusy}
                    onClick={() => void transition("closed")}
                  >
                    Close pull request
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={transitionBusy}
                    onClick={() => void transition("open")}
                  >
                    Reopen pull request
                  </Button>
                )}
              </div>
            ) : null}
            {transitionError ? (
              <p className="pull-detail__error" role="alert">
                {transitionError}
              </p>
            ) : null}
            {user ? (
              <PullRequestMerge
                owner={owner}
                name={name}
                number={number}
                pullRequest={view.pullRequest}
                merge={view.merge}
                canMaintain={view.canMaintain}
                signedIn={Boolean(user)}
                onChanged={reload}
              />
            ) : null}
            <nav className="page-tabs" aria-label="Pull request">
              {(
                [
                  ["conversation", "Conversation"],
                  ["commits", "Commits"],
                  ["files", "Files changed"],
                  ["checks", "Checks"],
                ] as Array<[PullRequestTab, string]>
              ).map(([target, label]) => (
                <a
                  key={target}
                  className="page-tabs__link"
                  href={tabHref(target)}
                  aria-current={tab === target ? "page" : undefined}
                >
                  {label}
                </a>
              ))}
            </nav>

            {tab === "conversation" ? (
              <div className="pull-detail__grid">
                <div className="pull-detail__main">
                  <section className="pull-detail__description" aria-label="Description">
                    <h2 className="pull-detail__section-title">Description</h2>
                    <p className="pull-detail__description-body">
                      {view.pullRequest.description || "No description provided."}
                    </p>
                  </section>
                  <section className="pull-discussion" aria-label="Discussion">
                    <h2 className="pull-detail__section-title">Discussion</h2>
                    {view.comments.length === 0 ? (
                      <p className="pull-discussion__empty">No comments yet.</p>
                    ) : (
                      <ul className="pull-discussion__list">
                        {view.comments.map((comment) => (
                          <li key={comment.id}>
                            <article className="pull-comment">
                              <p className="pull-comment__meta">
                                <span className="pull-comment__author">{comment.author}</span> commented
                              </p>
                              <p className="pull-comment__body">{comment.body}</p>
                            </article>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section className="pull-activity" aria-label="Activity">
                    <h2 className="pull-detail__section-title">Activity</h2>
                    <ol className="pull-activity__list">
                      {view.events.map((event) => (
                        <li key={event.id} className="pull-activity__item" data-event={event.type}>
                          {eventSummary(event)}
                          <span className="pull-activity__time">
                            {" "}
                            · {formatRelativeTime(event.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
                <aside className="pull-detail__sidebar">
                  <PullRequestReviewers
                    owner={owner}
                    name={name}
                    number={number}
                    requested={view.requestedReviewers}
                    available={view.availableReviewers}
                    canManage={view.canManageReviewers}
                    onChanged={reload}
                  />
                  <section className="pull-reviews" aria-label="Reviews">
                    <h2 className="pull-detail__section-title">Reviews</h2>
                    <ReviewsList reviews={view.reviews} />
                  </section>
                </aside>
              </div>
            ) : null}

            {tab === "commits" ? (
              <section className="pull-commits" aria-label="Commits">
                {view.commits.length === 0 ? (
                  <p className="pull-commits__empty">No commits on the compare branch.</p>
                ) : (
                  <ul className="pull-commits__list">
                    {view.commits.map((commit) => (
                      <li key={commit.id} className="pull-commit">
                        <span className="pull-commit__message">{commit.message}</span>
                        <span className="pull-commit__author">{commit.authorName}</span>
                        <span className="pull-commit__time">
                          {formatRelativeTime(commit.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {tab === "files" ? (
              <section className="pull-files" aria-label="Files changed">
                <div className="pull-files__review">
                  {view.canReview ? (
                    <ReviewChanges owner={owner} name={name} number={number} onChanged={reload} />
                  ) : null}
                  <section className="pull-reviews" aria-label="Reviews">
                    <h2 className="pull-detail__section-title">Reviews</h2>
                    <ReviewsList reviews={view.reviews} />
                  </section>
                </div>
                {view.changes.length === 0 ? (
                  <p className="pull-files__empty">No file differences.</p>
                ) : (
                  <>
                    <p className="pull-files__totals">
                      {view.totals.files} {view.totals.files === 1 ? "file" : "files"} changed with{" "}
                      {view.totals.additions} additions and {view.totals.deletions} deletions
                    </p>
                    {view.changes.map((change) => (
                      <article key={change.path} className="pull-file">
                        <h2 className="pull-file__path">{change.path}</h2>
                        <p className="pull-file__stat">
                          +{change.additions} −{change.deletions}
                        </p>
                        <table className="diff-table">
                          <tbody>
                            {change.lines.map((line, index) => {
                              const changed = line.type === "added" || line.type === "removed";
                              const editorOpen =
                                commentTarget?.path === change.path && commentTarget?.index === index;
                              const lineComments: ReviewComment[] = view.reviewComments.filter(
                                (comment) =>
                                  comment.filePath === change.path && comment.lineIndex === index,
                              );
                              return (
                                <Fragment key={`${change.path}-${index}`}>
                                  <tr className="diff-table__row" data-line={line.type}>
                                    <td className="diff-table__cell">{line.text}</td>
                                    <td className="diff-table__actions">
                                      {view.canReview && changed ? (
                                        <Button
                                          variant="secondary"
                                          onClick={() => {
                                            setCommentTarget({ path: change.path, index });
                                            setCommentBody("");
                                            setCommentError(null);
                                          }}
                                        >
                                          Add comment
                                        </Button>
                                      ) : null}
                                    </td>
                                  </tr>
                                  {editorOpen ? (
                                    <tr className="diff-table__editor">
                                      <td className="diff-table__cell" colSpan={2}>
                                        <FormField
                                          id={`review-comment-${change.path}-${index}`}
                                          label="Comment"
                                          error={commentError ?? undefined}
                                        >
                                          <textarea
                                            id={`review-comment-${change.path}-${index}`}
                                            rows={3}
                                            value={commentBody}
                                            onChange={(event) => setCommentBody(event.target.value)}
                                          />
                                        </FormField>
                                        <div className="pull-files__comment-actions">
                                          <Button
                                            variant="primary"
                                            disabled={commentBusy}
                                            onClick={() => void submitComment("published")}
                                          >
                                            Add single comment
                                          </Button>
                                          <Button
                                            variant="secondary"
                                            disabled={commentBusy}
                                            onClick={() => void submitComment("pending")}
                                          >
                                            Start a review
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                  ) : null}
                                  {lineComments.map((comment) => (
                                    <tr key={comment.id} className="diff-table__comment">
                                      <td className="diff-table__cell" colSpan={2}>
                                        <article className="review-comment" data-state={comment.state}>
                                          <p className="review-comment__meta">
                                            <span className="review-comment__author">
                                              {comment.author}
                                            </span>{" "}
                                            {comment.state === "pending"
                                              ? "started a review"
                                              : "commented"}
                                            {comment.outdated ? " · Outdated" : ""}
                                          </p>
                                          <p className="review-comment__body">{comment.body}</p>
                                          {comment.state === "pending" ? (
                                            <p className="review-comment__pending">Pending review</p>
                                          ) : null}
                                        </article>
                                      </td>
                                    </tr>
                                  ))}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </article>
                    ))}
                  </>
                )}
              </section>
            ) : null}

            {tab === "checks" ? (
              <section className="pull-checks" aria-label="Checks">
                {view.checks.length === 0 ? (
                  <p className="pull-checks__empty">No checks for this commit.</p>
                ) : (
                  <ul className="pull-checks__list">
                    {view.checks.map((check) => (
                      <li key={check.name} className="pull-check">
                        <h2 className="pull-check__name">{check.name}</h2>
                        <p className="pull-check__status">{check.status}</p>
                        {check.setter ? (
                          <p className="pull-check__setter">{check.setter}</p>
                        ) : null}
                        {view.canManage ? (
                          <div className="pull-check__editor">
                            <Combobox
                              id={`pull-check-${check.name}`}
                              label={check.name}
                              labelHidden
                              aria-label={check.name}
                              options={CHECK_STATUSES.map((value) => ({ value, label: value }))}
                              value={checkDraft[check.name] ?? check.status}
                              onChange={(event) =>
                                setCheckDraft((current) => ({
                                  ...current,
                                  [check.name]: event.currentTarget.value as PullRequestCheck["status"],
                                }))
                              }
                            />
                            <Button
                              variant="primary"
                              disabled={checkBusy}
                              onClick={() => void saveCheck(check)}
                            >
                              Save
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {checkError ? (
                  <p className="pull-checks__error" role="alert">
                    {checkError}
                  </p>
                ) : null}
              </section>
            ) : null}

            <p className="pull-detail__back">
              <Button variant="secondary" onClick={() => navigate(repositoryPullsHash(owner, name))}>
                Back to pull requests
              </Button>
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
