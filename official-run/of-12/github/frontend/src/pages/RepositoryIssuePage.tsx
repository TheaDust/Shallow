import { useSession } from "../lib/session";
import { IssueCommentEditor } from "../features/issues/IssueCommentEditor";
import { IssueDescriptionEditor } from "../features/issues/IssueDescriptionEditor";
import { IssueDiscussion } from "../features/issues/IssueDiscussion";
import { IssueMetadata } from "../features/issues/IssueMetadata";
import { IssueReactions } from "../features/issues/IssueReactions";
import { IssueStatusControl } from "../features/issues/IssueStatusControl";
import { IssueTitleEditor } from "../features/issues/IssueTitleEditor";
import { formatIssueTime } from "../features/issues/format-issue-time";
import {
  changeIssueStatus,
  postIssueComment,
  saveIssueDescription,
  saveIssueTitle,
  setIssueMilestone,
  toggleIssueAssignee,
  toggleIssueLabel,
  toggleIssueReaction,
  type IssueDetailPayload,
  type IssueStatus,
} from "../features/issues/issue-api";
import { useRepositoryIssue } from "../features/issues/use-issues";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryIssuePageProps {
  owner: string;
  name: string;
  /** The repository-scoped number from the address; digits only. */
  number: string;
}

function IssueNotFound({ owner, name }: { owner: string; name: string }) {
  return (
    <main className="repository-page">
      <h1>Issue not found</h1>
      <p>This repository has no issue with that number.</p>
      <p>
        <a href={`#/${owner}/${name}/issues`}>Back to issues</a>
      </p>
    </main>
  );
}

/**
 * The complete view of one work item (REQ-5-1-2) and the surface of the issue
 * writes (REQ-5-2).
 *
 * The top spells the repository-scoped number, the complete title as the heading
 * and the visible Open/Closed status; the body shows the stored description; the
 * right side lists the assignees, the labels and the milestone in that order; the
 * bottom shows the stored comments and the append-only activity history in
 * chronological order. The written controls appear only for the roles the
 * operation allows — editing and commenting need Write, Maintain or Admin — and
 * every accepted write is re-read from the server, so the page never shows a
 * change the server did not store.
 */
export function RepositoryIssuePage({ owner, name, number }: RepositoryIssuePageProps) {
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const { state, payload, reload } = useRepositoryIssue(owner, name, number, repositoryState === "ready");
  const { user } = useSession();

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;
  if (state === "missing") return <IssueNotFound owner={owner} name={name} />;
  if (state === "denied") {
    return (
      <main className="repository-page">
        <h1>Access denied</h1>
        <p>Your account does not have permission to view this issue.</p>
      </main>
    );
  }
  // The read of the addressed number is the one that is rendered: a re-read of
  // the same issue keeps the stored view (so a write never blanks the page),
  // while another number waits for its own record.
  const loaded = payload && String(payload.issue.number) === String(number) ? payload : null;
  if (!loaded) {
    return (
      <main className="repository-page">
        <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="issues" />
        {state === "failed" ? (
          <p role="alert">The issue could not be loaded. Please try again.</p>
        ) : (
          <p role="status">Loading issue…</p>
        )}
      </main>
    );
  }

  return (
    <main className="repository-issue-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="issues" />
      <IssueDetail
        payload={loaded}
        owner={owner}
        name={name}
        number={number}
        signedIn={Boolean(user)}
        onChanged={reload}
      />
    </main>
  );
}

interface IssueDetailProps {
  payload: IssueDetailPayload;
  owner: string;
  name: string;
  number: string;
  /** A signed-in viewer may react on the issue and on its comments (REQ-5-2-3). */
  signedIn: boolean;
  onChanged(): void;
}

function IssueDetail({ payload, owner, name, number, signedIn, onChanged }: IssueDetailProps) {
  const { issue, comments, timeline, permissions } = payload;

  const saveTitle = async (title: string) => {
    const result = await saveIssueTitle(owner, name, number, title);
    if (result.ok) onChanged();
    return result;
  };

  const saveDescription = async (description: string) => {
    const result = await saveIssueDescription(owner, name, number, description);
    if (result.ok) onChanged();
    return result;
  };

  const addComment = async (body: string) => {
    const result = await postIssueComment(owner, name, number, body);
    if (result.ok) onChanged();
    return result;
  };

  const react = async (type: string, commentId?: string) => {
    const result = await toggleIssueReaction(owner, name, number, { type, commentId });
    if (result.ok) onChanged();
  };

  const assign = async (username: string) => {
    const result = await toggleIssueAssignee(owner, name, number, username);
    if (result.ok) onChanged();
    return result;
  };

  const toggleLabel = async (label: string) => {
    const result = await toggleIssueLabel(owner, name, number, label);
    if (result.ok) onChanged();
    return result;
  };

  const setMilestone = async (milestone: string | null) => {
    const result = await setIssueMilestone(owner, name, number, milestone);
    if (result.ok) onChanged();
    return result;
  };

  const setStatus = async (status: IssueStatus) => {
    const result = await changeIssueStatus(owner, name, number, status);
    if (result.ok) onChanged();
    return result;
  };

  return (
    <article className="repository-issue">
      <div className="repository-issue__heading">
        <IssueTitleEditor title={issue.title} canEdit={permissions.canEditIssue} onSave={saveTitle} />
        <span className="repository-issue__number">#{issue.number}</span>
        <span className="repository-issue__status">{issue.status === "open" ? "Open" : "Closed"}</span>
        <IssueStatusControl
          status={issue.status}
          canChangeStatus={permissions.canChangeStatus}
          onChange={setStatus}
        />
      </div>

      <div className="repository-issue__layout">
        <div className="repository-issue__main">
          <IssueDescriptionEditor
            description={issue.body}
            canEdit={permissions.canEditIssue}
            onSave={saveDescription}
          />
          <p className="repository-issue__byline">
            <span className="repository-issue__author">{issue.author}</span> opened this issue{" "}
            <span className="repository-issue__time">{formatIssueTime(issue.createdAt)}</span>
          </p>
          <IssueReactions
            reactions={issue.reactions}
            canReact={signedIn}
            onToggle={(type) => void react(type)}
          />

          <IssueDiscussion
            comments={comments}
            timeline={timeline}
            canReact={signedIn}
            onToggleReaction={(type, commentId) => void react(type, commentId)}
            editor={
              <IssueCommentEditor
                canComment={permissions.canComment}
                onSubmit={addComment}
              />
            }
          />
        </div>

        <IssueMetadata
          issue={issue}
          labels={payload.labels}
          milestones={payload.milestones}
          members={payload.assignableMembers}
          permissions={permissions}
          onAssign={assign}
          onToggleLabel={toggleLabel}
          onSetMilestone={setMilestone}
        />
      </div>
    </article>
  );
}
