import { useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage } from "./NotFoundPage";
import { issueDateTime } from "../lib/issue-dates";
import { canManageIssues, canWriteIssues, issueStatusLabel } from "../lib/issues-api";
import { repositoryTitle } from "../lib/repositories-api";
import { IssueDescriptionEditor, IssueTitleEditor } from "../issue/IssueEditForms";
import { IssueDiscussion } from "../issue/IssueDiscussion";
import { IssueMetadata } from "../issue/IssueMetadata";
import { IssueReactions } from "../issue/IssueReactions";
import { IssueStatusAction } from "../issue/IssueStatusAction";
import { useRepositoryIssue } from "../issue/useIssues";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { Button } from "../ui";

export interface RepositoryIssuePageProps {
  owner: string;
  name: string;
  number: number;
}

/**
 * The complete read view of one issue (REQ-5-1-2): the number, the title as the
 * heading, the Open/Closed status, the description, the discussion with its
 * activity timeline, and Assignees/Labels/Milestone on the right. Any reader of
 * the repository sees the stored record; the edit controls are only rendered for
 * the roles that may use them, and the server rejects every other submission.
 */
export function RepositoryIssuePage({ owner, name, number }: RepositoryIssuePageProps) {
  const { state, setValue } = useRepositoryIssue(owner, name, number);
  const { account } = useAuth();
  const [editing, setEditing] = useState<"title" | "description" | null>(null);

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading issue…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Issue unavailable</h1>
        <p role="alert">The issue could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  if (state.status === "missing") {
    if (!state.context) return <NotFoundPage />;
    const context = state.context;
    return (
      <main>
        <RepositoryChrome
          owner={owner}
          name={name}
          title={repositoryTitle(context)}
          visibility={context.visibility}
          description={context.description}
          activeEntry="Issues"
        />
        <p className="issue-absent" role="status">
          Issue <span className="issue-absent__number">#{number}</span> does not exist in this
          repository.
        </p>
      </main>
    );
  }

  const { repository, issue, labels, milestones, assignableMembers } = state.value;
  const role = repository.permissions?.role ?? null;
  const canEdit = canWriteIssues(role);
  const canManage = canManageIssues(role);
  const signedIn = Boolean(account);

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repositoryTitle(repository)}
        visibility={repository.visibility}
        description={repository.description}
        activeEntry="Issues"
      />
      <div className="issue-detail">
        <div className="issue-detail__main">
          <header className="issue-detail__header">
            <h1 className="issue-detail__title">{issue.title}</h1>
            <p className="issue-detail__meta">
              <span className="issue-detail__number">#{issue.number}</span>
              {" · "}
              <span className="issue-status" data-status={issue.status}>
                {issueStatusLabel(issue.status)}
              </span>
              {" · "}
              <span className="issue-detail__author">{issue.author}</span>
              {" opened this issue on "}
              <time dateTime={issue.createdAt}>{issueDateTime(issue.createdAt)}</time>
            </p>
            {canEdit && editing === "title" ? (
              <IssueTitleEditor
                owner={owner}
                name={name}
                number={issue.number}
                current={issue.title}
                onSaved={(payload) => {
                  setValue(payload);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : null}
            {canEdit && editing !== "title" ? (
              <p className="issue-detail__edit">
                <Button
                  variant="secondary"
                  aria-label="Edit issue title"
                  onClick={() => setEditing("title")}
                >
                  Edit
                </Button>
              </p>
            ) : null}
            {/* Closing and reopening need Triage, Maintain or Admin (REQ-5-4); a
                Write or Read viewer only sees the status text above. */}
            {canManage ? (
              <IssueStatusAction
                owner={owner}
                name={name}
                number={issue.number}
                status={issue.status}
                onSaved={setValue}
              />
            ) : null}
          </header>

          <section className="issue-description" aria-labelledby="issue-description-heading">
            <h2 id="issue-description-heading" className="issue-section-heading">
              Description
            </h2>
            <p className="issue-description__body">
              {issue.description || "No description provided."}
            </p>
            {canEdit && editing === "description" ? (
              <IssueDescriptionEditor
                owner={owner}
                name={name}
                number={issue.number}
                current={issue.description}
                onSaved={(payload) => {
                  setValue(payload);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : null}
            {canEdit && editing !== "description" ? (
              <p className="issue-detail__edit">
                <Button
                  variant="secondary"
                  aria-label="Edit issue description"
                  onClick={() => setEditing("description")}
                >
                  Edit
                </Button>
              </p>
            ) : null}
          </section>

          {signedIn || (issue.reactions?.length ?? 0) > 0 ? (
            <div className="issue-reactions-bar">
              <IssueReactions
                owner={owner}
                name={name}
                number={number}
                reactions={issue.reactions ?? []}
                triggerLabel="Add reaction to issue"
                signedIn={signedIn}
                onSaved={setValue}
              />
            </div>
          ) : null}

          <IssueDiscussion
            owner={owner}
            name={name}
            number={number}
            comments={issue.comments}
            activities={issue.activities}
            canComment={canEdit}
            signedIn={signedIn}
            onSaved={setValue}
          />
        </div>

        <IssueMetadata
          owner={owner}
          name={name}
          number={number}
          issue={issue}
          labels={labels}
          milestones={milestones ?? []}
          assignableMembers={assignableMembers ?? []}
          canManage={canManage}
          onSaved={setValue}
        />
      </div>
    </main>
  );
}
