import { useEffect, useState } from "react";

import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { parseHashLocation } from "../lib/hash-route";
import {
  canCreatePullRequests,
  type PullRequestSummary,
} from "../lib/pull-requests-api";
import {
  filterPullRequests,
  readPullRequestFilters,
  writePullRequestFiltersToAddress,
  type PullRequestFilterPatch,
  type PullRequestFilterValues,
} from "../lib/pull-request-filters";
import {
  repositoryNewPullRequestHref,
  repositoryPullRequestsPath,
} from "../lib/repository-routes";
import { repositoryTitle } from "../lib/repositories-api";
import { PullRequestFilterBar } from "../pull/PullRequestFilterBar";
import { PullRequestList } from "../pull/PullRequestList";
import { useRepositoryPullRequests } from "../pull/usePullRequests";
import { RepositoryChrome } from "../repository/RepositoryChrome";

export interface RepositoryPullRequestsPageProps {
  owner: string;
  name: string;
}

/** The filter of the current address, read once when the page is opened. */
function filtersFromAddress(): PullRequestFilterValues {
  return readPullRequestFilters(parseHashLocation(window.location.hash).search);
}

/**
 * The Pull requests list of one repository (REQ-6-2-1). The rows are always the
 * stored pull requests of this repository; the status, the author and the review
 * status of the current view live in the page address, so refreshing the page —
 * or reopening it later — shows the same rows and filtering never writes or
 * deletes a pull request, a branch or a review.
 */
export function RepositoryPullRequestsPage({ owner, name }: RepositoryPullRequestsPageProps) {
  const { state } = useRepositoryPullRequests(owner, name);
  const [filters, setFilters] = useState<PullRequestFilterValues>(filtersFromAddress);

  useEffect(() => {
    const syncFromAddress = () => setFilters(filtersFromAddress());
    window.addEventListener("hashchange", syncFromAddress);
    return () => window.removeEventListener("hashchange", syncFromAddress);
  }, []);

  const update = (patch: PullRequestFilterPatch) => {
    // The address is the source of truth of the current view, so a change made
    // while a status link is being followed never drops the other filters.
    const next: PullRequestFilterValues = { ...filtersFromAddress(), ...patch };
    setFilters(next);
    writePullRequestFiltersToAddress(repositoryPullRequestsPath(owner, name), next);
  };

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading pull requests…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Pull requests unavailable</h1>
        <p role="alert">
          The pull requests could not be loaded. Reload the page to try again.
        </p>
      </main>
    );
  }

  const { repository, pullRequests } = state.value;
  const visible: PullRequestSummary[] = filterPullRequests(pullRequests, filters);

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
      <div className="pull-toolbar">
        <PullRequestFilterBar
          owner={owner}
          name={name}
          filters={filters}
          onChange={update}
        />
        {/* Only Write, Maintain, Admin and an organization Owner may compare
            branches and open a pull request (REQ-6-2-2). */}
        {canCreatePullRequests(repository.permissions?.role ?? null) ? (
          <p className="pull-new">
            <a className="pull-new__link" href={repositoryNewPullRequestHref(owner, name)}>
              New pull request
            </a>
          </p>
        ) : null}
      </div>
      <section className="pull-requests" aria-labelledby="pull-requests-heading">
        <h2 id="pull-requests-heading" className="pull-requests__heading">
          Pull requests
        </h2>
        <PullRequestList owner={owner} name={name} pullRequests={visible} />
      </section>
    </main>
  );
}
