import { FormEvent, useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  addIssueComment,
  fetchIssueDetail,
  IssueActivity,
  IssueDetailData,
  setIssueState,
  toggleIssueReaction,
  updateIssueDescription,
  updateIssueTitle,
} from "../../lib/issue-api";
import { formatRelativeTime } from "../../lib/org-api";
import { repoOwnerBase, RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { RepoPageChrome } from "../repos/RepoPageChrome";
import { useRepoDetail } from "../repos/useRepoDetail";
import { IssueMetaPickers } from "./IssueMetaPickers";
import { ReactionChips, ReactionMenu } from "./ReactionMenu";

interface IssueDetailPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  number: number;
}

function activityText(activity: IssueActivity): string {
  switch (activity.type) {
    case "created":
      return "opened this issue";
    case "commented":
      return "commented";
    case "closed":
      return "Closed issue";
    case "reopened":
      return "reopened this issue";
    case "edited":
      return "edited this issue";
    case "assigned":
      return `assigned ${activity.assignee}`;
    case "unassigned":
      return `unassigned ${activity.assignee}`;
    case "labeled":
      return `added the ${activity.label} label`;
    case "unlabeled":
      return `removed the ${activity.label} label`;
    case "milestoned":
      return `added this issue to the ${activity.milestone} milestone`;
    case "demilestoned":
      return `removed this issue from the ${activity.milestone} milestone`;
    default:
      return activity.type;
  }
}

/**
 * The issue detail page (REQ-5-1-2): the top shows the issue number, a
 * heading whose accessible name is the complete title, and the visible
 * Open/Closed status; the main area shows the saved description, the
 * comments discussion, the comment editor, and the Activity timeline; the
 * right side shows Assignees, Labels, and Milestone in order. Write,
 * Maintain, and Admin users get “Edit issue title” / “Edit issue
 * description”; Triage, Maintain, and Admin users get the Assignees, Labels,
 * and Milestone pickers; everyone else only views.
 */
