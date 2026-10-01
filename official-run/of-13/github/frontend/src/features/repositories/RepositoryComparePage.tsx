import { useEffect, useState } from "react";

import {
  canWriteRepositoryRole,
  fetchRepositoryComparison,
  repositoryCompareHref,
  repositoryCommitsHref,
  type RepositoryComparison,
} from "../../lib/repository-code-api";
import { useDocumentTitle } from "../../lib/document-title";
import { useAccountSession } from "../account/AccountSession";
import { CommitDiffView } from "./CommitDiffView";
import { RepositoryHeader } from "./RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "./RepositoryPageStates";
import { useRepositoryResource } from "./useRepositoryResource";

export interface RepositoryComparePageProps {
  owner: string;
  name: string;
  branch: string;
  base: string;
  compare: string;
  /** When set, only the diff of this changed file is opened. */
  path: string;
}

/**
 * The comparison page: two readable commits or revisions, picked from the
 * stored revisions, compared line by line. The comparison is read-only, so
 * refreshing it never changes a branch, commit or file.
 */
export function RepositoryComparePage({
  owner,
  name,
  branch,
  base,
  compare,
  path,
}: RepositoryComparePageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const [baseValue, setBaseValue] = useState(base);
  const [compareValue, setCompareValue] = useState(compare);

  useEffect(() => {
    setBaseValue(base);
  }, [base]);

  useEffect(() => {
    setCompareValue(compare);
  }, [compare]);

  const comparison = useRepositoryResource<RepositoryComparison>(
    `repository-compare:${owner}/${name}:${branch}:${base}:${compare}:${path}`,
    sessionStatus !== "loading",
    () => fetchRepositoryComparison(owner, name, { branch, base, compare, path }),
  );

  useDocumentTitle(`Compare · ${owner}/${name}`);

  if (comparison.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  if (comparison.status === "missing" || comparison.status === "error") {
    return <RepositoryNotFound />;
  }

  if (comparison.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const value = comparison.value;
  const repository = value.repository;
  const options = value.revisions ?? [];

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.hash = repositoryCompareHref(owner, name, {
      branch: value.branch,
      base: baseValue,
      compare: compareValue,
    });
  }

  return (
    <div className="repository-compare">
      <RepositoryHeader
        owner={repository.owner}
        name={repository.name}
        visibility={repository.visibility}
        description={repository.description}
        defaultBranch={repository.defaultBranch}
        showSettings={Boolean(account)}
        active="code"
        source={repository.source ?? null}
        branch={{
          branch: value.branch,
          branches: value.branches,
          hrefForBranch: (nextBranch) =>
            repositoryCompareHref(repository.owner, repository.name, {
              branch: nextBranch,
              base: value.base?.sha ?? "",
              compare: value.compare.sha,
            }),
          canWrite: canWriteRepositoryRole(repository.viewerRole),
        }}
      />
      <section className="repository-compare__section" aria-label="Revision comparison">
        <h2 id="compare-title">Compare revisions</h2>
        <form className="repository-compare__form" aria-label="Comparison controls" onSubmit={submit}>
          <label htmlFor="compare-base">Base revision</label>
          <select
            id="compare-base"
            name="base"
            value={baseValue}
            onChange={(event) => setBaseValue(event.target.value)}
          >
            {value.base ? null : <option value="">None</option>}
            {options.map((revision) => (
              <option key={revision.value} value={revision.value}>
                {revision.label}
              </option>
            ))}
          </select>
          <label htmlFor="compare-head">Compare revision</label>
          <select
            id="compare-head"
            name="compare"
            value={compareValue}
            onChange={(event) => setCompareValue(event.target.value)}
          >
            {options.map((revision) => (
              <option key={revision.value} value={revision.value}>
                {revision.label}
              </option>
            ))}
          </select>
          <button type="submit">Compare</button>
        </form>
        <CommitDiffView
          owner={repository.owner}
          name={repository.name}
          comparison={value}
          revision={value.compare.sha}
          openPath={path}
        />
      </section>
      <p className="repository-compare__back">
        <a
          href={repositoryCommitsHref(repository.owner, repository.name, {
            branch: value.branch,
          })}
        >
          Commit history
        </a>
      </p>
    </div>
  );
}
