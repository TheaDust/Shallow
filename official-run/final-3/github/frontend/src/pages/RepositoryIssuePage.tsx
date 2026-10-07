import { useState, type FormEvent } from "react";

import { AppHeader } from "../components/AppHeader";
import { IssueMetadataSelect, type IssueMetadataOption } from "../components/IssueMetadataSelect";
import { IssueReactions } from "../components/IssueReactions";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import {
  commentOnRepositoryIssue,
  fetchRepositoryIssue,
  setRepositoryIssueAssignee,
  setRepositoryIssueLabel,
  setRepositoryIssueMilestone,
  setRepositoryIssueStatus,
  updateRepositoryIssueDescription,
  updateRepositoryIssueTitle,
  type IssueEvent,
  type IssueViewPayload,
} from "../lib/org-api";
import { formatRelativeTime } from "../lib/format";
import { repositoryIssuesHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

const STATUS_LABEL = { open: "Open", closed: "Closed" } as const;

/**
 * One readable sentence per timeline entry; the timeline itself is append-only.
 * The summaries name the kind of change without repeating the metadata value,
 * so the assigned username, label or milestone appears exactly once on the page
 * (in the metadata it belongs to).
 */
function eventSummary(event: IssueEvent): string {
  switch (event.type) {
    case "created":
      return "created this issue";
    case "commented":
      return "commented on this issue";
    case "renamed":
      return "renamed this issue";
    case "description-edited":
      return "edited the description";
    case "assigned":
      return "assigned a participant";
    case "unassigned":
      return "unassigned a participant";
    case "labeled":
      return "added a label";
    case "unlabeled":
      return "removed a label";
    case "milestone-set":
      return "set a milestone";
    case "milestone-cleared":
      return "cleared the milestone";
    case "closed":
      return "closed this issue";
    case "reopened":
      return "reopened this issue";
    default:
      return event.type.replace(/-/g, " ");
  }
}

/**
 * Issue detail (REQ-5-1-2, REQ-5-2, REQ-5-3). The heading is the exact stored
 * title without the issue number; the saved description, the discussion
 * articles and the activity timeline all read the same persisted record as the
 * list.
 *
 * The controls mirror the operation-specific server rules: the `Comment`
 * editor, `Edit issue title` and `Edit issue description` appear for a writer,
 * while the `Assignees`, `Labels` and `Milestone` selectors appear for a
 * metadata editor. Each save writes its own operation and reloads the same
 * stored issue, so the view never shows state the server did not confirm.
 */
export function RepositoryIssuePage({
  owner,
  name,
  number,
}: {
  owner: string;
  name: string;
  number: string;
}) {
  const { status, data, error, reload } = useAsyncData(
    () => fetchRepositoryIssue(owner, name, number),
    [owner, name, number],
  );
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleOpen, setTitleOpen] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const view: IssueViewPayload | null = data;

  // Close or reopen the issue in place (REQ-5-4). The transition saves
  // immediately and reloads the same stored record, so the status line, the
  // activity timeline and the offered control all read the confirmed state.
  const changeStatus = async (next: "open" | "closed") => {
    if (statusBusy) return;
    setStatusBusy(true);
    setStatusError(null);
    const result = await setRepositoryIssueStatus(owner, name, number, next);
    setStatusBusy(false);
    if (!result.ok) {
      setStatusError(result.fieldErrors.status ?? result.message);
      return;
    }
    reload();
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (comment.trim().length === 0) {
      setCommentError("Comment is required");
      return;
    }
    setBusy(true);
    setCommentError(null);
    const result = await commentOnRepositoryIssue(owner, name, number, comment);
    setBusy(false);
    if (!result.ok) {
      setCommentError(result.fieldErrors.body ?? result.message);
      return;
    }
    setComment("");
    reload();
  };

  const submitTitle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setTitleError(null);
    const result = await updateRepositoryIssueTitle(owner, name, number, titleDraft);
    setBusy(false);
    if (!result.ok) {
      // A rejected title leaves the stored issue untouched, so the heading
      // still shows the original value.
      setTitleError(result.fieldErrors.title ?? result.message);
      return;
    }
    setTitleOpen(false);
    reload();
  };

  const submitDescription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setDescriptionError(null);
    const result = await updateRepositoryIssueDescription(owner, name, number, descriptionDraft);
    setBusy(false);
    if (!result.ok) {
      setDescriptionError(result.fieldErrors.description ?? result.message);
      return;
    }
    setDescriptionOpen(false);
    reload();
  };

  const assigneeOptions: IssueMetadataOption[] = view
    ? view.availableAssignees.map((username) => ({
        value: username,
        name: username,
        selected: view.issue.assignees.includes(username),
      }))
    : [];
  const labelOptions: IssueMetadataOption[] = view
    ? view.availableLabels.map((label) => ({
        value: label.name,
        name: label.name,
        selected: view.issue.labels.some((entry) => entry.name === label.name),
      }))
    : [];
  const milestoneOptions: IssueMetadataOption[] = view
    ? view.availableMilestones.map((milestone) => ({
        value: milestone.name,
        name: milestone.name,
        selected: view.issue.milestone?.name === milestone.name,
      }))
    : [];

  const selectAssignee = async (username: string, selected: boolean) => {
    setMetadataError(null);
    const result = await setRepositoryIssueAssignee(owner, name, number, username, !selected);
    if (!result.ok) {
      const message = result.fieldErrors.assignee ?? result.message;
      setMetadataError(message);
      return message;
    }
    reload();
    return null;
  };

  const selectLabel = async (label: string, selected: boolean) => {
    setMetadataError(null);
    const result = await setRepositoryIssueLabel(owner, name, number, label, !selected);
    if (!result.ok) {
      const message = result.fieldErrors.label ?? result.message;
      setMetadataError(message);
      return message;
    }
    reload();
    return null;
  };

  const selectMilestone = async (milestone: string) => {
    setMetadataError(null);
    const result = await setRepositoryIssueMilestone(owner, name, number, milestone);
    if (!result.ok) {
      const message = result.fieldErrors.milestone ?? result.message;
      setMetadataError(message);
      return message;
    }
    reload();
    return null;
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body issue-detail">
        {view ? <RepositoryBreadcrumb repository={view.repository} /> : null}
        {status === "loading" && !view ? <LoadingNote label="Loading issue…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {view ? (
          <>
            <p className="issue-detail__breadcrumb">
              <a href={repositoryIssuesHash(owner, name)}>Issues</a>
              <span className="issue-detail__number"> #{view.issue.number}</span>
            </p>
            <h1 className="issue-detail__title">{view.issue.title}</h1>
            <p className="issue-detail__status" data-status={view.issue.status}>
              {STATUS_LABEL[view.issue.status]}
            </p>
            {view.canTriage ? (
              <div className="issue-detail__transitions">
                {view.issue.status === "open" ? (
                  <Button
                    variant="secondary"
                    disabled={statusBusy}
                    onClick={() => void changeStatus("closed")}
                  >
                    Close issue
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={statusBusy}
                    onClick={() => void changeStatus("open")}
                  >
                    Reopen issue
                  </Button>
                )}
                {statusError ? (
                  <p className="issue-detail__status-error" role="alert">
                    {statusError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {view.canWrite ? (
              <div className="issue-detail__edits">
                <Button
                  variant="secondary"
                  aria-expanded={titleOpen}
                  onClick={() => {
                    // Opening is idempotent so a repeated activation still edits.
                    setTitleDraft(view.issue.title);
                    setTitleError(null);
                    setTitleOpen(true);
                  }}
                >
                  Edit issue title
                </Button>
                <Button
                  variant="secondary"
                  aria-expanded={descriptionOpen}
                  onClick={() => {
                    setDescriptionDraft(view.issue.description);
                    setDescriptionError(null);
                    setDescriptionOpen(true);
                  }}
                >
                  Edit issue description
                </Button>
              </div>
            ) : null}
            {view.canWrite && titleOpen ? (
              <form className="issue-detail__edit-form" onSubmit={submitTitle}>
                <FormField id="issue-title" label="Issue title" error={titleError ?? undefined}>
                  <input
                    id="issue-title"
                    name="title"
                    type="text"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                  />
                </FormField>
                <Button type="submit" variant="primary" disabled={busy}>
                  Save issue title
                </Button>
              </form>
            ) : null}
            {view.canWrite && descriptionOpen ? (
              <form className="issue-detail__edit-form" onSubmit={submitDescription}>
                <FormField
                  id="issue-description"
                  label="Issue description"
                  error={descriptionError ?? undefined}
                >
                  <textarea
                    id="issue-description"
                    name="description"
                    rows={6}
                    value={descriptionDraft}
                    onChange={(event) => setDescriptionDraft(event.target.value)}
                  />
                </FormField>
                <Button type="submit" variant="primary" disabled={busy}>
                  Save issue description
                </Button>
              </form>
            ) : null}
            <div className="issue-detail__grid">
              <div className="issue-detail__main">
                <section className="issue-detail__description" aria-label="Description">
                  <h2 className="issue-detail__section-title">Description</h2>
                  <p className="issue-detail__description-body">
                    {view.issue.description || "No description provided."}
                  </p>
                </section>
                {/* REQ-5-5: the reaction bar reads the same stored record as the
                    rest of the detail view; the visitor only ever sees counts. */}
                <IssueReactions
                  owner={owner}
                  name={name}
                  number={number}
                  reactions={view.reactions}
                  canReact={view.canReact}
                  onChanged={reload}
                />
                <section className="issue-discussion" aria-label="Discussion">
                  <h2 className="issue-detail__section-title">Discussion</h2>
                  {view.comments.length === 0 ? (
                    <p className="issue-discussion__empty">No comments yet.</p>
                  ) : (
                    <ul className="issue-discussion__list">
                      {view.comments.map((entry) => (
                        <li key={entry.id}>
                          <article className="issue-comment">
                            <p className="issue-comment__meta">
                              <span className="issue-comment__author">{entry.author}</span> commented
                            </p>
                            <p className="issue-comment__body">{entry.body}</p>
                          </article>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="issue-activity" aria-label="Activity">
                  <h2 className="issue-detail__section-title">Activity</h2>
                  <ol className="issue-activity__list">
                    {view.events.map((event) => (
                      <li key={event.id} className="issue-activity__item" data-event={event.type}>
                        {eventSummary(event)}
                        <span className="issue-activity__time"> · {formatRelativeTime(event.createdAt)}</span>
                      </li>
                    ))}
                  </ol>
                </section>
                {view.canWrite ? (
                  <form className="issue-comment-form" onSubmit={submitComment}>
                    <FormField id="issue-comment" label="Comment" error={commentError ?? undefined}>
                      <textarea
                        id="issue-comment"
                        name="comment"
                        rows={4}
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                      />
                    </FormField>
                    <Button type="submit" variant="primary" disabled={busy}>
                      Comment
                    </Button>
                  </form>
                ) : null}
              </div>
              <aside className="issue-detail__sidebar">
                <section className="issue-meta">
                  <h2 className="issue-meta__title">Assignees</h2>
                  {view.issue.assignees.length === 0 ? (
                    <p className="issue-meta__empty">No one assigned</p>
                  ) : (
                    <ul className="issue-meta__list">
                      {view.issue.assignees.map((username) => (
                        <li key={username}>{username}</li>
                      ))}
                    </ul>
                  )}
                  {view.canTriage ? (
                    <IssueMetadataSelect
                      label="Assignees"
                      searchLabel="Search assignees"
                      options={assigneeOptions}
                      onSelect={selectAssignee}
                    />
                  ) : null}
                </section>
                <section className="issue-meta">
                  <h2 className="issue-meta__title">Labels</h2>
                  {view.issue.labels.length === 0 ? (
                    <p className="issue-meta__empty">None yet</p>
                  ) : (
                    <ul className="issue-meta__list">
                      {view.issue.labels.map((label) => (
                        <li key={label.name}>
                          <span className="issue-label" style={{ borderColor: label.color }}>
                            {label.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {view.canTriage ? (
                    <IssueMetadataSelect
                      label="Labels"
                      options={labelOptions}
                      onSelect={selectLabel}
                    />
                  ) : null}
                </section>
                <section className="issue-meta">
                  <h2 className="issue-meta__title">Milestone</h2>
                  {view.issue.milestone ? (
                    <p className="issue-meta__value">{view.issue.milestone.name}</p>
                  ) : (
                    <p className="issue-meta__empty">No milestone</p>
                  )}
                  {view.canTriage ? (
                    <IssueMetadataSelect
                      label="Milestone"
                      options={milestoneOptions}
                      onSelect={(value) => selectMilestone(value)}
                    />
                  ) : null}
                </section>
                {metadataError ? (
                  <p className="issue-meta__error" role="alert">
                    {metadataError}
                  </p>
                ) : null}
              </aside>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
