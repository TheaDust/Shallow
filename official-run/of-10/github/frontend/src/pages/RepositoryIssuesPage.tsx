import { useEffect, useState } from "react";

import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { parseHashLocation } from "../lib/hash-route";
import {
  filterIssues,
  readIssueFilters,
  writeIssueFiltersToAddress,
  type IssueFilterPatch,
  type IssueFilterValues,
} from "../lib/issue-filters";
import { canWriteIssues } from "../lib/issues-api";
import { repositoryIssuesPath, repositoryNewIssueHref } from "../lib/repository-routes";
import { repositoryTitle } from "../lib/repositories-api";
import { IssueFilterBar } from "../issue/IssueFilterBar";
import { IssueList } from "../issue/IssueList";
import { useRepositoryIssues } from "../issue/useIssues";
import { RepositoryChrome } from "../repository/RepositoryChrome";

export interface RepositoryIssuesPageProps {
  owner: string;
  name: string;
}

/** The filter of the current address, read once when the page is opened. */
function filtersFromAddress(): IssueFilterValues {
  return readIssueFilters(parseHashLocation(window.location.hash).search);
}

/**
 * The Issues list of one repository (REQ-5-1-1). The status, the keyword and the
 * label of the current view live in the page address, so refreshing the page —
 * or reopening it later — shows the same rows; the rows themselves are always the
 * persisted issues of the repository, and filtering never writes or deletes one.
 */
export function RepositoryIssuesPage({ owner, name }: RepositoryIssuesPageProps) {
  const { state } = useRepositoryIssues(owner, name);
  const [filters, setFilters] = useState<IssueFilterValues>(filtersFromAddress);

  // An “Open”/“Closed” link addresses the same list with another status: the
  // page stays mounted and follows the address so the rows, the search box and
  // the label filter always describe the same view.
  useEffect(() => {
    const syncFromAddress = () => setFilters(filtersFromAddress());
    window.addEventListener("hashchange", syncFromAddress);
    return () => window.removeEventListener("hashchange", syncFromAddress);
  }, []);

  const update = (patch: IssueFilterPatch) => {
    // The address is the source of truth of the current view, so a change made
    // while a status link is being followed never drops the other filters.
    const next: IssueFilterValues = { ...filtersFromAddress(), ...patch };
    setFilters(next);
    writeIssueFiltersToAddress(repositoryIssuesPath(owner, name), next);
  };

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading issues…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Issues unavailable</h1>
        <p role="alert">The issues could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const { repository, issues, labels } = state.value;
  const visible = filterIssues(issues, filters);

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
      <div className="issues-toolbar">
        <IssueFilterBar
          owner={owner}
          name={name}
          labels={labels}
          filters={filters}
          onChange={update}
        />
        {canWriteIssues(repository.permissions?.role ?? null) ? (
          <p className="issues-new">
            <a className="issues-new__link" href={repositoryNewIssueHref(owner, name)}>
              New issue
            </a>
          </p>
        ) : null}
      </div>
      <section className="issues" aria-labelledby="issues-heading">
        <h2 id="issues-heading" className="issues__heading">
          Issues
        </h2>
        <IssueList owner={owner} name={name} issues={visible} />
      </section>
    </main>
  );
}
