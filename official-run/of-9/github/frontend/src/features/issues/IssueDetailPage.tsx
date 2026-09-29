import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";

import { ApiError } from "../../lib/api";
import { formatUpdatedTime } from "../../lib/format";
import { useSession } from "../auth/session";
import { AccessDenied } from "../organizations/AccessDenied";
import type { RepoRole } from "../organizations/api";
import { Button } from "../../ui";
import {
  addIssueComment,
  getIssue,
  setIssueMilestone,
  setIssueStatus,
  toggleIssueAssignee,
  toggleIssueLabel,
  toggleIssueReaction,
  updateIssueDescription,
  updateIssueTitle,
  type IssueComment,
  type IssueDetail,
  type IssueDetailData,
  type IssueLabel,
  type IssueStatus,
  type TimelineEntry,
} from "./api";
import { MetadataPicker } from "./MetadataPicker";
import { Reactions } from "./ReactionMenu";
import { RepoNav } from "./RepoNav";

const WRITABLE_ROLES: RepoRole[] = ["write", "maintain", "admin"];
const MANAGE_ROLES: RepoRole[] = ["triage", "maintain", "admin"];

function timelineText(entry: TimelineEntry): string {
  switch (entry.type) {
    case "created":
      return `${entry.author} created this issue`;
    case "comment":
      return `${entry.author} commented`;
    case "title-edited":
      return `${entry.author} changed the title from “${entry.oldTitle}” to “${entry.newTitle}”`;
    case "description-edited":
      return `${entry.author} edited the description`;
    case "assigned":
      return `${entry.author} assigned ${entry.targetUsername}`;
    case "unassigned":
      return `${entry.author} unassigned ${entry.targetUsername}`;
    case "labeled":
      return `${entry.author} added label ${entry.labelName}`;
    case "unlabeled":
      return `${entry.author} removed label ${entry.labelName}`;
    case "milestone-changed":
      return entry.newMilestone
        ? `${entry.author} changed milestone to ${entry.newMilestone}`
        : `${entry.author} removed milestone`;
    case "closed":
      return "Closed issue";
    case "reopened":
      return "Reopened issue";
    case "reaction":
      return `${entry.author} ${entry.added ? "reacted" : "removed their reaction"} with ${entry.reaction} on ${
        entry.targetType === "issue" ? "this issue" : "a comment"
      }`;
    default:
      return `${entry.author} updated this issue`;
  }
}

function TimelineActivity({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ul className="issue-timeline">
      {entries.map((entry) => (
        <li key={entry.id}>
          <article className="issue-timeline__entry">
            <span>{timelineText(entry)}</span>
            {entry.type === "closed" || entry.type === "reopened" ? (
              <span className="issue-timeline__actor"> by {entry.author}</span>
            ) : null}{" "}
            <time dateTime={entry.createdAt}>{formatUpdatedTime(entry.createdAt)}</time>
          </article>
        </li>
      ))}
    </ul>
  );
}

