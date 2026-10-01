import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  closeRepositoryPullRequest,
  fetchRepositoryPullRequest,
  markPullRequestReadyForReview,
  pullRequestSectionHref,
  reopenRepositoryPullRequest,
  type PullRequestSection,
  type RepositoryPullRequestDetail,
} from "../../lib/pull-requests-api";
import { useDocumentTitle } from "../../lib/document-title";
import { Button, Dialog } from "../../ui";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryHeader } from "../repositories/RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "../repositories/RepositoryPageStates";
import { useRepositoryResource } from "../repositories/useRepositoryResource";
import { PullRequestChecks } from "./PullRequestChecks";
import { PullRequestCommits } from "./PullRequestCommits";
import { PullRequestConversation } from "./PullRequestConversation";
import { PullRequestFilesChanged } from "./PullRequestFilesChanged";
import { PullRequestMergeArea } from "./PullRequestMergeArea";
import { PullRequestReviewers } from "./PullRequestReviewers";
import {
  formatPullRequestTime,
  pullRequestBranchText,
  pullRequestStatusLabel,
} from "./pull-format";

export interface PullRequestDetailPageProps {
  owner: string;
  name: string;
  /** The repository-scoped pull request number of the address. */
  number: string;
  /** The open section: the conversation is the entry of the detail page. */
  section: PullRequestSection;
}

const SECTIONS: Array<{ id: PullRequestSection; label: string }> = [
  { id: "conversation", label: "Conversation" },
  { id: "commits", label: "Commits" },
  { id: "files", label: "Files changed" },
  { id: "checks", label: "Checks" },
];

/**
 * One numbered pull request. The heading is the stored title exactly, the
 * status is visible text, and the Conversation, Commits, Files changed and
 * Checks entries are navigation links that keep the same persisted record. The
 * author may mark their own draft as ready for review, Maintain, Admin and the
 * organization Owner may merge, and a draft can never be merged.
 */
