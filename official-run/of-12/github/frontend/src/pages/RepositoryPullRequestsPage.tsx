import { navigate, useHashLocation } from "../lib/hash-route";
import { PullRequestFilterBar } from "../features/pull-requests/PullRequestFilterBar";
import { PullRequestList } from "../features/pull-requests/PullRequestList";
import {
  filterPullRequests,
  parsePullRequestFilters,
  pullRequestAuthors,
  pullRequestFilterParams,
  type PullRequestFilters,
} from "../features/pull-requests/pull-request-filters";
import { newPullRequestHref, pullRequestsPath } from "../features/pull-requests/pull-request-links";
import { useRepositoryPullRequests } from "../features/pull-requests/use-pull-requests";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryPullRequestsPageProps {
  owner: string;
  name: string;
}

/**
 * Pull requests page of a repository (REQ-6-2-1).
 *
 * The page lists the current repository's pull requests with their
 * repository-scoped number, title, author, source/target branches and status;
 * the number and the title open the detail page of that pull request. The
 * Draft/Open/Closed/Merged links, the author filter and the review-status
 * filter narrow the displayed rows and only the displayed rows — the filter
 * context lives in the address, so a reload keeps the chosen filters, and
 * nothing here creates or changes a pull request, a branch or a review. A
 * visitor of a public repository reads the same rows as a signed-in user; only
 * an account that may create pull requests sees the “New pull request” entry.
 */
export function RepositoryPullRequestsPage({ owner, name }: RepositoryPullRequestsPageProps) {
  const { search } = useHashLocation();
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const { state, payload } = useRepositoryPullRequests(owner, name, repositoryState === "ready");
  const filters = parsePullRequestFilters(search);

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  const pullRequests = payload?.pullRequests ?? [];
  const rows = filterPullRequests(pullRequests, filters);
  const path = pullRequestsPath(repository);

  function updateFilters(next: PullRequestFilters) {
    navigate(path, pullRequestFilterParams(next));
  }

  return (
    <main className="repository-pulls-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="pulls" />
      <section className="repository-pulls" aria-label="Pull requests">
        <h2>Pull requests</h2>
        {payload?.canCreatePullRequest ? (
          <a className="repository-pulls__new" href={newPullRequestHref(repository)}>
            New pull request
          </a>
        ) : null}
        <PullRequestFilterBar
          repository={repository}
          authors={pullRequestAuthors(pullRequests)}
          ready={state === "ready"}
          filters={filters}
          onChange={updateFilters}
        />

        {state === "loading" || state === "idle" ? <p role="status">Loading pull requests…</p> : null}
        {state === "failed" || state === "denied" ? (
          <p role="alert">The pull requests could not be loaded. Please try again.</p>
        ) : null}
        {state === "ready" && pullRequests.length === 0 ? (
          <p className="repository-pulls__empty">No pull requests yet.</p>
        ) : null}
        {state === "ready" && pullRequests.length > 0 && rows.length === 0 ? (
          <p className="repository-pulls__empty">No pull requests match your filters.</p>
        ) : null}
        {rows.length > 0 ? (
          <PullRequestList repository={repository} pullRequests={rows} />
        ) : null}
      </section>
    </main>
  );
}