export function IssueDetailPage({
  owner,
  name,
  number,
}: {
  owner: string;
  name: string;
  number: string;
}) {
  const issueNumber = Number(number);
  const { session } = useSession();
  const [data, setData] = useState<IssueDetailData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "missing">("loading");

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState("");
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [commentValue, setCommentValue] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await getIssue(owner, name, issueNumber);
    setData(result);
    setStatus("ok");
  }, [owner, name, issueNumber]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getIssue(owner, name, issueNumber)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus("ok");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setStatus("denied");
        else setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, issueNumber]);

  if (status === "denied") return <AccessDenied />;
  if (status === "missing") {
    return (
      <section className="issue-detail">
        <RepoNav owner={owner} name={name} active="issues" />
        <h1>Issue not found</h1>
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

  const { issue, myRole, labels, milestones, assignableMembers } = data;
  const authenticated = session.status === "authenticated";
  const canEdit = authenticated && myRole !== null && WRITABLE_ROLES.includes(myRole);
  const canManage = authenticated && myRole !== null && MANAGE_ROLES.includes(myRole);

  const saveTitle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await updateIssueTitle(owner, name, issueNumber, titleValue);
    if (result.ok) {
      setData((prev) => (prev ? { ...prev, issue: result.issue } : prev));
      setTitleEditing(false);
      setTitleError(null);
    } else {
      setTitleError(result.errors.title ?? "Unable to save title");
    }
  };

  const saveDescription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await updateIssueDescription(owner, name, issueNumber, descriptionValue);
    if (result.ok) {
      setData((prev) => (prev ? { ...prev, issue: result.issue } : prev));
      setDescriptionEditing(false);
      setDescriptionError(null);
    } else {
      setDescriptionError(result.errors.description ?? "Unable to save description");
    }
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = commentValue.trim();
    if (!body) {
      setCommentError("Comment is required");
      return;
    }
    setCommentError(null);
    const result = await addIssueComment(owner, name, issueNumber, body);
    if (result.ok) {
      setCommentValue("");
      await reload();
    } else {
      setCommentError(result.errors.comment ?? "Unable to post comment");
    }
  };

  const toggleReaction = async (targetType: "issue" | "comment", targetId: string, reaction: string) => {
    const result = await toggleIssueReaction(owner, name, issueNumber, {
      targetType,
      targetId,
      reaction,
    });
    if (result.ok) {
      await reload();
    }
  };

  const updateAssignee = async (username: string) => {
    const result = await toggleIssueAssignee(owner, name, issueNumber, username);
    if (result.ok) {
      setData((prev) => (prev ? { ...prev, issue: result.issue } : prev));
    }
  };

  const updateLabel = async (labelName: string) => {
    const result = await toggleIssueLabel(owner, name, issueNumber, labelName);
    if (result.ok) {
      setData((prev) => (prev ? { ...prev, issue: result.issue } : prev));
    }
  };

  const updateMilestone = async (milestoneId: string) => {
    const result = await setIssueMilestone(
      owner,
      name,
      issueNumber,
      milestoneId === "" ? null : milestoneId,
    );
    if (result.ok) {
      setData((prev) => (prev ? { ...prev, issue: result.issue } : prev));
    }
  };

  const updateStatus = async (status: IssueStatus) => {
    const result = await setIssueStatus(owner, name, issueNumber, status);
    if (result.ok) {
      setData((prev) => (prev ? { ...prev, issue: result.issue } : prev));
    }
  };

  return (
    <section className="issue-detail">
      <RepoNav owner={owner} name={name} active="issues" />
      <header className="issue-detail__header">
        <h1>{issue.title}</h1>
        <p className="issue-detail__meta">
          <span className="issue-detail__number">#{issue.number}</span>
          <span className="issue-status">{issue.status === "open" ? "Open" : "Closed"}</span>
          <span aria-hidden="true"> · </span>
          <span>opened by {issue.author}</span>
          {canManage ? (
            issue.status === "open" ? (
              <Button
                variant="secondary"
                className="issue-detail__status-action"
                onClick={() => void updateStatus("closed")}
              >
                Close issue
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="issue-detail__status-action"
                onClick={() => void updateStatus("open")}
              >
                Reopen issue
              </Button>
            )
          ) : null}
          {canEdit && !titleEditing ? (
            <Button
              variant="ghost"
              className="issue-detail__edit-title"
              onClick={() => {
                setTitleValue(issue.title);
                setTitleError(null);
                setTitleEditing(true);
              }}
            >
              Edit issue title
            </Button>
          ) : null}
        </p>
      </header>

      {titleEditing ? (
        <form className="issue-edit-form" onSubmit={saveTitle}>
          <div className="ui-field" data-invalid={Boolean(titleError) || undefined}>
            <label htmlFor="issue-title">Issue title</label>
            <input
              id="issue-title"
              value={titleValue}
              onChange={(event) => setTitleValue(event.target.value)}
            />
            {titleError ? (
              <p id="issue-title-error" className="ui-field__error" role="alert">
                {titleError}
              </p>
            ) : null}
          </div>
          <Button type="submit" variant="primary">
            Save issue title
          </Button>
        </form>
      ) : null}

      <div className="issue-detail__layout">
        <div className="issue-detail__main">
          <article className="issue-box">
            {issue.description ? (
              <p className="issue-box__description">{issue.description}</p>
            ) : (
              <p className="issue-box__description issue-box__description--empty">
                No description provided.
              </p>
            )}
            <Reactions
              reactions={issue.reactions}
              canReact={authenticated}
              onToggle={(reaction) => toggleReaction("issue", "issue", reaction)}
            />
            {canEdit && !descriptionEditing ? (
              <div className="issue-box__actions">
                <Button
                  variant="ghost"
                  className="issue-detail__edit-description"
                  onClick={() => {
                    setDescriptionValue(issue.description);
                    setDescriptionError(null);
                    setDescriptionEditing(true);
                  }}
                >
                  Edit issue description
                </Button>
              </div>
            ) : null}
            {descriptionEditing ? (
              <form className="issue-edit-form" onSubmit={saveDescription}>
                <div className="ui-field" data-invalid={Boolean(descriptionError) || undefined}>
                  <label htmlFor="issue-description">Issue description</label>
                  <textarea
                    id="issue-description"
                    rows={4}
                    value={descriptionValue}
                    onChange={(event) => setDescriptionValue(event.target.value)}
                  />
                  {descriptionError ? (
                    <p id="issue-description-error" className="ui-field__error" role="alert">
                      {descriptionError}
                    </p>
                  ) : null}
                </div>
                <Button type="submit" variant="primary">
                  Save issue description
                </Button>
              </form>
            ) : null}
          </article>

          <section className="issue-comments" aria-label="Comments">
            <h2>Comments</h2>
            {issue.comments.length === 0 ? (
              <p className="issue-comments__empty">No comments yet.</p>
            ) : (
              issue.comments.map((comment: IssueComment) => (
                <article key={comment.id} className="issue-comment">
                  <header className="issue-comment__header">
                    <strong>{comment.author}</strong> commented{" "}
                    <time dateTime={comment.createdAt}>{formatUpdatedTime(comment.createdAt)}</time>
                  </header>
                  <p className="issue-comment__body">{comment.body}</p>
                  <Reactions
                    reactions={comment.reactions}
                    canReact={authenticated}
                    onToggle={(reaction) => toggleReaction("comment", comment.id, reaction)}
                  />
                </article>
              ))
            )}
            {canEdit ? (
              <form className="issue-comment-form" onSubmit={submitComment}>
                <div className="ui-field" data-invalid={Boolean(commentError) || undefined}>
                  <label htmlFor="issue-comment">Comment</label>
                  <textarea
                    id="issue-comment"
                    rows={3}
                    value={commentValue}
                    onChange={(event) => setCommentValue(event.target.value)}
                  />
                  {commentError ? (
                    <p id="issue-comment-error" className="ui-field__error" role="alert">
                      {commentError}
                    </p>
                  ) : null}
                </div>
                <Button type="submit" variant="primary">
                  Comment
                </Button>
              </form>
            ) : null}
          </section>

          <section className="issue-activity" aria-label="Activity">
            <h2>Activity</h2>
            <TimelineActivity entries={issue.timeline} />
          </section>
        </div>

        <aside className="issue-detail__side">
          <section className="issue-metadata" aria-label="Assignees">
            <div className="issue-metadata__header">
              <h2>Assignees</h2>
              {canManage ? (
                <MetadataPicker
                  label="Assignees"
                  searchable
                  searchLabel="Search assignees"
                  options={assignableMembers.map((username) => ({
                    id: username,
                    name: username,
                    selected: issue.assignees.includes(username),
                  }))}
                  onSelect={updateAssignee}
                />
              ) : null}
            </div>
            {issue.assignees.length > 0 ? (
              <ul className="issue-metadata__list">
                {issue.assignees.map((username) => (
                  <li key={username} aria-label={username}>
                    {username}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="issue-metadata__none">None yet</p>
            )}
          </section>
          <section className="issue-metadata" aria-label="Labels">
            <div className="issue-metadata__header">
              <h2>Labels</h2>
              {canManage ? (
                <MetadataPicker
                  label="Labels"
                  options={labels.map((label: IssueLabel) => ({
                    id: label.name,
                    name: label.name,
                    selected: issue.labels.some((item) => item.name === label.name),
                  }))}
                  onSelect={updateLabel}
                />
              ) : null}
            </div>
            {issue.labels.length > 0 ? (
              <ul className="issue-metadata__list">
                {issue.labels.map((label) => (
                  <li key={label.name} aria-label={label.name}>
                    <span
                      className="issue-label"
                      style={{ "--label-color": label.color } as CSSProperties}
                    >
                      {label.name}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="issue-metadata__none">None yet</p>
            )}
          </section>
          <section className="issue-metadata" aria-label="Milestone">
            <div className="issue-metadata__header">
              <h2>Milestone</h2>
              {canManage ? (
                <MetadataPicker
                  label="Milestone"
                  options={[
                    {
                      id: "",
                      name: "None",
                      selected: issue.milestone === null,
                    },
                    ...milestones.map((milestone) => ({
                      id: milestone.id,
                      name: milestone.title,
                      selected: issue.milestone?.id === milestone.id,
                    })),
                  ]}
                  onSelect={updateMilestone}
                />
              ) : null}
            </div>
            {issue.milestone ? (
              <p className="issue-metadata__milestone">{issue.milestone.title}</p>
            ) : (
              <p className="issue-metadata__none">None yet</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
