import { useEffect, useState } from "react";

import {
  fetchRepositoryPullRequests,
  newPullRequestHref,
  pullRequestsListHref,
  repositoryPullRequestHref,
  type RepositoryPullRequestList,
} from "../../lib/pull-requests-api";
import { useDocumentTitle } from "../../lib/document-title";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryHeader } from "../repositories/RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "../repositories/RepositoryPageStates";
import { useRepositoryResource } from "../repositories/useRepositoryResource";
import {
  filterPullRequestRows,
  pullRequestReviewFilter,
  pullRequestStateFilter,
} from "./pull-filters";
import {
  formatPullRequestTime,
  pullRequestBranchText,
  pullRequestStatusLabel,
} from "./pull-format";

export interface PullRequestsListPageProps {
  owner: string;
  name: string;
  /** `state` of the filter address: `draft`, `open`, `closed`, `merged` or empty. */
  state: string;
  /** `author` of the filter address: the stored username. */
  author: string;
  /** `review` of the filter address: the review status. */
  review: string;
}

/**
 * The Pull requests list of one repository. Every row shows the number, title,
 * author, status and the source/target branches, and the title opens the detail
 * page. The status, author and review-status filters only change the rows shown
 * in the browser; they are carried by the address, so a reload of a filtered
 * list keeps the same context and the same rows.
 */
export function PullRequestsListPage({
  owner,
  name,
  state,
  author,
  review,
}: PullRequestsListPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const [authorFilter, setAuthorFilter] = useState(author);
  const [stateFilter, setStateFilter] = useState(() => pullRequestStateFilter(state));
  const [reviewFilter, setReviewFilter] = useState(() => pullRequestReviewFilter(review));

  // The address stays the shared source of the filter context; the local state
  // keeps typing and clicking instant and is re-synced whenever it changes.
  useEffect(() => setAuthorFilter(author), [author]);
  useEffect(() => setStateFilter(pullRequestStateFilter(state)), [state]);
  useEffect(() => setReviewFilter(pullRequestReviewFilter(review)), [review]);

  const resource = useRepositoryResource<RepositoryPullRequestList>(
    `repository-pulls:${owner}/${name}`,
    sessionStatus !== "loading",
    () => fetchRepositoryPullRequests(owner, name),
  );

  useDocumentTitle(`Pull requests · ${owner}/${name}`);

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

  const { repository, pullRequests, counts, canCreate } = resource.value;
  const rows = filterPullRequestRows(pullRequests, {
    state: stateFilter,
    author: authorFilter,
    review: reviewFilter,
  });
  const statuses = ["open", "closed", "draft", "merged"] as const;

  function filterHref(next: {
    state?: string;
    author?: string;
    review?: string;
  }): string {
    return pullRequestsListHref(owner, name, {
      state: next.state ?? stateFilter,
      author: next.author ?? authorFilter,
      review: next.review ?? reviewFilter,
    });
  }

  function applyAuthor(next: string): void {
    setAuthorFilter(next);
    window.location.hash = filterHref({ author: next });
  }

  function applyState(next: string): void {
    setStateFilter(pullRequestStateFilter(next));
    window.location.hash = filterHref({ state: next });
  }

  function applyReview(next: string): void {
    setReviewFilter(pullRequestReviewFilter(next));
    window.location.hash = filterHref({ review: next });
  }

  return (
    <div className="repository-pulls">
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
      <section className="repository-pulls__section" aria-labelledby="repository-pulls-title">
        <h2 id="repository-pulls-title">Pull requests</h2>
        {canCreate ? (
          <p className="repository-pulls__actions">
            <a href={newPullRequestHref(repository.owner, repository.name)}>New pull request</a>
          </p>
        ) : null}
        <form
          className="repository-pulls__filters"
          aria-label="Pull request filters"
          onSubmit={(event) => event.preventDefault()}
        >
          <nav className="repository-pulls__states" aria-label="Pull request status">
            <ul>
              <li>
                <a
                  href={filterHref({ state: "" })}
                  aria-current={stateFilter === "" ? "page" : undefined}
                  onClick={() => setStateFilter("")}
                >
                  All
                </a>
                <span className="repository-pulls__count">{counts.all}</span>
              </li>
              {statuses.map((status) => (
                <li key={status}>
                  <a
                    href={filterHref({ state: status })}
                    aria-current={stateFilter === status ? "page" : undefined}
                    onClick={() => setStateFilter(status)}
                  >
                    {pullRequestStatusLabel(status)}
                  </a>
                  <span className="repository-pulls__count">{counts[status]}</span>
                </li>
              ))}
            </ul>
          </nav>
          <p className="repository-pulls__search">
            <label htmlFor="pulls-author">Author</label>
            <input
              id="pulls-author"
              name="author"
              type="text"
              value={authorFilter}
              onChange={(event) => applyAuthor(event.target.value)}
            />
          </p>
          <p className="repository-pulls__review">
            <label htmlFor="pulls-review">Review status</label>
            <select
              id="pulls-review"
              name="review"
              value={reviewFilter}
              onChange={(event) => applyReview(event.target.value)}
            >
              <option value="">Any review status</option>
              <option value="review_required">Review required</option>
              <option value="approved">Approved</option>
              <option value="changes_requested">Changes requested</option>
            </select>
          </p>
        </form>
        {rows.length === 0 ? (
          <p className="repository-pulls__empty" role="status">
            No pull requests match the current filters
          </p>
        ) : (
          <ul className="repository-pulls__list">
            {rows.map((row) => {
              const href = repositoryPullRequestHref(repository.owner, repository.name, row.number);
              return (
                <li key={row.id} className="pull-request-row">
                  <article className="pull-request-row__body">
                    <h3 className="pull-request-row__title">
                      {/* The title link keeps the stored title as its name. */}
                      <a className="pull-request-row__title-link" href={href}>
                        {row.title}
                      </a>
                    </h3>
                    <p className="pull-request-row__meta">
                      <span className="pull-request-row__number">{`#${row.number}`}</span>
                      <span className="pull-request-row__status">
                        {pullRequestStatusLabel(row.status)}
                      </span>
                      <span className="pull-request-row__author">
                        {row.author ?? "Unknown author"}
                      </span>
                      <span className="pull-request-row__branches">
                        {pullRequestBranchText(row)}
                      </span>
                      <time className="pull-request-row__time" dateTime={row.createdAt}>
                        {formatPullRequestTime(row.createdAt)}
                      </time>
                    </p>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