export function IssueDetailPage({ ownerType, ownerName, repoName, number }: IssueDetailPageProps) {
  const { status: sessionStatus } = useSession();
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName);
  const [data, setData] = useState<IssueDetailData | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "notfound">("loading");
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stateSaving, setStateSaving] = useState(false);
  const [editing, setEditing] = useState<null | "title" | "description">(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editErrors, setEditErrors] = useState<{ title?: string; description?: string }>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;

  useEffect(() => {
    if (detailStatus !== "ready") return;
    let cancelled = false;
    setLoadStatus("loading");
    fetchIssueDetail(ownerType, ownerName, repoName, number)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoadStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setLoadStatus("notfound");
        } else {
          setLoadStatus("ready");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detailStatus, ownerType, ownerName, repoName, number]);

  async function refreshDetail() {
    const result = await fetchIssueDetail(ownerType, ownerName, repoName, number);
    setData(result);
  }

  async function toggleReaction(targetType: "issue" | "comment", targetId: string, reaction: string) {
    setReactionError(null);
    const outcome = await toggleIssueReaction(ownerType, ownerName, repoName, number, {
      targetType,
      targetId,
      reaction,
    });
    if (!outcome.ok) {
      setReactionError(outcome.errors.target ?? outcome.errors.reaction ?? "Reaction could not be saved");
      return;
    }
    if (targetType === "issue") {
      setData((prev) =>
        prev ? { ...prev, issue: { ...prev.issue, reactions: outcome.reactions } } : prev,
      );
    } else {
      setData((prev) =>
        prev
          ? {
              ...prev,
              comments: prev.comments.map((comment) =>
                comment.id === targetId ? { ...comment, reactions: outcome.reactions } : comment,
              ),
            }
          : prev,
      );
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!commentBody.trim()) {
      setCommentError("Comment is required");
      return;
    }
    setSubmitting(true);
    setCommentError(null);
    const outcome = await addIssueComment(ownerType, ownerName, repoName, number, commentBody);
    setSubmitting(false);
    if (!outcome.ok) {
      setCommentError(outcome.errors.body ?? "Comment could not be saved");
      return;
    }
    setData((prev) =>
      prev
        ? {
            ...prev,
            issue: { ...prev.issue, commentsCount: prev.comments.length + 1 },
            comments: [...prev.comments, outcome.comment],
            activities: outcome.activity ? [...prev.activities, outcome.activity] : prev.activities,
          }
        : prev,
    );
    setCommentBody("");
  }

  async function changeIssueState(nextState: "open" | "closed") {
    if (stateSaving) return;
    setStateSaving(true);
    setMetaError(null);
    const outcome = await setIssueState(ownerType, ownerName, repoName, number, nextState);
    setStateSaving(false);
    if (!outcome.ok) {
      setMetaError("The change could not be saved");
      return;
    }
    await refreshDetail();
  }

  function startTitleEdit() {
    setEditing("title");
    setTitleDraft(data?.issue.title ?? "");
    setEditErrors({});
  }

  function startDescriptionEdit() {
    setEditing("description");
    setDescriptionDraft(data?.issue.description ?? "");
    setEditErrors({});
  }

  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    const errors: { title?: string } = {};
    if (!titleDraft.trim()) {
      errors.title = "Title is required";
    } else if (titleDraft.trim().length > 256) {
      errors.title = "Title must be at most 256 characters";
    }
    setEditErrors(errors);
    if (errors.title) return;
    setSavingEdit(true);
    const outcome = await updateIssueTitle(ownerType, ownerName, repoName, number, titleDraft);
    setSavingEdit(false);
    if (!outcome.ok) {
      setEditErrors({ title: outcome.errors.title ?? "Title could not be saved" });
      setTitleDraft(data?.issue.title ?? "");
      return;
    }
    setEditing(null);
    setEditErrors({});
    await refreshDetail();
  }

  async function saveDescription(event: FormEvent) {
    event.preventDefault();
    const errors: { description?: string } = {};
    if (descriptionDraft.length > 65536) {
      errors.description = "Description must be at most 65536 characters";
    }
    setEditErrors(errors);
    if (errors.description) return;
    setSavingEdit(true);
    const outcome = await updateIssueDescription(ownerType, ownerName, repoName, number, descriptionDraft);
    setSavingEdit(false);
    if (!outcome.ok) {
      setEditErrors({ description: outcome.errors.description ?? "Description could not be saved" });
      return;
    }
    setEditing(null);
    setEditErrors({});
    await refreshDetail();
  }

  if (detailStatus === "notfound") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
        <p>Repository not found.</p>
      </RepoPageChrome>
    );
  }
  if (detailStatus === "denied") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
        <p>Access denied</p>
      </RepoPageChrome>
    );
  }
  if (detailStatus !== "ready" || loadStatus !== "ready" || !data) {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
        {loadStatus === "notfound" ? <p>Issue not found.</p> : <p>Loading…</p>}
      </RepoPageChrome>
    );
  }

  const issue = data.issue;
  const role = repository?.currentRole ?? "";
  const canEdit =
    sessionStatus === "authenticated" && ["write", "maintain", "admin"].includes(role);
  const canManage =
    sessionStatus === "authenticated" && ["triage", "maintain", "admin"].includes(role);
  const canChangeState =
    sessionStatus === "authenticated" && ["triage", "maintain", "admin"].includes(role);
  const canReact = sessionStatus === "authenticated";

  return (
    <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
      <div className="issue-detail">
        <div className="issue-detail__header">
          {editing === "title" ? (
            <form className="issue-edit-form" aria-label="Edit issue title" onSubmit={(event) => void saveTitle(event)}>
              <div className="issue-edit-form__field">
                <label htmlFor="issue-title-edit">Issue title</label>
                <input
                  id="issue-title-edit"
                  type="text"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  aria-invalid={Boolean(editErrors.title)}
                  aria-describedby={editErrors.title ? "issue-title-edit-error" : undefined}
                />
                {editErrors.title && (
                  <p id="issue-title-edit-error" className="field-error" role="alert">
                    {editErrors.title}
                  </p>
                )}
              </div>
              <button type="submit" className="button" disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save issue title"}
              </button>
            </form>
          ) : (
            <>
              <h1 className="issue-detail__title">{issue.title}</h1>
              <div className="issue-detail__meta">
                <span className="issue-detail__number">#{issue.number}</span>
                <span className={`issue-detail__status issue-detail__status--${issue.state}`}>
                  {issue.state === "open" ? "Open" : "Closed"}
                </span>
                {canEdit && (
                  <button type="button" className="button button--small" onClick={startTitleEdit}>
                    Edit issue title
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="issue-detail__columns">
          <div className="issue-detail__main">
            <article className="issue-body">
              <header className="issue-body__header">
                <strong>{issue.author.username}</strong> opened this issue{" "}
                <time>{formatRelativeTime(issue.createdAt)}</time>
              </header>
              {editing === "description" ? (
                <form
                  className="issue-edit-form"
                  aria-label="Edit issue description"
                  onSubmit={(event) => void saveDescription(event)}
                >
                  <div className="issue-edit-form__field">
                    <label htmlFor="issue-description-edit">Issue description</label>
                    <textarea
                      id="issue-description-edit"
                      rows={6}
                      value={descriptionDraft}
                      onChange={(event) => setDescriptionDraft(event.target.value)}
                      aria-invalid={Boolean(editErrors.description)}
                      aria-describedby={editErrors.description ? "issue-description-edit-error" : undefined}
                    />
                    {editErrors.description && (
                      <p id="issue-description-edit-error" className="field-error" role="alert">
                        {editErrors.description}
                      </p>
                    )}
                  </div>
                  <button type="submit" className="button" disabled={savingEdit}>
                    {savingEdit ? "Saving…" : "Save issue description"}
                  </button>
                </form>
              ) : (
                <>
                  <p className="issue-body__text">{issue.description}</p>
                  {canEdit && (
                    <button type="button" className="button button--small" onClick={startDescriptionEdit}>
                      Edit issue description
                    </button>
                  )}
                </>
              )}
              <div className="issue-body__reactions">
                <ReactionChips reactions={issue.reactions} />
                {canReact && (
                  <ReactionMenu
                    reactions={issue.reactions}
                    onToggle={(reaction) => void toggleReaction("issue", issue.id, reaction)}
                  />
                )}
              </div>
            </article>

            <section className="issue-comments" aria-label="Comments">
              <h2>Comments {data.comments.length}</h2>
              {data.comments.map((comment) => (
                <article key={comment.id} className="issue-comment">
                  <header className="issue-comment__header">
                    <strong>{comment.author.username}</strong> commented{" "}
                    <time>{formatRelativeTime(comment.createdAt)}</time>
                  </header>
                  <p className="issue-comment__body">{comment.body}</p>
                  <div className="issue-comment__reactions">
                    <ReactionChips reactions={comment.reactions} />
                    {canReact && (
                      <ReactionMenu
                        reactions={comment.reactions}
                        onToggle={(reaction) => void toggleReaction("comment", comment.id, reaction)}
                      />
                    )}
                  </div>
                </article>
              ))}
            </section>

            {canEdit && (
              <form
                className="issue-comment-form"
                onSubmit={(event) => void submitComment(event)}
              >
                <div className="issue-comment-form__field">
                  <label htmlFor="issue-comment-input">Comment</label>
                  <textarea
                    id="issue-comment-input"
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    rows={4}
                  />
                </div>
                {commentError && (
                  <p className="field-error" role="alert">
                    {commentError}
                  </p>
                )}
                <button type="submit" className="button" disabled={submitting}>
                  {submitting ? "Commenting…" : "Comment"}
                </button>
              </form>
            )}

            {reactionError && (
              <p className="field-error" role="alert">
                {reactionError}
              </p>
            )}

            {metaError && (
              <p className="field-error" role="alert">
                {metaError}
              </p>
            )}

            <section className="issue-activity" aria-label="Activity">
              <h2>Activity</h2>
              <ol className="issue-activity__timeline">
                {data.activities.map((activity: IssueActivity) => (
                  <li key={activity.id}>
                    <article className="issue-activity__entry">
                      <p className="issue-activity__line">
                        <strong>{activity.actor.username}</strong> {activityText(activity)}{" "}
                        <time>{formatRelativeTime(activity.createdAt)}</time>
                      </p>
                      {activity.type === "edited" && activity.value !== undefined && (
                        <p className="issue-activity__body">
                          {activity.field === "title"
                            ? `Title: ${activity.value}`
                            : `Description: ${activity.value}`}
                        </p>
                      )}
                      {activity.body && <p className="issue-activity__body">{activity.body}</p>}
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          </div>
          <IssueMetaPickers
            ownerType={ownerType}
            ownerName={ownerName}
            repoName={repoName}
            number={number}
            data={data}
            canManage={canManage}
            canChangeState={canChangeState}
            stateSaving={stateSaving}
            onChangeState={changeIssueState}
            onChanged={refreshDetail}
            onError={setMetaError}
          />
        </div>
      </div>
    </RepoPageChrome>
  );
}
