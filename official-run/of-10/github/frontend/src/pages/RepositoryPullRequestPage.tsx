import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage } from "./NotFoundPage";
import { useHashLocation } from "../lib/hash-route";
import { pullRequestStatusLabel } from "../lib/pull-requests-api";
import { repositoryPullRequestHref } from "../lib/repository-routes";
import { repositoryTitle } from "../lib/repositories-api";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { PullRequestChangedFiles } from "../pull/PullRequestChangedFiles";
import { PullRequestChecks } from "../pull/PullRequestChecks";
import { PullRequestCommentForm } from "../pull/PullRequestCommentForm";
import { PullRequestCommits } from "../pull/PullRequestCommits";
import { PullRequestConversation } from "../pull/PullRequestConversation";
import { PullRequestMergeBox } from "../pull/PullRequestMergeBox";
import { PullRequestReviewers } from "../pull/PullRequestReviewers";
import { PullRequestReviewSummary } from "../pull/PullRequestReviewSummary";
import { PullRequestStatusActions } from "../pull/PullRequestStatusActions";
import { PullRequestTabs, readPullRequestTab } from "../pull/PullRequestTabs";
import { useRepositoryPullRequest } from "../pull/usePullRequests";

export interface RepositoryPullRequestPageProps {
  owner: string;
  name: string;
  number: number;
}

/**
 * The complete read view of one pull request (REQ-6). The persisted title is the
 * heading, the status is visible text, and Conversation, Commits, Files changed
 * and Checks are navigation links of the same detail page. The Checks area shows
 * the `test` result of the current compare commit on arrival; the changed files
 * and the comparable commits are derived from the same stored record, so the
 * page, the list and a reload never disagree. The right side carries the
 * Reviewers area (REQ-6-4) and the review summary of the comparison
 * (REQ-6-3-4).
 */
export function RepositoryPullRequestPage({ owner, name, number }: RepositoryPullRequestPageProps) {
  const location = useHashLocation();
  const tab = readPullRequestTab(location.search.get("tab"));
  const selectedPath = location.search.get("path") ?? "";
  const { state, setValue } = useRepositoryPullRequest(owner, name, number);

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading pull request…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Pull request unavailable</h1>
        <p role="alert">The pull request could not be loaded. Reload the page to try again.</p>
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
          activeEntry="Pull requests"
        />
        <p className="pull-absent" role="status">
          Pull request <span className="pull-absent__number">#{number}</span> does not exist in this
          repository.
        </p>
      </main>
    );
  }

  const { repository, pullRequest } = state.value;
  // The merge area carries the conditions of the merge itself; the header only
  // repeats an unmet condition when no merge area is rendered for this viewer
  // (REQ-6-5), so the same sentence never appears twice on one page.
  const mergeAreaRendered =
    pullRequest.status === "merged" ||
    (pullRequest.permissions.canMerge &&
      (pullRequest.status === "open" || pullRequest.status === "draft")) ||
    (pullRequest.status === "draft" && pullRequest.permissions.canWrite);

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repositoryTitle(repository)}
        visibility={repository.visibility}
        description={repository.description}
        activeEntry="Pull requests"
      />
      <header className="pull-detail__header">
        <h1 className="pull-detail__title">{pullRequest.title}</h1>
        <p className="pull-detail__meta">
          <span className="pull-detail__number">#{pullRequest.number}</span>
          {" · "}
          <span className="pull-status" data-status={pullRequest.status}>
            {pullRequestStatusLabel(pullRequest.status)}
          </span>
          {" · "}
          <span className="pull-detail__author">{pullRequest.author}</span>
          {" wants to merge "}
          <span className="pull-detail__compare">{pullRequest.compareBranch}</span>
          {" into "}
          <span className="pull-detail__base">{pullRequest.baseBranch}</span>
        </p>
        {/* A merged proposal is terminal: its merge result replaces the
            eligibility sentence, which would only say it cannot be merged. */}
        {pullRequest.status !== "merged" ? (
          <>
            <p
              className="pull-mergeability"
              data-mergeable={pullRequest.mergeability.mergeable}
            >
              {pullRequest.mergeability.mergeable
                ? "This pull request is mergeable."
                : "This pull request is unmergeable."}
            </p>
            {pullRequest.mergeability.reasons.length > 0 && !mergeAreaRendered ? (
              <ul className="pull-mergeability__reasons">
                {pullRequest.mergeability.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        <PullRequestStatusActions
          owner={owner}
          name={name}
          pullRequest={pullRequest}
          onSaved={setValue}
        />
        {/* The merge area of the detail page: the only supported method, the
            conditions of the merge and the confirmation box (REQ-6-5). */}
        <PullRequestMergeBox
          owner={owner}
          name={name}
          number={pullRequest.number}
          pullRequest={pullRequest}
          onSaved={setValue}
        />
      </header>

      <PullRequestTabs owner={owner} name={name} number={pullRequest.number} current={tab} />

      <div className="pull-detail__layout">
        <div className="pull-detail__main">
          {tab === "commits" ? (
            <PullRequestCommits
              owner={owner}
              name={name}
              commits={pullRequest.commits}
              commitCount={pullRequest.commitCount}
            />
          ) : null}
          {tab === "files" ? (
            <PullRequestChangedFiles
              owner={owner}
              name={name}
              number={pullRequest.number}
              pullRequest={pullRequest}
              selectedPath={selectedPath || undefined}
              /* Selecting a changed file stays on this pull request and selects the
                 file's diff, so the aggregate statistics, the visible status and
                 every section remain readable while the diff is inspected. */
              fileHref={(path) =>
                repositoryPullRequestHref(owner, name, pullRequest.number, "files", path)
              }
              onSaved={setValue}
            />
          ) : null}
          {tab === "conversation" ? (
            <PullRequestConversation
              title={pullRequest.title}
              author={pullRequest.author}
              createdAt={pullRequest.createdAt}
              description={pullRequest.description}
              comments={pullRequest.comments}
              reviews={pullRequest.reviews}
              inlineComments={pullRequest.inlineComments}
              activities={pullRequest.activities}
              commentForm={
                pullRequest.permissions.canComment ? (
                  <PullRequestCommentForm
                    owner={owner}
                    name={name}
                    number={pullRequest.number}
                    onSaved={setValue}
                  />
                ) : null
              }
            />
          ) : null}
        </div>

        {/* The right side of the detail page: who is asked to review and what
            every reviewer decided about the comparison on screen. */}
        <aside className="pull-detail__side" aria-label="Review">
          <PullRequestReviewers
            owner={owner}
            name={name}
            number={pullRequest.number}
            requestedReviewers={pullRequest.requestedReviewers}
            candidates={pullRequest.reviewerCandidates}
            canRequest={pullRequest.permissions.canRequestReviewers}
            onSaved={setValue}
          />
          <PullRequestReviewSummary reviews={pullRequest.reviews} />
        </aside>
      </div>

      {/* The Checks area is part of the detail page itself, so it is available on
          arrival and its `test` result can be read without another navigation. */}
      <PullRequestChecks
        owner={owner}
        name={name}
        number={pullRequest.number}
        checks={pullRequest.checks}
        canSetStatus={pullRequest.permissions.canSetCheckStatus}
        onSaved={setValue}
      />
    </main>
  );
}
