import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  addIssueComment,
  fetchRepositoryIssue,
  setIssueMilestone,
  setIssueState,
  toggleIssueAssignee,
  toggleIssueLabel,
  toggleIssueReaction,
  updateRepositoryIssue,
  type IssueReactionType,
  type RepositoryIssueDetail,
} from "../../lib/issues-api";
import { useDocumentTitle } from "../../lib/document-title";
import { Button } from "../../ui/Button";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryHeader } from "../repositories/RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "../repositories/RepositoryPageStates";
import { useRepositoryResource } from "../repositories/useRepositoryResource";
import { IssueDescription } from "./IssueDescription";
import { IssueDiscussion } from "./IssueDiscussion";
import { IssueEditForm } from "./IssueEditForm";
import { IssueLabelList } from "./IssueLabelList";
import { IssueMetadataPicker, type IssueMetadataOption } from "./IssueMetadataPicker";
import { IssueTimeline } from "./IssueTimeline";
import { formatIssueTime, issueStateLabel } from "./issue-format";

export interface IssueDetailPageProps {
  owner: string;
  name: string;
  /** The repository-scoped issue number of the address, with or without `#`. */
  number: string;
}

/** The option that deletes the single milestone association. */
const NONE_MILESTONE_ID = "none";

/** The server message of a refused save, preferring the message of the field. */
function saveMessage(error: unknown, field: string): string {
  if (error instanceof ApiError) {
    const body = error.body;
    if (body && typeof body === "object" && "fieldErrors" in body) {
      const fieldErrors = (body as { fieldErrors?: Record<string, string> }).fieldErrors ?? {};
      if (fieldErrors[field]) return fieldErrors[field];
    }
    return error.message;
  }
  return "The issue was not saved.";
}

/**
 * The complete view of one numbered work item: the title heading without the
 * number, the visible status, the description, the right-side Assignees, Labels
 * and Milestone metadata and the discussion below. Any reader with repository
 * permission sees the same persisted record, so a reload or a reopened address
 * shows the same title, status, metadata and comments; the collaboration
 * controls are offered only to the roles the server accepts, which re-checks
 * every write.
 */