export function PullRequestDetailPage({
  owner,
  name,
  number,
  section,
}: PullRequestDetailPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const resourceKey = `repository-pull:${owner}/${name}#${number}`;
  const resource = useRepositoryResource<RepositoryPullRequestDetail>(
    resourceKey,
    sessionStatus !== "loading",
    () => fetchRepositoryPullRequest(owner, name, number),
  );

  // The answer of an accepted write; the address change clears it again so a
  // different pull request never shows the values of the previous one.
  const [saved, setSaved] = useState<RepositoryPullRequestDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingReady, setConfirmingReady] = useState(false);

  useEffect(() => {
    setSaved(null);
    setPending(false);
    setActionError(null);
    setConfirmingReady(false);
  }, [resourceKey]);

  useDocumentTitle(
    resource.status === "ready"
      ? `${resource.value.pullRequest.title} · ${owner}/${name}`
      : `Pull request · ${owner}/${name}`,
  );

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

  const detail = saved ?? resource.value;
  const { repository, pullRequest } = detail;

  async function run(write: Promise<RepositoryPullRequestDetail>): Promise<boolean> {
    setPending(true);
    setActionError(null);
    try {
      setSaved(await write);
      return true;
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "The pull request was not updated.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  async function confirmReady(): Promise<void> {
    const done = await run(markPullRequestReadyForReview(owner, name, pullRequest.number));
    if (done) setConfirmingReady(false);
  }

  /**
   * The answer of an accepted write of another part of the page. The saved
   * payload replaces the loaded one, so every view of the record follows the
   * same stored state.
   */
  function applyUpdated(next: RepositoryPullRequestDetail): void {
    setSaved(next);
    setActionError(null);
  }

  return (
    <div className="repository-pull">
      <RepositoryHeader
        owner={repository.owner}
        name={repository.name}
        visibility={repository.visibility}
        description={repository.description}
        defaultBranch={repository.defaultBranch}
        showSettings={Boolean(account)}
        active="pulls"
        source={repository.source ?? null}
      />
      <article className="pull-request-detail">
        <header className="pull-request-detail__head">
          {/* The heading names the pull request exactly, without its number. */}
          <h1 className="pull-request-detail__title">{pullRequest.title}</h1>
          <p className="pull-request-detail__meta">
            <span className="pull-request-detail__number">{`#${pullRequest.number}`}</span>
            <span
              className="pull-request-detail__status"
              data-status={pullRequest.status}
            >
              {pullRequestStatusLabel(pullRequest.status)}
            </span>
            <span className="pull-request-detail__author">
              {pullRequest.author ?? "Unknown author"}
            </span>
            <span className="pull-request-detail__branches">
              {pullRequestBranchText(pullRequest)}
            </span>
            <time className="pull-request-detail__time" dateTime={pullRequest.createdAt}>
              {formatPullRequestTime(pullRequest.createdAt)}
            </time>
          </p>
          <div className="pull-request-detail__status-actions">
            {/* Ready for review and close/reopen stay available next to the
                merge area; the merge itself is confirmed in its own area. */}
            {detail.canReadyForReview ? (
              <Button type="button" disabled={pending} onClick={() => setConfirmingReady(true)}>
                Ready for review
              </Button>
            ) : null}
            {/* Closing and reopening act at once, without a second confirmation
                dialog; both entries are absent for a viewer who is neither the
                author nor a Maintain, an Admin or the organization Owner. */}
            {detail.canClose ? (
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  void run(closeRepositoryPullRequest(owner, name, pullRequest.number));
                }}
              >
                Close pull request
              </Button>
            ) : null}
            {detail.canReopen ? (
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  void run(reopenRepositoryPullRequest(owner, name, pullRequest.number));
                }}
              >
                Reopen pull request
              </Button>
            ) : null}
          </div>
        </header>
        {actionError ? (
          <p className="pull-request-detail__error" role="alert">
            {actionError}
          </p>
        ) : null}
        <PullRequestMergeArea
          owner={repository.owner}
          name={repository.name}
          detail={detail}
          onUpdated={applyUpdated}
        />
        <nav className="pull-request-detail__nav" aria-label="Pull request">
          {SECTIONS.map((entry) => (
            <a
              key={entry.id}
              href={pullRequestSectionHref(owner, name, pullRequest.number, entry.id)}
              aria-current={section === entry.id ? "page" : undefined}
            >
              {entry.label}
            </a>
          ))}
        </nav>
        <div className="pull-request-detail__body">
          <div className="pull-request-detail__main">
            {section === "conversation" ? (
              <>
                <PullRequestConversation detail={detail} />
                {/* The Checks area of the current compare commit is available
                    on arrival as well, next to the conversation. */}
                <PullRequestChecks
                  owner={repository.owner}
                  name={repository.name}
                  detail={detail}
                  onUpdated={applyUpdated}
                />
              </>
            ) : null}
            {section === "commits" ? (
              <PullRequestCommits owner={repository.owner} name={repository.name} detail={detail} />
            ) : null}
            {section === "files" ? (
              <PullRequestFilesChanged
                owner={repository.owner}
                name={repository.name}
                detail={detail}
                onUpdated={setSaved}
              />
            ) : null}
            {section === "checks" ? (
              <PullRequestChecks
                owner={repository.owner}
                name={repository.name}
                detail={detail}
                onUpdated={applyUpdated}
              />
            ) : null}
          </div>
          <aside className="pull-request-detail__aside">
            <PullRequestReviewers
              owner={repository.owner}
              name={repository.name}
              detail={detail}
              onUpdated={setSaved}
            />
          </aside>
        </div>
        <Dialog
          open={confirmingReady}
          title="Mark ready for review"
          onOpenChange={setConfirmingReady}
          actions={
            <Button type="button" disabled={pending} onClick={() => void confirmReady()}>
              Confirm
            </Button>
          }
        >
          <p>Turn this draft into an open pull request?</p>
        </Dialog>
      </article>
    </div>
  );
}