export function IssueDetailPage({ owner, name, number }: IssueDetailPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const issueNumber = number.trim().replace(/^#/, "");
  const resourceKey = `repository-issue:${owner}/${name}#${issueNumber}`;

  const resource = useRepositoryResource<RepositoryIssueDetail>(
    resourceKey,
    sessionStatus !== "loading",
    () => fetchRepositoryIssue(owner, name, issueNumber),
  );
  // The answer of an accepted write; the address change clears it again so a
  // different issue never shows the values of the previous one.
  const [saved, setSaved] = useState<RepositoryIssueDetail | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  // A metadata save is in flight: the pickers stay on the page but their
  // options are disabled until the stored record comes back.
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setSaved(null);
    setActionError(null);
    setEditingTitle(false);
  }, [resourceKey]);

  useDocumentTitle(`${owner}/${name} issue`);

  if (resource.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  if (resource.status === "missing" || resource.status === "error") {
    return <RepositoryNotFound />;
  }

  if (resource.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const { repository, issue, comments, events, canWrite, canTriage } =
    saved ?? resource.value;
  const { labels, milestones, assigneeCandidates } = saved ?? resource.value;
  const canReact = Boolean(account);

  /**
   * Publishes one form submission and answers the message of a refusal, so the
   * form that owns the error shows it exactly once.
   */
  function applyWrite(
    write: Promise<RepositoryIssueDetail>,
    field: string,
  ): Promise<string | null> {
    return write
      .then((next) => {
        setSaved(next);
        return null;
      })
      .catch((error) => saveMessage(error, field));
  }

  /** A reaction has no form of its own, so its refusal is shown on the page. */
  function applyReaction(write: Promise<RepositoryIssueDetail>): void {
    write
      .then((next) => {
        setSaved(next);
        setActionError(null);
      })
      .catch((error) => {
        setActionError(saveMessage(error, "reaction"));
      });
  }

  /**
   * Publishes one metadata save. The answer is the persisted detail payload, so
   * the sidebar, the status and the activity timeline all show the stored
   * record; a refusal leaves the page on the last stored state.
   */
  function applyMetadata(write: Promise<RepositoryIssueDetail>): void {
    setPending(true);
    write
      .then((next) => {
        setSaved(next);
        setActionError(null);
      })
      .catch((error) => {
        setActionError(saveMessage(error, "metadata"));
      })
      .finally(() => setPending(false));
  }

  /** The option list of the Assignees area: the members with Triage or above. */
  const assigneeOptions: IssueMetadataOption[] = assigneeCandidates.map((username) => ({
    id: username,
    label: username,
    selected: issue.assignees.includes(username),
  }));

  /** The option list of the Labels area: the labels of the current repository. */
  const labelOptions: IssueMetadataOption[] = labels.map((label) => ({
    id: label.name,
    label: label.name,
    selected: issue.labels.some((applied) => applied.name === label.name),
  }));

  /** The single-select milestone list, with the option that clears it. */
  const milestoneOptions: IssueMetadataOption[] = [
    ...milestones.map((milestone) => ({
      id: milestone.title,
      label: milestone.title,
      selected: issue.milestone?.title === milestone.title,
    })),
    {
      id: NONE_MILESTONE_ID,
      label: "None",
      selected: issue.milestone === null,
    },
  ];

  return (
    <div className="repository-issue">
      <RepositoryHeader
        owner={repository.owner}
        name={repository.name}
        visibility={repository.visibility}
        description={repository.description}
        defaultBranch={repository.defaultBranch}
        showSettings={Boolean(account)}
        active="issues"
        source={repository.source ?? null}
      />
      {/* The detail article stays unnamed: naming it after the title would
          shadow the labels of the controls inside it. */}
      <article className="issue-detail">
        <header className="issue-detail__head">
          {/* The heading names the issue exactly, without its number. */}
          <h1 className="issue-detail__title" id="issue-detail-title">
            {issue.title}
          </h1>
          <p className="issue-detail__meta">
            <span className="issue-detail__number">{`#${issue.number}`}</span>
            <span className="issue-detail__state" data-state={issue.state}>
              {issueStateLabel(issue.state)}
            </span>
            <span className="issue-detail__author">{issue.author ?? "Unknown author"}</span>
            <time className="issue-detail__time" dateTime={issue.createdAt}>
              {formatIssueTime(issue.createdAt)}
            </time>
          </p>
          {/* Closing and reopening need no confirmation, so one button carries
              the action the current status allows; Read and Write viewers
              never receive either control. */}
          {canTriage ? (
            <div className="issue-detail__status-actions">
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  applyMetadata(
                    setIssueState(owner, name, issueNumber, {
                      state: issue.state === "closed" ? "open" : "closed",
                    }),
                  )
                }
              >
                {issue.state === "closed" ? "Reopen issue" : "Close issue"}
              </Button>
            </div>
          ) : null}
          {canWrite ? (
            editingTitle ? (
              <IssueEditForm
                fieldLabel="Issue title"
                saveLabel="Save issue title"
                value={issue.title}
                onSave={async (value) => {
                  const message = await applyWrite(
                    updateRepositoryIssue(owner, name, issueNumber, { title: value }),
                    "title",
                  );
                  if (message === null) setEditingTitle(false);
                  return message;
                }}
                onCancel={() => setEditingTitle(false)}
              />
            ) : (
              <Button type="button" onClick={() => setEditingTitle(true)}>
                Edit issue title
              </Button>
            )
          ) : null}
        </header>
        {actionError ? (
          <p className="issue-detail__action-error" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="issue-detail__columns">
          <div className="issue-detail__main">
            <IssueDescription
              issue={issue}
              canWrite={canWrite}
              canReact={canReact}
              onSaveDescription={(value) =>
                applyWrite(
                  updateRepositoryIssue(owner, name, issueNumber, { description: value }),
                  "description",
                )
              }
              onToggleReaction={(reaction: IssueReactionType) => {
                applyReaction(toggleIssueReaction(owner, name, issueNumber, { reaction }));
              }}
            />
            <IssueDiscussion
              comments={comments}
              canWrite={canWrite}
              canReact={canReact}
              onSubmitComment={(body) =>
                applyWrite(addIssueComment(owner, name, issueNumber, body), "comment")
              }
              onToggleReaction={(reaction, commentId) => {
                applyReaction(
                  toggleIssueReaction(owner, name, issueNumber, { reaction, commentId }),
                );
              }}
            />
            <IssueTimeline events={events} />
          </div>
          <aside className="issue-detail__sidebar" aria-label="Issue metadata">
            <section className="issue-detail__metadata" aria-labelledby="issue-assignees-title">
              <div className="issue-detail__metadata-head">
                <h2 id="issue-assignees-title">Assignees</h2>
                {canTriage ? (
                  <IssueMetadataPicker
                    triggerLabel="Assignees"
                    searchLabel="Search assignees"
                    multiSelect
                    busy={pending}
                    emptyLabel="No matching members"
                    options={assigneeOptions}
                    onSelect={(option) =>
                      applyMetadata(
                        toggleIssueAssignee(owner, name, issueNumber, {
                          username: option.label,
                          assigned: !option.selected,
                        }),
                      )
                    }
                  />
                ) : null}
              </div>
              {issue.assignees.length === 0 ? (
                <p className="issue-detail__empty">No one assigned</p>
              ) : (
                <ul className="issue-detail__assignees">
                  {issue.assignees.map((assignee) => (
                    <li key={assignee}>{assignee}</li>
                  ))}
                </ul>
              )}
            </section>
            <section className="issue-detail__metadata" aria-labelledby="issue-labels-title">
              <div className="issue-detail__metadata-head">
                <h2 id="issue-labels-title">Labels</h2>
                {canTriage ? (
                  <IssueMetadataPicker
                    triggerLabel="Labels"
                    multiSelect
                    busy={pending}
                    options={labelOptions}
                    onSelect={(option) =>
                      applyMetadata(
                        toggleIssueLabel(owner, name, issueNumber, {
                          name: option.label,
                          applied: !option.selected,
                        }),
                      )
                    }
                  />
                ) : null}
              </div>
              {issue.labels.length === 0 ? (
                <p className="issue-detail__empty">None yet</p>
              ) : (
                <IssueLabelList labels={issue.labels} />
              )}
            </section>
            <section className="issue-detail__metadata" aria-labelledby="issue-milestone-title">
              <div className="issue-detail__metadata-head">
                <h2 id="issue-milestone-title">Milestone</h2>
                {canTriage ? (
                  <IssueMetadataPicker
                    triggerLabel="Milestone"
                    busy={pending}
                    options={milestoneOptions}
                    onSelect={(option) =>
                      applyMetadata(
                        setIssueMilestone(owner, name, issueNumber, {
                          title: option.id === NONE_MILESTONE_ID ? null : option.label,
                        }),
                      )
                    }
                  />
                ) : null}
              </div>
              {issue.milestone ? (
                <p className="issue-detail__milestone">{issue.milestone.title}</p>
              ) : (
                <p className="issue-detail__empty">No milestone</p>
              )}
            </section>
          </aside>
        </div>
      </article>
    </div>
  );
}
